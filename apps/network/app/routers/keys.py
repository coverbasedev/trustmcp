from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..deps import get_storage
from ..ids import request_id as new_request_id
from ..mailer import send_email
from ..models import KeyRequest, Vendor
from ..ratelimit import rate_limit
from ..schemas import KeyRequestIn, Requester
from ..services import audit, auto_release_reason, mint_key, recommend
from ..storage import Storage
from ..webhooks import deliver

router = APIRouter(prefix="/v1/keys", tags=["keys"])


def _emit(background: BackgroundTasks, vendor: Vendor, event: str, data: dict) -> None:
    if vendor.webhook_url:
        background.add_task(deliver, vendor.webhook_url, vendor.webhook_secret, event, data)


def _handle_request(
    db: Session,
    settings: Settings,
    background: BackgroundTasks,
    vendor: Vendor,
    requester: Requester,
    scope: list[str],
    *,
    nda_accepted: bool = False,
    contract_key: str | None = None,
    contract_sha: str | None = None,
    artifact_ids: list[str] | None = None,
    company: str | None = None,
    reason: str | None = None,
) -> dict:
    if vendor.nda_required and not nda_accepted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "this vendor requires NDA acceptance (set nda_accepted=true)",
        )
    nda_at = datetime.now(UTC) if (vendor.nda_required and nda_accepted) else None
    nda_sha = (
        hashlib.sha256((vendor.nda_text or "").encode()).hexdigest()
        if (vendor.nda_required and nda_accepted)
        else None
    )
    req = KeyRequest(
        id=new_request_id(),
        vendor_id=vendor.id,
        requester_name=requester.name,
        requester_domain=requester.domain,
        requester_contact=requester.contact,
        requester_company=company,
        reason=reason,
        scope=scope,
        artifact_ids=artifact_ids or [],
        status="pending",
        contract_storage_key=contract_key,
        contract_sha256=contract_sha,
        nda_accepted_at=nda_at,
        nda_text_sha=nda_sha,
    )
    db.add(req)
    db.commit()
    audit(db, vendor.id, "key.requested", actor=requester.domain, detail=f"scope={','.join(scope)}")
    _emit(background, vendor, "key.requested", {
        "request_id": req.id, "requester": requester.model_dump(), "scope": scope,
    })

    reason = auto_release_reason(
        vendor, requester.domain, has_contract=bool(contract_key), settings=settings
    )
    # In-app approval agent: if enabled and the recommendation is a confident approve,
    # act on it automatically (records an agent reason).
    if not reason and vendor.agent_auto_approve:
        rec = recommend(vendor, req, settings)
        if rec["level"] == "approve":
            reason = "agent:recommendation"
    if reason:
        key, secret = mint_key(
            db,
            vendor,
            requester_name=requester.name,
            requester_domain=requester.domain,
            scope=scope,
            settings=settings,
            artifact_ids=artifact_ids or [],
        )
        req.status = "granted"
        req.access_key_id = key.id
        req.auto_approved = True
        req.decision_reason = reason
        db.add(req)
        db.commit()
        audit(
            db, vendor.id, "key.auto_granted",
            target=key.id, actor=requester.domain, detail=reason,
        )
        if vendor.notify_on_request and vendor.notify_email:
            background.add_task(
                send_email,
                settings,
                vendor.notify_email,
                f"Access auto-granted for {vendor.legal_name} ({requester.name})",
                f"{requester.name} ({requester.domain}) was auto-granted access via {reason}.",
            )
        _emit(background, vendor, "key.granted", {
            "key_id": key.id, "requester": requester.model_dump(),
            "scope": scope, "auto_approved": True, "reason": reason,
        })
        return {
            "status": "granted",
            "vendor_id": vendor.id,
            "key": secret,
            "key_id": key.id,
            "scope": scope,
            "expires_at": key.expires_at.isoformat(),
            "auto_approved": True,
            "reason": reason,
        }

    # Pending: optionally notify the owner (covers web, API, and MCP requests).
    if vendor.notify_on_request and vendor.notify_email:
        background.add_task(
            send_email,
            settings,
            vendor.notify_email,
            f"New access request for {vendor.legal_name} ({requester.name})",
            (
                f"{requester.name} ({requester.domain}, {requester.contact}) requested access "
                f"to {vendor.legal_name}.\nScope: {', '.join(scope)}\nRequest id: {req.id}\n\n"
                f"Review and approve in your dashboard."
            ),
        )
    return {"status": "pending", "request_id": req.id, "vendor_id": vendor.id}


@router.post("/request", dependencies=[Depends(rate_limit("keys.request"))])
def request_access(
    body: KeyRequestIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    vendor = db.get(Vendor, body.vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor not found")
    return _handle_request(
        db, settings, background, vendor, body.requester, body.scope,
        nda_accepted=body.nda_accepted, artifact_ids=body.artifact_ids,
        company=body.company, reason=body.reason,
    )


@router.post("/request-with-contract", dependencies=[Depends(rate_limit("keys.contract"))])
def request_access_with_contract(
    background: BackgroundTasks,
    vendor_id: str = Form(...),
    name: str = Form(...),
    domain: str = Form(...),
    contact: str = Form(...),
    scope: str = Form(...),  # JSON array or comma-separated
    nda_accepted: bool = Form(default=False),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
):
    """Request access with an uploaded contract as proof of an existing agreement.
    If the vendor enabled contract auto-release, the key is granted immediately."""
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor not found")
    try:
        scopes = json.loads(scope) if scope.strip().startswith("[") else scope.split(",")
    except json.JSONDecodeError:
        scopes = scope.split(",")
    scopes = [s.strip() for s in scopes]
    scopes = [s for s in scopes if s]
    if not scopes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "scope required")

    data = file.file.read()
    req_token = new_request_id()
    storage_key = f"{vendor.id}/_contracts/{req_token}/{file.filename or 'contract'}"
    sha = storage.put(storage_key, data, file.content_type)
    requester = Requester(name=name, domain=domain, contact=contact)
    return _handle_request(
        db, settings, background, vendor, requester, scopes,
        nda_accepted=nda_accepted, contract_key=storage_key, contract_sha=sha,
    )
