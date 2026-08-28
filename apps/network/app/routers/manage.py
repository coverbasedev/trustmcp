from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import SessionLocal, get_db
from ..deps import get_storage
from ..esign import esign_enabled_for, send_dpa_envelope
from ..ids import artifact_id as new_artifact_id
from ..ids import new_id, vendor_id_from_name
from ..mailer import send_email
from ..models import (
    AccessKey,
    Agreement,
    Artifact,
    ArtifactVersion,
    Claim,
    ComplianceBadge,
    Control,
    DataType,
    DomainVerification,
    FaqEntry,
    KeyRequest,
    Subprocessor,
    Subscriber,
    Update,
    Vendor,
)
from ..oscal.feed import record_change
from ..render_api import ensure_custom_domain as render_ensure_custom_domain
from ..schemas import (
    ArtifactCreate,
    ArtifactOut,
    ArtifactPresentationUpdate,
    ArtifactUpdate,
    AttestationsUpdate,
    BadgesUpdate,
    ControlsUpdate,
    CustomDomainAdd,
    CustomDomainAutoConfigure,
    CustomDomainConnect,
    CustomDomainDetect,
    DataTypesUpdate,
    DomainAdd,
    DomainChallenge,
    FaqUpdate,
    KeyApprove,
    MarkRevoke,
    ProfileUpdate,
    ResourceDisplayUpdate,
    SubprocessorsUpdate,
    UpdatesUpdate,
    VendorCreate,
    VendorCreated,
    VendorOut,
)
from ..security import (
    generate_owner_token,
    hash_secret,
    require_owner,
    require_service_token,
)
from ..services import audit, insights, mint_key, recommend, recompute_mark, resource_display_for
from ..storage import Storage
from ..verification import doh_resolve, host_resolves, probe_https, verify_domain
from ..webhooks import deliver

router = APIRouter(prefix="/v1", tags=["manage"])


def _products_from_names(names: list[str]) -> list[dict]:
    """Build fresh product-line objects (id + name) from a list of names."""
    out: list[dict] = []
    for name in names:
        clean = (name or "").strip()
        if clean:
            out.append({"id": new_id("prd", 8), "name": clean})
    return out


def _vendor_out(v: Vendor) -> dict:
    return {
        "id": v.id,
        "legal_name": v.legal_name,
        "product": v.product,
        "products": v.products or [],
        "domains": v.domains or [],
        "branding": v.branding or {},
        "mark_status": v.mark_status,
        "published_at": v.published_at,
        "notify_email": v.notify_email,
        "notify_on_request": v.notify_on_request,
        "listed": v.listed,
        "auto_approve_domains": v.auto_approve_domains or [],
        "auto_approve_crm": v.auto_approve_crm,
        "auto_approve_on_contract": v.auto_approve_on_contract,
        "nda_required": v.nda_required,
        "nda_text": v.nda_text,
        "dpa_self_serve": v.dpa_self_serve,
        "dpa_intro": v.dpa_intro,
        "dpa_template_id": v.dpa_template_id,
        "webhook_url": v.webhook_url,
        "webhook_secret": v.webhook_secret,
        "crm_provider": v.crm_provider,
        "crm_configured": bool(v.crm_token),
        "crm_instance_url": v.crm_instance_url,
        "crm_connection": v.crm_connection or "api",
        "crm_mcp_url": v.crm_mcp_url,
        "crm_mcp_configured": bool(v.crm_mcp_token),
        "crm_mcp_auth": v.crm_mcp_auth,
        "crm_mcp_client_id": v.crm_mcp_client_id,
        "crm_mcp_token_url": v.crm_mcp_token_url,
        "crm_mcp_client_secret_set": bool(v.crm_mcp_client_secret),
        "docusign_account_id": v.docusign_account_id,
        "docusign_integration_key": v.docusign_integration_key,
        "docusign_user_id": v.docusign_user_id,
        "docusign_auth_host": v.docusign_auth_host,
        "docusign_base_uri": v.docusign_base_uri,
        "docusign_private_key_set": bool(v.docusign_private_key),
        "docusign_connect_hmac_key_set": bool(v.docusign_connect_hmac_key),
        "docusign_configured": bool(
            v.docusign_account_id
            and v.docusign_integration_key
            and v.docusign_user_id
            and v.docusign_private_key
        ),
        "agent_auto_approve": v.agent_auto_approve,
        "watermark_downloads": v.watermark_downloads,
        "resource_display": resource_display_for(v),
    }


def _artifact_out(a: Artifact) -> dict:
    return {
        "id": a.id,
        "type": a.type,
        "title": a.title,
        "format": a.format,
        "issued_at": a.issued_at,
        "valid_until": a.valid_until,
        "scope": a.scope,
        "category": a.category,
        "sha256": a.sha256,
        "access": a.access,
        "uri": f"/v1/vendors/{a.vendor_id}/artifacts/{a.id}",
        "has_content": bool(a.storage_key),
        "version": a.version,
        "product_ids": a.product_ids or [],
        "description": a.description,
        "position": a.position,
        "featured": a.featured,
        "hidden": a.hidden,
        "source": a.source or "upload",
        "source_ref": a.source_ref,
    }


# --- Vendor lifecycle (service token) ---------------------------------------


@router.post("/vendors", response_model=VendorCreated, status_code=201)
def create_vendor(
    body: VendorCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_service_token),
):
    owner_token = generate_owner_token()
    products = _products_from_names(body.products)
    # Keep the legacy single `product` in sync: prefer an explicit value, else the
    # first product line, so older API consumers still see something sensible.
    legacy_product = body.product or (products[0]["name"] if products else None)
    vendor = Vendor(
        id=vendor_id_from_name(body.legal_name),
        legal_name=body.legal_name,
        product=legacy_product,
        products=products,
        domains=body.domains,
        branding={},
        notify_email=body.notify_email,
        owner_token_hash=hash_secret(owner_token),
        mark_status="unverified",
    )
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "vendor.create", actor="service")
    out = _vendor_out(vendor)
    out["owner_token"] = owner_token
    return out


@router.get("/vendors/{vendor_id}", response_model=VendorOut)
def get_vendor(vendor: Vendor = Depends(require_owner)):
    return _vendor_out(vendor)


_LOGO_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"}


@router.post("/vendors/{vendor_id}/branding/logo")
def upload_branding_logo(
    file: UploadFile = File(...),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    """Upload a logo image directly (instead of pasting a URL). Stored via the
    artifact storage backend and served from a stable public URL set on branding."""
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _LOGO_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "logo must be a PNG, JPEG, SVG, WebP, or GIF"
        )
    data = file.file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "logo must be 2 MB or smaller")
    token = secrets.token_hex(4)
    key = f"{vendor.id}/branding/logo-{token}"
    storage.put(key, data, content_type)
    branding = dict(vendor.branding or {})
    branding["logo_key"] = key
    branding["logo_content_type"] = content_type
    # Cache-bust the public URL on every upload: the serve route ignores the query
    # string, but a fresh `?v=` makes browsers/CDNs fetch the new bytes instead of
    # serving the previous logo from cache (the path itself is stable).
    branding["logo_url"] = (
        f"{settings.public_base_url}/v1/vendors/{vendor.id}/branding/logo?v={token}"
    )
    vendor.branding = branding
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "branding.logo_upload", actor="owner")
    return {"logo_url": branding["logo_url"]}


@router.get("/vendors/{vendor_id}/branding/logo")
def serve_branding_logo(
    vendor_id: str,
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """Public, stable URL that streams a vendor's uploaded logo bytes."""
    from fastapi.responses import Response

    vendor = db.get(Vendor, vendor_id)
    key = (vendor.branding or {}).get("logo_key") if vendor else None
    if not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no logo uploaded")
    data = storage.get(key)
    content_type = (vendor.branding or {}).get("logo_content_type") or "application/octet-stream"
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.post("/vendors/{vendor_id}/branding/logo/wide")
def upload_branding_logo_wide(
    file: UploadFile = File(...),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    """Upload a wide (horizontal lockup) logo alongside the square one. Stored via the
    artifact storage backend and served from a stable public URL set on branding."""
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _LOGO_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "wide logo must be a PNG, JPEG, SVG, WebP, or GIF",
        )
    data = file.file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "wide logo must be 2 MB or smaller"
        )
    token = secrets.token_hex(4)
    key = f"{vendor.id}/branding/logo-wide-{token}"
    storage.put(key, data, content_type)
    branding = dict(vendor.branding or {})
    branding["wide_logo_key"] = key
    branding["wide_logo_content_type"] = content_type
    # Cache-bust on every upload (see square-logo handler above for why).
    branding["wide_logo_url"] = (
        f"{settings.public_base_url}/v1/vendors/{vendor.id}/branding/logo/wide?v={token}"
    )
    vendor.branding = branding
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "branding.logo_wide_upload", actor="owner")
    return {"wide_logo_url": branding["wide_logo_url"]}


@router.get("/vendors/{vendor_id}/branding/logo/wide")
def serve_branding_logo_wide(
    vendor_id: str,
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """Public, stable URL that streams a vendor's uploaded wide logo bytes."""
    from fastapi.responses import Response

    vendor = db.get(Vendor, vendor_id)
    key = (vendor.branding or {}).get("wide_logo_key") if vendor else None
    if not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no wide logo uploaded")
    data = storage.get(key)
    content_type = (
        (vendor.branding or {}).get("wide_logo_content_type") or "application/octet-stream"
    )
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.put("/vendors/{vendor_id}/profile", response_model=VendorOut)
def update_profile(
    body: ProfileUpdate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    if body.legal_name is not None:
        vendor.legal_name = body.legal_name
    if body.product is not None:
        vendor.product = body.product
    if body.products is not None:
        existing_ids = {p.get("id") for p in (vendor.products or [])}
        new_products: list[dict] = []
        for item in body.products:
            name = (item.name or "").strip()
            if not name:
                continue
            pid = item.id if (item.id and item.id in existing_ids) else new_id("prd", 8)
            new_products.append({"id": pid, "name": name})
        vendor.products = new_products
        # Drop associations to product lines that no longer exist.
        kept_ids = {p["id"] for p in new_products}
        for art in vendor.artifacts:
            if art.product_ids:
                pruned = [pid for pid in art.product_ids if pid in kept_ids]
                if pruned != art.product_ids:
                    art.product_ids = pruned
        # Keep the legacy single product in sync unless explicitly set in this call.
        if body.product is None:
            vendor.product = new_products[0]["name"] if new_products else None
    if body.domains is not None:
        vendor.domains = body.domains
    if body.branding is not None:
        new_branding = body.branding.model_dump(exclude_none=True)
        # Preserve the uploaded-logo storage keys (not part of the public Branding
        # schema) as long as the logo_url still points at our serve route, so a
        # routine profile save doesn't orphan a directly-uploaded logo.
        old = vendor.branding or {}
        if old.get("logo_key") and new_branding.get("logo_url") == old.get("logo_url"):
            new_branding["logo_key"] = old["logo_key"]
            if old.get("logo_content_type"):
                new_branding["logo_content_type"] = old["logo_content_type"]
        # Same preservation for the directly-uploaded wide logo.
        if old.get("wide_logo_key") and new_branding.get("wide_logo_url") == old.get(
            "wide_logo_url"
        ):
            new_branding["wide_logo_key"] = old["wide_logo_key"]
            if old.get("wide_logo_content_type"):
                new_branding["wide_logo_content_type"] = old["wide_logo_content_type"]
        # Custom-domain hosting state lives in the branding JSON but is managed by its
        # own endpoints, so a routine profile save must not drop it.
        if old.get("custom_domain") and "custom_domain" not in new_branding:
            new_branding["custom_domain"] = old["custom_domain"]
        vendor.branding = new_branding
    if body.notify_email is not None:
        vendor.notify_email = body.notify_email or None
    if body.notify_on_request is not None:
        vendor.notify_on_request = body.notify_on_request
    if body.listed is not None:
        vendor.listed = body.listed
    if body.auto_approve_domains is not None:
        vendor.auto_approve_domains = [
            d.strip().lower() for d in body.auto_approve_domains if d.strip()
        ]
    if body.auto_approve_crm is not None:
        vendor.auto_approve_crm = body.auto_approve_crm
    if body.auto_approve_on_contract is not None:
        vendor.auto_approve_on_contract = body.auto_approve_on_contract
    if body.nda_required is not None:
        vendor.nda_required = body.nda_required
    if body.nda_text is not None:
        vendor.nda_text = body.nda_text or None
    if body.dpa_self_serve is not None:
        vendor.dpa_self_serve = body.dpa_self_serve
    if body.dpa_intro is not None:
        vendor.dpa_intro = body.dpa_intro or None
    if body.dpa_template_id is not None:
        vendor.dpa_template_id = body.dpa_template_id or None
    if body.webhook_url is not None:
        vendor.webhook_url = body.webhook_url or None
    if body.webhook_secret is not None:
        vendor.webhook_secret = body.webhook_secret or None
    if body.crm_provider is not None:
        vendor.crm_provider = body.crm_provider or None
    if body.crm_token is not None:
        # Empty string clears; otherwise set the new token.
        vendor.crm_token = body.crm_token or None
    if body.crm_instance_url is not None:
        vendor.crm_instance_url = body.crm_instance_url or None
    if body.crm_connection is not None:
        vendor.crm_connection = body.crm_connection or None
    if body.crm_mcp_url is not None:
        vendor.crm_mcp_url = body.crm_mcp_url or None
    if body.crm_mcp_token is not None:
        # Secret: only sent when the owner types a new value (empty clears it).
        vendor.crm_mcp_token = body.crm_mcp_token or None
    if body.crm_mcp_auth is not None:
        vendor.crm_mcp_auth = body.crm_mcp_auth or None
    if body.crm_mcp_client_id is not None:
        vendor.crm_mcp_client_id = body.crm_mcp_client_id or None
    if body.crm_mcp_client_secret is not None:
        vendor.crm_mcp_client_secret = body.crm_mcp_client_secret or None  # secret
    if body.crm_mcp_token_url is not None:
        vendor.crm_mcp_token_url = body.crm_mcp_token_url or None
    if body.docusign_account_id is not None:
        vendor.docusign_account_id = body.docusign_account_id or None
    if body.docusign_integration_key is not None:
        vendor.docusign_integration_key = body.docusign_integration_key or None
    if body.docusign_user_id is not None:
        vendor.docusign_user_id = body.docusign_user_id or None
    if body.docusign_private_key is not None:
        # Secret: only sent when the owner types a new value (empty clears it).
        vendor.docusign_private_key = body.docusign_private_key or None
    if body.docusign_auth_host is not None:
        vendor.docusign_auth_host = body.docusign_auth_host or None
    if body.docusign_base_uri is not None:
        vendor.docusign_base_uri = body.docusign_base_uri or None
    if body.docusign_connect_hmac_key is not None:
        # Secret: only sent when the owner types a new value (empty clears it).
        vendor.docusign_connect_hmac_key = body.docusign_connect_hmac_key or None
    if body.agent_auto_approve is not None:
        vendor.agent_auto_approve = body.agent_auto_approve
    if body.watermark_downloads is not None:
        vendor.watermark_downloads = body.watermark_downloads
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "profile.update", actor="owner")
    return _vendor_out(vendor)


@router.delete("/vendors/{vendor_id}", status_code=204)
def delete_vendor(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    """Permanently delete a vendor and all dependent records (offboarding)."""
    from ..models import (
        AccessKey,
        Agreement,
        ArtifactVersion,
        AuditLog,
        DomainVerification,
        KeyRequest,
    )

    vid = vendor.id
    for model in (ArtifactVersion, AccessKey, KeyRequest, DomainVerification, AuditLog, Agreement):
        for row in db.scalars(select(model).where(model.vendor_id == vid)).all():
            db.delete(row)
    db.delete(vendor)  # cascades artifacts, claims, subprocessors via ORM relationships
    db.commit()


@router.post("/vendors/{vendor_id}/publish", response_model=VendorOut)
def publish(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    vendor.published_at = datetime.now(UTC)
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "profile.publish", actor="owner")
    record_change(db, vendor.id, "published")
    return _vendor_out(vendor)


# --- Artifacts ---------------------------------------------------------------


@router.get("/vendors/{vendor_id}/artifacts", response_model=list[ArtifactOut])
def list_artifacts(vendor: Vendor = Depends(require_owner)):
    return [_artifact_out(a) for a in vendor.artifacts]


@router.post("/vendors/{vendor_id}/artifacts", response_model=ArtifactOut, status_code=201)
def create_artifact(
    body: ArtifactCreate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    valid_product_ids = {p.get("id") for p in (vendor.products or [])}
    artifact = Artifact(
        id=new_artifact_id(body.type),
        vendor_id=vendor.id,
        type=body.type,
        title=body.title,
        format=body.format,
        issued_at=body.issued_at,
        valid_until=body.valid_until,
        scope=body.scope,
        category=body.category,
        access=body.access,
        product_ids=[pid for pid in body.product_ids if pid in valid_product_ids],
        description=body.description,
        position=body.position,
        featured=body.featured,
        hidden=body.hidden,
    )
    db.add(artifact)
    db.commit()
    audit(db, vendor.id, "artifact.create", actor="owner", target=artifact.id)
    record_change(db, vendor.id, "artifact.created", subject=artifact.id)
    return _artifact_out(artifact)


@router.post("/vendors/{vendor_id}/artifacts/{artifact_id}/content", response_model=ArtifactOut)
def upload_artifact_content(
    artifact_id: str,
    file: UploadFile = File(...),
    note: str | None = Form(default=None),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """Upload artifact content. If the artifact already has content, the current
    version is archived to history and the version number is bumped."""
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")

    # Archive the current content as a previous version (if any).
    if artifact.storage_key:
        db.add(
            ArtifactVersion(
                artifact_id=artifact.id,
                vendor_id=vendor.id,
                version=artifact.version,
                sha256=artifact.sha256,
                storage_key=artifact.storage_key,
                content_type=artifact.content_type,
                size_bytes=artifact.size_bytes,
                issued_at=artifact.issued_at,
                valid_until=artifact.valid_until,
                note=note,
            )
        )
        artifact.version += 1

    data = file.file.read()
    storage_key = f"{vendor.id}/{artifact.id}/v{artifact.version}-{secrets.token_hex(4)}"
    digest = storage.put(storage_key, data, file.content_type)
    artifact.storage_key = storage_key
    artifact.sha256 = digest
    artifact.content_type = file.content_type
    artifact.size_bytes = len(data)
    db.add(artifact)
    db.commit()
    audit(
        db, vendor.id, "artifact.upload",
        actor="owner", target=artifact.id, detail=f"v{artifact.version} {digest}",
    )
    record_change(
        db, vendor.id, "artifact.version", subject=artifact.id,
        detail={"version": artifact.version, "sha256": digest},
    )
    return _artifact_out(artifact)


@router.get("/vendors/{vendor_id}/manage/artifacts/{artifact_id}/versions")
def list_artifact_versions(
    artifact_id: str,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    history = sorted(artifact.versions, key=lambda v: v.version, reverse=True)
    current = {
        "version": artifact.version,
        "sha256": artifact.sha256,
        "issued_at": artifact.issued_at,
        "valid_until": artifact.valid_until,
        "current": True,
        "note": None,
    }
    previous = [
        {
            "version": v.version,
            "sha256": v.sha256,
            "issued_at": v.issued_at,
            "valid_until": v.valid_until,
            "current": False,
            "note": v.note,
        }
        for v in history
    ]
    return {"artifact_id": artifact.id, "versions": [current, *previous]}


@router.patch("/vendors/{vendor_id}/artifacts/{artifact_id}", response_model=ArtifactOut)
def update_artifact(
    artifact_id: str,
    body: ArtifactUpdate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    fields = (
        "type", "title", "format", "issued_at", "valid_until", "scope", "category", "access",
        "description", "position", "featured", "hidden",
    )
    for field in fields:
        val = getattr(body, field)
        if val is not None:
            # A new validity window means the freshness nudge should fire again.
            if field == "valid_until" and val != artifact.valid_until:
                artifact.expiry_notified_at = None
            setattr(artifact, field, val)
    if body.product_ids is not None:
        valid_product_ids = {p.get("id") for p in (vendor.products or [])}
        artifact.product_ids = [pid for pid in body.product_ids if pid in valid_product_ids]
    db.add(artifact)
    db.commit()
    audit(db, vendor.id, "artifact.update", actor="owner", target=artifact.id)
    record_change(db, vendor.id, "artifact.updated", subject=artifact.id)
    return _artifact_out(artifact)


@router.delete("/vendors/{vendor_id}/artifacts/{artifact_id}", status_code=204)
def delete_artifact(
    artifact_id: str,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    db.delete(artifact)
    db.commit()
    audit(db, vendor.id, "artifact.delete", actor="owner", target=artifact_id)
    record_change(db, vendor.id, "artifact.deleted", subject=artifact_id)


# --- Public resource presentation -------------------------------------------


@router.get("/vendors/{vendor_id}/manage/resource-display")
def get_resource_display(vendor: Vendor = Depends(require_owner)) -> dict:
    """How the public trust center lays out resources, plus the categories in
    use — so the editor can offer the real list rather than a free-text field."""
    categories = sorted({a.category for a in vendor.artifacts if a.category})
    return {
        "vendor_id": vendor.id,
        "display": resource_display_for(vendor),
        "categories_in_use": categories,
    }


@router.put("/vendors/{vendor_id}/resource-display")
def update_resource_display(
    body: ResourceDisplayUpdate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Set layout, grouping, category order, and which fields are shown."""
    current = dict(vendor.resource_display or {})
    for field, value in body.model_dump(exclude_none=True).items():
        current[field] = value
    vendor.resource_display = current
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "resource_display.update", actor="owner")
    return {"vendor_id": vendor.id, "display": resource_display_for(vendor)}


@router.put("/vendors/{vendor_id}/artifacts/presentation")
def update_artifact_presentation(
    body: ArtifactPresentationUpdate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Reorder and re-label several resources at once.

    A drag-to-reorder UI produces one update per row; sending them together
    keeps the list from rendering half-reordered between requests.
    """
    by_id = {a.id: a for a in vendor.artifacts}
    unknown = [item.id for item in body.items if item.id not in by_id]
    if unknown:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"unknown artifact(s): {', '.join(unknown)}"
        )
    for item in body.items:
        artifact = by_id[item.id]
        for field in ("title", "description", "category", "position", "featured", "hidden"):
            value = getattr(item, field)
            if value is not None:
                setattr(artifact, field, value)
        db.add(artifact)
    db.commit()
    audit(
        db, vendor.id, "artifact.presentation", actor="owner", detail=f"{len(body.items)} items"
    )
    if body.items:
        record_change(db, vendor.id, "profile.updated", detail={"presentation": len(body.items)})
    return {"vendor_id": vendor.id, "updated": len(body.items),
            "artifacts": [_artifact_out(a) for a in sorted(vendor.artifacts, key=lambda x: x.id)]}


# --- Attestations & subprocessors -------------------------------------------


@router.get("/vendors/{vendor_id}/manage/attestations")
def get_attestations_for_owner(vendor: Vendor = Depends(require_owner)):
    return {
        "vendor_id": vendor.id,
        "claims": [
            {"key": c.key, "value": c.value, "evidence": c.evidence or []}
            for c in sorted(vendor.claims, key=lambda x: x.key)
        ],
    }


@router.get("/vendors/{vendor_id}/manage/subprocessors")
def get_subprocessors_for_owner(vendor: Vendor = Depends(require_owner)):
    return {
        "vendor_id": vendor.id,
        "subprocessors": [
            {
                "name": s.name, "purpose": s.purpose, "location": s.location,
                "domain": s.domain, "category": s.category, "logo_url": s.logo_url,
            }
            for s in vendor.subprocessors
        ],
    }


@router.put("/vendors/{vendor_id}/attestations")
def replace_attestations(
    body: AttestationsUpdate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    for c in list(vendor.claims):
        db.delete(c)
    for c in body.claims:
        db.add(Claim(vendor_id=vendor.id, key=c.key, value=c.value, evidence=c.evidence))
    vendor.attestations_generated_at = datetime.now(UTC)
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "attestations.update", actor="owner", detail=f"{len(body.claims)} claims")
    record_change(db, vendor.id, "claims.replaced", detail={"count": len(body.claims)})
    return {"vendor_id": vendor.id, "count": len(body.claims)}


@router.put("/vendors/{vendor_id}/subprocessors")
def replace_subprocessors(
    body: SubprocessorsUpdate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    for s in list(vendor.subprocessors):
        db.delete(s)
    for s in body.subprocessors:
        db.add(
            Subprocessor(
                vendor_id=vendor.id, name=s.name, purpose=s.purpose,
                location=s.location, domain=s.domain,
                category=s.category, logo_url=s.logo_url,
            )
        )
    db.commit()
    audit(db, vendor.id, "subprocessors.update", actor="owner")
    record_change(
        db, vendor.id, "subprocessors.replaced", detail={"count": len(body.subprocessors)}
    )
    return {"vendor_id": vendor.id, "count": len(body.subprocessors)}


# --- Compliance badges / controls / data / FAQ / updates --------------------
# Each is a "replace the whole list" PUT (mirrors subprocessors/attestations).


def _evidence_summary(db: Session, vendor_id: str, artifact_id: str | None) -> dict | None:
    """Minimal info about a badge's linked evidence artifact (for verification)."""
    if not artifact_id:
        return None
    art = db.get(Artifact, artifact_id)
    if art is None or art.vendor_id != vendor_id:
        return None
    return {
        "id": art.id,
        "title": art.title or art.type,
        "type": art.type,
        "access": art.access,
        "has_content": bool(art.storage_key),
    }


@router.get("/vendors/{vendor_id}/manage/badges")
def get_badges(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    return {
        "badges": [
            {
                "name": b.name,
                "standard": b.standard,
                "logo_url": b.logo_url,
                "evidence_artifact_id": b.evidence_artifact_id,
                "evidence": _evidence_summary(db, vendor.id, b.evidence_artifact_id),
                "issued_on": b.issued_on.isoformat() if b.issued_on else None,
                "valid_until": b.valid_until.isoformat() if b.valid_until else None,
            }
            for b in sorted(vendor.badges, key=lambda x: x.position)
        ]
    }


@router.put("/vendors/{vendor_id}/badges")
def replace_badges(
    body: BadgesUpdate, vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)
):
    # Only accept evidence links that point at one of this vendor's artifacts.
    own_artifact_ids = {a.id for a in vendor.artifacts}
    for b in list(vendor.badges):
        db.delete(b)
    for i, b in enumerate(body.badges):
        evidence_id = b.evidence_artifact_id if b.evidence_artifact_id in own_artifact_ids else None
        db.add(
            ComplianceBadge(
                vendor_id=vendor.id, name=b.name, standard=b.standard,
                logo_url=b.logo_url, evidence_artifact_id=evidence_id,
                issued_on=b.issued_on, valid_until=b.valid_until, position=i,
            )
        )
    db.commit()
    audit(db, vendor.id, "badges.update", actor="owner", detail=f"{len(body.badges)} badges")
    return {"vendor_id": vendor.id, "count": len(body.badges)}


@router.get("/vendors/{vendor_id}/manage/controls")
def get_controls(vendor: Vendor = Depends(require_owner)):
    return {
        "controls": [
            {
                "category": c.category,
                "name": c.name,
                "description": c.description,
                "status": c.status,
            }
            for c in sorted(vendor.controls, key=lambda x: (x.category, x.position))
        ]
    }


@router.put("/vendors/{vendor_id}/controls")
def replace_controls(
    body: ControlsUpdate, vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)
):
    for c in list(vendor.controls):
        db.delete(c)
    for i, c in enumerate(body.controls):
        db.add(
            Control(
                vendor_id=vendor.id, category=c.category, name=c.name,
                description=c.description, status=c.status, position=i,
            )
        )
    vendor.controls_updated_at = datetime.now(UTC)
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "controls.update", actor="owner", detail=f"{len(body.controls)} controls")
    record_change(db, vendor.id, "controls.replaced", detail={"count": len(body.controls)})
    return {"vendor_id": vendor.id, "count": len(body.controls)}


@router.get("/vendors/{vendor_id}/manage/data-types")
def get_data_types(vendor: Vendor = Depends(require_owner)):
    return {
        "data_types": [
            {"label": d.label, "collected": d.collected}
            for d in sorted(vendor.data_types, key=lambda x: x.position)
        ]
    }


@router.put("/vendors/{vendor_id}/data-types")
def replace_data_types(
    body: DataTypesUpdate, vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)
):
    for d in list(vendor.data_types):
        db.delete(d)
    for i, d in enumerate(body.data_types):
        db.add(DataType(vendor_id=vendor.id, label=d.label, collected=d.collected, position=i))
    db.commit()
    audit(db, vendor.id, "data_types.update", actor="owner")
    return {"vendor_id": vendor.id, "count": len(body.data_types)}


@router.get("/vendors/{vendor_id}/manage/faqs")
def get_faqs(vendor: Vendor = Depends(require_owner)):
    return {
        "faqs": [
            {"question": f.question, "answer": f.answer}
            for f in sorted(vendor.faqs, key=lambda x: x.position)
        ]
    }


@router.put("/vendors/{vendor_id}/faqs")
def replace_faqs(
    body: FaqUpdate, vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)
):
    for f in list(vendor.faqs):
        db.delete(f)
    for i, f in enumerate(body.faqs):
        db.add(FaqEntry(vendor_id=vendor.id, question=f.question, answer=f.answer, position=i))
    db.commit()
    audit(db, vendor.id, "faqs.update", actor="owner")
    return {"vendor_id": vendor.id, "count": len(body.faqs)}


@router.get("/vendors/{vendor_id}/manage/updates")
def get_updates(vendor: Vendor = Depends(require_owner)):
    return {
        "updates": [
            {
                "title": u.title, "body": u.body, "category": u.category,
                "published_at": u.published_at,
            }
            for u in sorted(
                vendor.updates,
                key=lambda x: (x.published_at or x.created_at.date()),
                reverse=True,
            )
        ]
    }


def _notify_subscribers_of_updates(
    settings: Settings, vendor_id: str, new_updates: list[dict]
) -> None:
    """Background task: email every active subscriber about newly-published updates."""
    db = SessionLocal()
    try:
        vendor = db.get(Vendor, vendor_id)
        if vendor is None:
            return
        subs = db.scalars(
            select(Subscriber).where(
                Subscriber.vendor_id == vendor_id, Subscriber.status == "subscribed"
            )
        ).all()
        if not subs:
            return
        name = (vendor.branding or {}).get("display_name") or vendor.legal_name
        link = f"{settings.web_base_url}/trust/{vendor_id}" if settings.web_base_url else ""
        body_lines = []
        for u in new_updates:
            body_lines.append(f"• {u['title']}" + (f"\n  {u['body']}" if u.get("body") else ""))
        text = (
            f"{name} published {len(new_updates)} update(s) to its Trust Center:\n\n"
            + "\n\n".join(body_lines)
            + (f"\n\nView: {link}" if link else "")
            + "\n\nYou're receiving this because you subscribed to updates."
        )
        subject = f"{name} Trust Center update"
        for s in subs:
            send_email(settings, s.email, subject, text)
    finally:
        db.close()


@router.put("/vendors/{vendor_id}/updates")
def replace_updates(
    body: UpdatesUpdate,
    background: BackgroundTasks,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # Identify genuinely-new updates (so editing existing ones doesn't re-notify).
    prior = {(u.title, u.published_at) for u in vendor.updates}
    for u in list(vendor.updates):
        db.delete(u)
    new_updates = []
    for u in body.updates:
        db.add(
            Update(
                vendor_id=vendor.id, title=u.title, body=u.body,
                category=u.category, published_at=u.published_at,
            )
        )
        if (u.title, u.published_at) not in prior:
            new_updates.append({"title": u.title, "body": u.body})
    db.commit()
    audit(db, vendor.id, "updates.update", actor="owner", detail=f"{len(body.updates)} updates")
    if new_updates:
        background.add_task(_notify_subscribers_of_updates, settings, vendor.id, new_updates)
    return {"vendor_id": vendor.id, "count": len(body.updates), "notified_new": len(new_updates)}


@router.get("/vendors/{vendor_id}/subscribers")
def list_subscribers(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Subscriber)
        .where(Subscriber.vendor_id == vendor.id, Subscriber.status == "subscribed")
        .order_by(Subscriber.created_at.desc())
    ).all()
    return {
        "count": len(rows),
        "subscribers": [{"email": s.email, "since": s.created_at} for s in rows],
    }


@router.get("/vendors/{vendor_id}/agreements")
def list_agreements(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Agreement)
        .where(Agreement.vendor_id == vendor.id)
        .order_by(Agreement.created_at.desc())
    ).all()
    return [
        {
            "id": a.id, "type": a.type, "company_name": a.company_name,
            "signer_name": a.signer_name, "signer_email": a.signer_email,
            "signer_title": a.signer_title, "status": a.status,
            "envelope_id": a.envelope_id, "created_at": a.created_at,
        }
        for a in rows
    ]


@router.post("/vendors/{vendor_id}/agreements/{agreement_id}/send")
def send_agreement(
    agreement_id: str,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Owner action: (re)send a submitted DPA to Docusign for signature. Requires
    Docusign to be configured and a template (vendor-level or network default)."""
    agreement = db.get(Agreement, agreement_id)
    if agreement is None or agreement.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agreement not found")
    if not esign_enabled_for(settings, vendor):
        raise HTTPException(status.HTTP_409_CONFLICT, "e-signature is not configured")
    if not (vendor.dpa_template_id or settings.docusign_dpa_template_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "no DPA template configured")
    try:
        envelope_id = send_dpa_envelope(settings, vendor, agreement)
    except Exception as e:
        audit(db, vendor.id, "agreement.esign_error", target=agreement_id, detail=str(e)[:300])
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"e-sign send failed: {e}") from e
    agreement.envelope_id = envelope_id
    agreement.status = "sent"
    db.add(agreement)
    db.commit()
    audit(db, vendor.id, "agreement.sent", target=agreement_id, detail=envelope_id)
    return {"id": agreement.id, "status": "sent", "envelope_id": envelope_id}


# --- Domain verification & mark ---------------------------------------------


@router.get("/vendors/{vendor_id}/domains")
def list_domains(
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    rows = db.scalars(
        select(DomainVerification).where(DomainVerification.vendor_id == vendor.id)
    ).all()
    return [
        {
            "domain": d.domain,
            "verified": d.verified,
            "method": d.method,
            "dns_record_name": f"{settings.challenge_dns_prefix}.{d.domain}",
            "dns_record_value": d.challenge_token,
            "well_known_url": f"https://{d.domain}/.well-known/trustmcp-challenge.txt",
        }
        for d in rows
    ]


@router.post("/vendors/{vendor_id}/domains", response_model=DomainChallenge)
def add_domain(
    body: DomainAdd,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    domain = body.domain.lower().strip()
    existing = db.scalar(
        select(DomainVerification).where(
            DomainVerification.vendor_id == vendor.id, DomainVerification.domain == domain
        )
    )
    if existing is None:
        existing = DomainVerification(
            vendor_id=vendor.id,
            domain=domain,
            challenge_token=f"trustmcp-verify={secrets.token_urlsafe(24)}",
        )
        db.add(existing)
        db.commit()
    return DomainChallenge(
        domain=domain,
        method="dns|well-known",
        dns_record_name=f"{settings.challenge_dns_prefix}.{domain}",
        dns_record_value=existing.challenge_token,
        well_known_url=f"https://{domain}/.well-known/trustmcp-challenge.txt",
        well_known_value=existing.challenge_token,
        verified=existing.verified,
    )


@router.post("/vendors/{vendor_id}/domains/{domain}/verify")
def verify_domain_endpoint(
    domain: str,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    domain = domain.lower().strip()
    dv = db.scalar(
        select(DomainVerification).where(
            DomainVerification.vendor_id == vendor.id, DomainVerification.domain == domain
        )
    )
    if dv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "domain not added")
    ok, method = verify_domain(domain, dv.challenge_token, settings.challenge_dns_prefix)
    if not ok:
        audit(db, vendor.id, "domain.verify_failed", actor="owner", target=domain)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "challenge not found via DNS TXT or .well-known/trustmcp-challenge.txt",
        )
    dv.verified = True
    dv.method = method
    dv.verified_at = datetime.now(UTC)
    # Verifying any domain grants the agent-ready mark and ensures it's in domains list.
    if domain not in (vendor.domains or []):
        vendor.domains = [*(vendor.domains or []), domain]
    # Respect the sticky 'revoked' state: a revoked vendor must be reinstated by the
    # operator - re-verifying a domain does NOT silently re-grant the mark.
    if vendor.mark_status != "revoked":
        vendor.mark_status = "agent-ready"
    db.add_all([dv, vendor])
    db.commit()
    audit(db, vendor.id, "domain.verified", actor="owner", target=domain, detail=method)
    return {"domain": domain, "verified": True, "method": method, "mark_status": vendor.mark_status}


@router.delete("/vendors/{vendor_id}/domains/{domain}")
def remove_domain(
    domain: str,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Remove a domain (e.g. control lapsed). Deletes the verification, drops it from
    the vendor's domain list, and recomputes the mark (falls back to 'unverified' if
    no verified domains remain - unless the vendor is operator-revoked)."""
    domain = domain.lower().strip()
    dv = db.scalar(
        select(DomainVerification).where(
            DomainVerification.vendor_id == vendor.id, DomainVerification.domain == domain
        )
    )
    if dv is not None:
        db.delete(dv)
    vendor.domains = [d for d in (vendor.domains or []) if d != domain]
    db.flush()
    mark = recompute_mark(vendor, db)
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "domain.removed", actor="owner", target=domain)
    return {"domain": domain, "removed": True, "mark_status": mark}


# --- Custom-domain hosting (serve the trust center on a customer domain) ------
# This is SEPARATE from domain-ownership verification above (which grants the mark).
# State lives in the branding JSON under a nested "custom_domain" key (no migration).

_HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")


def _validate_custom_domain(raw: str) -> str:
    domain = (raw or "").strip().lower()
    if not domain or not _HOSTNAME_RE.match(domain):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "domain must be a bare hostname (no scheme, path, or spaces) with a dot",
        )
    return domain


def _custom_domain_instructions(cd: dict) -> dict:
    """The DNS records the customer must create to point their domain at us."""
    return {
        "records": [
            {"type": "CNAME", "name": cd["domain"], "value": cd["cname_target"]},
            {"type": "TXT", "name": cd["txt_name"], "value": cd["txt_value"]},
        ]
    }


def _assess_tls(domain: str, cname_target: str) -> tuple[str, str | None]:
    """Determine the *real* TLS state of a verified custom domain (returns
    ``(tls, message)``). Rather than optimistically flagging "provisioning" forever,
    we probe what's actually happening:

    - ``active``: the domain already serves a valid certificate over HTTPS.
    - ``provisioning``: our edge target resolves, so the domain routes to us and the
      certificate is genuinely still being issued — keep waiting.
    - ``blocked``: our edge target (cname.trustmcp.app) doesn't resolve, so nothing
      can route there and no certificate can be issued. This is on our side, not the
      customer's — surface an honest message instead of a stuck "provisioning".
    """
    if probe_https(domain):
        return "active", None
    if host_resolves(cname_target):
        return "provisioning", None
    return "blocked", (
        f"DNS is verified, but our edge ({cname_target}) isn't resolving yet, so a "
        "TLS certificate can't be issued and the domain can't serve. This is on the "
        "TrustMCP side — re-check in a few minutes."
    )


@router.post("/vendors/{vendor_id}/custom-domain")
def add_custom_domain(
    body: CustomDomainAdd,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Register a custom domain to host this trust center on (e.g. trust.example.com).
    Returns the stored state plus the DNS records the customer must create."""
    domain = _validate_custom_domain(body.domain)
    verify_token = secrets.token_hex(16)
    cd = {
        "domain": domain,
        "status": "pending",
        "verify_token": verify_token,
        "cname_target": settings.custom_domain_cname_target,
        "txt_name": f"_trustmcp.{domain}",
        "txt_value": f"trustmcp-verify={verify_token}",
        "created_at": datetime.now(UTC).isoformat(),
        "verified_at": None,
        "tls": "none",
        "last_error": None,
    }
    branding = dict(vendor.branding or {})
    branding["custom_domain"] = cd
    vendor.branding = branding
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "custom_domain.add", actor="owner", target=domain)
    return {**cd, "instructions": _custom_domain_instructions(cd)}


@router.get("/vendors/{vendor_id}/custom-domain")
def get_custom_domain(vendor: Vendor = Depends(require_owner)):
    """Return the stored custom-domain state (plus DNS instructions while pending)."""
    cd = (vendor.branding or {}).get("custom_domain")
    if not cd:
        return {"domain": None}
    out = dict(cd)
    if cd.get("status") in ("pending", "error"):
        out["instructions"] = _custom_domain_instructions(cd)
    return out


@router.post("/vendors/{vendor_id}/custom-domain/verify")
def verify_custom_domain(
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Check that the customer pointed their domain at us, via DNS-over-HTTPS (stdlib
    only). Verified if the TXT challenge matches OR the CNAME points at our target."""
    cd = (vendor.branding or {}).get("custom_domain")
    if not cd:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no custom domain configured")
    cd = dict(cd)
    ok = False
    try:
        txts = doh_resolve(cd["txt_name"], "TXT")
        if any(cd["txt_value"] in t for t in txts):
            ok = True
        if not ok:
            cnames = doh_resolve(cd["domain"], "CNAME")
            target = cd["cname_target"].rstrip(".").lower()
            if any(c.rstrip(".").lower() == target for c in cnames):
                ok = True
    except Exception:
        # Treat any lookup failure as "could not verify yet" rather than a 500.
        ok = False
    if ok:
        cd["verified_at"] = datetime.now(UTC).isoformat()
        # Ownership is proven — register the domain on our serving edge so Render
        # issues the certificate. Best-effort: a Render hiccup must not fail
        # verification (the poller retries), so we swallow RenderError here.
        if settings.render_enabled:
            try:
                rec = render_ensure_custom_domain(settings, cd["domain"])
                cd["render_domain_id"] = rec.get("id")
                cd["render_verification"] = rec.get("verification_status")
            except Exception:  # noqa: BLE001 - never fail verification on a Render hiccup
                pass
        # Now report the *real* serving state instead of a blanket "provisioning":
        # we probe whether HTTPS is actually live and whether our edge is reachable,
        # so the UI can be honest and the poller can flip it to "active" later.
        tls_state, tls_message = _assess_tls(cd["domain"], cd["cname_target"])
        cd["tls"] = tls_state
        cd["last_error"] = tls_message
        # Only call the domain "active" once it genuinely serves over HTTPS; otherwise
        # it's verified-but-not-yet-live (provisioning or blocked on our edge).
        cd["status"] = "active" if tls_state == "active" else "verified"
    else:
        cd["status"] = "error"
        cd["last_error"] = (
            "Could not verify yet. Create the CNAME and TXT records shown in the "
            "setup instructions, then retry (DNS changes can take a few minutes)."
        )
    branding = dict(vendor.branding or {})
    branding["custom_domain"] = cd
    vendor.branding = branding
    db.add(vendor)
    db.commit()
    audit(
        db, vendor.id, "custom_domain.verify",
        actor="owner", target=cd["domain"], detail=cd["status"],
    )
    out = dict(cd)
    if cd["status"] in ("pending", "error"):
        out["instructions"] = _custom_domain_instructions(cd)
    return out


@router.delete("/vendors/{vendor_id}/custom-domain")
def remove_custom_domain(
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Stop hosting the trust center on the custom domain (clears the stored state)."""
    branding = dict(vendor.branding or {})
    removed = branding.pop("custom_domain", None)
    vendor.branding = branding
    db.add(vendor)
    db.commit()
    audit(
        db, vendor.id, "custom_domain.remove",
        actor="owner", target=(removed or {}).get("domain"),
    )
    return {"domain": None, "removed": removed is not None}


@router.post("/vendors/{vendor_id}/custom-domain/dns/detect")
def detect_custom_domain_provider(
    body: CustomDomainDetect,
    vendor: Vendor = Depends(require_owner),
):
    """Best-effort detect the customer's DNS provider (by nameserver) so we can offer
    automatic record creation — or, when we can't write to it via API, name the
    provider and deep-link straight to its DNS panel. Returns ``provider: null`` when
    unrecognized (manual fallback). ``catalog`` lists every provider we can
    auto-configure, so the UI can offer a manual override without its own hardcoded
    list."""
    from ..dns_providers import detect_provider, provider_catalog, provider_meta

    domain = _validate_custom_domain(body.domain)
    provider = detect_provider(domain)
    meta = provider_meta(provider)
    return {
        "provider": provider,
        "supported": bool(meta.get("can_auto")),  # back-compat: True == API auto-config
        "can_auto": bool(meta.get("can_auto")),
        "label": meta.get("label"),
        "dns_panel_url": meta.get("dns_panel_url"),
        "fields": meta.get("fields", []),
        "catalog": provider_catalog(),
    }


@router.post("/vendors/{vendor_id}/custom-domain/dns/auto-configure")
def auto_configure_custom_domain_dns(
    body: CustomDomainAutoConfigure,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Automatically create the required CNAME + TXT records via the customer's DNS
    provider API. Credentials are used in-process only and never stored or audited."""
    from ..dns_providers import PROVIDERS, DnsProviderError, DnsRecord, zone_for

    domain = _validate_custom_domain(body.domain)
    cd = (vendor.branding or {}).get("custom_domain")
    if not cd or cd.get("domain") != domain:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "custom domain not configured for this vendor"
        )
    provider = PROVIDERS.get(body.provider)
    if provider is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unsupported provider '{body.provider}'; add the records manually instead",
        )
    records = [
        DnsRecord(type="CNAME", name=cd["domain"], value=cd["cname_target"]),
        DnsRecord(type="TXT", name=cd["txt_name"], value=cd["txt_value"]),
    ]
    # Provider APIs operate on the registrable zone (example.com), not the sub-host
    # the customer points at us (trust.example.com). The record names stay FQDNs;
    # each adapter derives the host relative to the zone.
    zone = zone_for(domain)
    try:
        provider.upsert_records(zone, records, body.credentials or {})
    except (DnsProviderError, NotImplementedError) as e:
        # Never leak credentials; only audit the provider name on the failure path is
        # avoided too — we audit success only below.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    # Records created; awaiting DNS propagation before verification can pass.
    new_cd = dict(cd)
    new_cd["status"] = "pending"
    branding = dict(vendor.branding or {})
    branding["custom_domain"] = new_cd
    vendor.branding = branding
    db.add(vendor)
    db.commit()
    # Audit records the provider name ONLY — never the credentials.
    audit(
        db, vendor.id, "custom_domain.dns_auto",
        actor="owner", target=domain, detail=body.provider,
    )
    return {"ok": True}


@router.post("/vendors/{vendor_id}/custom-domain/dns/domain-connect/discover")
def domain_connect_discover(
    body: CustomDomainConnect,
    vendor: Vendor = Depends(require_owner),
    settings: Settings = Depends(get_settings),
):
    """Discover whether the customer's DNS provider supports the Domain Connect
    synchronous flow ("Plaid for DNS"). When it does, return the provider name and an
    `apply_url` — a provider-hosted consent page that, once the customer approves,
    writes our CNAME + TXT directly. No credentials change hands or are stored. Returns
    `supported: false` when the domain has no Domain Connect support (the per-provider
    API path and manual records remain as fallbacks)."""
    from ..domain_connect import build_apply_flow

    domain = _validate_custom_domain(body.domain)
    cd = (vendor.branding or {}).get("custom_domain")
    if not cd or cd.get("domain") != domain:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "custom domain not configured for this vendor"
        )
    redirect_uri = (
        f"{settings.web_base_url}/domain-connect/callback"
        if settings.web_base_url
        else ""
    )
    # Our template embeds the fixed "trustmcp-verify=" prefix and takes the bare token
    # as %token% (per Domain Connect's guidance to avoid bare-variable record values).
    txt_value = cd["txt_value"]
    token = txt_value.split("trustmcp-verify=", 1)[-1]
    flow = build_apply_flow(
        domain,
        template_params={"cname": cd["cname_target"], "token": token},
        provider_id=settings.domain_connect_provider_id,
        service_id=settings.domain_connect_service_id,
        redirect_uri=redirect_uri,
        state=vendor.id,
    )
    if not flow:
        return {"supported": False, "provider_name": None, "apply_url": None}
    return {"supported": True, **flow}


# --- Operator: mark revocation (trust anchor, service-token auth) ------------


@router.post("/vendors/{vendor_id}/mark/revoke")
def revoke_mark(
    vendor_id: str,
    body: MarkRevoke | None = None,
    db: Session = Depends(get_db),
    _: None = Depends(require_service_token),
):
    """Operator action: suppress a vendor's mark for abuse. Sticky - re-verifying a
    domain will not re-grant it; the operator must reinstate."""
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor not found")
    reason = (body.reason if body else None) or None
    vendor.mark_status = "revoked"
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "mark.revoked", actor="operator", detail=reason)
    return {"vendor_id": vendor.id, "mark_status": "revoked", "reason": reason}


@router.post("/vendors/{vendor_id}/mark/reinstate")
def reinstate_mark(
    vendor_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_service_token),
):
    """Operator action: lift a revocation. Recomputes from verified domains."""
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor not found")
    # Clear the sticky state before recomputing.
    vendor.mark_status = "unverified"
    mark = recompute_mark(vendor, db)
    db.add(vendor)
    db.commit()
    audit(db, vendor.id, "mark.reinstated", actor="operator", detail=mark)
    return {"vendor_id": vendor.id, "mark_status": mark}


# --- Access key requests & lifecycle ----------------------------------------


@router.get("/vendors/{vendor_id}/keys/requests")
def list_key_requests(
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    reqs = db.scalars(
        select(KeyRequest)
        .where(KeyRequest.vendor_id == vendor.id)
        .order_by(KeyRequest.created_at.desc())
    ).all()
    out = []
    for r in reqs:
        item = {
            "id": r.id,
            "requester": {
                "name": r.requester_name,
                "domain": r.requester_domain,
                "contact": r.requester_contact,
                "company": r.requester_company,
            },
            "reason": r.reason,
            "scope": r.scope,
            "artifact_ids": r.artifact_ids or [],
            "status": r.status,
            "created_at": r.created_at,
            "decided_at": r.decided_at,
            "access_key_id": r.access_key_id,
            "auto_approved": r.auto_approved,
            "decision_reason": r.decision_reason,
            "has_contract": bool(r.contract_storage_key),
            "nda_accepted": r.nda_accepted_at is not None,
        }
        # Advisory recommendation for pending requests only.
        if r.status == "pending":
            item["recommendation"] = recommend(vendor, r, settings)
        out.append(item)
    return out


@router.get("/vendors/{vendor_id}/insights")
def get_insights(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    return insights(db, vendor)


@router.get("/vendors/{vendor_id}/keys/requests/{request_id}/contract")
def download_request_contract(
    request_id: str,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    req = db.get(KeyRequest, request_id)
    if req is None or req.vendor_id != vendor.id or not req.contract_storage_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no contract on this request")
    url = storage.presign_get(req.contract_storage_key, filename=f"contract-{req.id}")
    return {
        "url": url,
        "sha256": req.contract_sha256,
        "expires_in": settings.signed_url_ttl_seconds,
    }


def _emit(background: BackgroundTasks, vendor: Vendor, event: str, data: dict) -> None:
    if vendor.webhook_url:
        background.add_task(deliver, vendor.webhook_url, vendor.webhook_secret, event, data)


@router.post("/vendors/{vendor_id}/keys/requests/{request_id}/approve")
def approve_key_request(
    request_id: str,
    background: BackgroundTasks,
    body: KeyApprove | None = None,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    req = db.get(KeyRequest, request_id)
    if req is None or req.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
    if req.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"request already {req.status}")
    body = body or KeyApprove()
    scope = body.scope or req.scope
    # Honor the requester's "limited access" selection by default: only override it
    # when the owner explicitly narrows the grant with their own artifact_ids. An
    # empty/omitted list inherits req.artifact_ids so a limited request is NOT
    # silently widened to full access on manual approval (matches the auto-grant path).
    artifact_ids = body.artifact_ids or (req.artifact_ids or [])
    key, secret = mint_key(
        db,
        vendor,
        requester_name=req.requester_name,
        requester_domain=req.requester_domain,
        scope=scope,
        settings=settings,
        artifact_ids=artifact_ids,
        ttl_days=body.ttl_days,
    )
    req.status = "granted"
    req.access_key_id = key.id
    req.decided_at = datetime.now(UTC)
    db.add(req)
    db.commit()
    audit(db, vendor.id, "key.granted", target=key.id, actor=req.requester_domain)
    _emit(background, vendor, "key.granted", {
        "key_id": key.id, "requester": {"name": req.requester_name, "domain": req.requester_domain},
        "scope": scope, "artifact_ids": key.artifact_ids,
    })
    return {
        "status": "granted",
        "vendor_id": vendor.id,
        "key": secret,  # shown ONCE
        "key_id": key.id,
        "scope": scope,
        "artifact_ids": key.artifact_ids,
        "expires_at": key.expires_at,
    }


@router.post("/vendors/{vendor_id}/keys/requests/{request_id}/deny")
def deny_key_request(
    request_id: str,
    background: BackgroundTasks,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    req = db.get(KeyRequest, request_id)
    if req is None or req.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
    req.status = "denied"
    req.decided_at = datetime.now(UTC)
    db.add(req)
    db.commit()
    audit(db, vendor.id, "key.denied", target=req.id, actor=req.requester_domain)
    _emit(background, vendor, "key.denied", {
        "request_id": req.id,
        "requester": {"name": req.requester_name, "domain": req.requester_domain},
    })
    return {"status": "denied", "request_id": req.id}


@router.get("/vendors/{vendor_id}/keys")
def list_keys(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    keys = db.scalars(select(AccessKey).where(AccessKey.vendor_id == vendor.id)).all()
    return [
        {
            "id": k.id,
            "requester": {"name": k.requester_name, "domain": k.requester_domain},
            "scope": k.scope,
            "status": k.status,
            "display_hint": f"...{k.display_hint}",
            "expires_at": k.expires_at,
            "last_used_at": k.last_used_at,
        }
        for k in keys
    ]


@router.post("/vendors/{vendor_id}/keys/{key_id}/revoke")
def revoke_key(
    key_id: str,
    background: BackgroundTasks,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    key = db.get(AccessKey, key_id)
    if key is None or key.vendor_id != vendor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "key not found")
    key.status = "revoked"
    key.revoked_at = datetime.now(UTC)
    db.add(key)
    db.commit()
    audit(db, vendor.id, "key.revoked", target=key.id, actor=key.requester_domain)
    _emit(background, vendor, "key.revoked", {
        "key_id": key.id,
        "requester": {"name": key.requester_name, "domain": key.requester_domain},
    })
    return {"status": "revoked", "key_id": key.id}


@router.get("/vendors/{vendor_id}/audit")
def get_audit(
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    from ..models import AuditLog

    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.vendor_id == vendor.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [
        {
            "action": r.action,
            "actor": r.actor,
            "target": r.target,
            "detail": r.detail,
            "access_key_id": r.access_key_id,
            "at": r.created_at,
        }
        for r in rows
    ]


@router.get("/vendors/{vendor_id}/audit.csv")
def export_audit_csv(vendor: Vendor = Depends(require_owner), db: Session = Depends(get_db)):
    import csv
    import io

    from fastapi.responses import StreamingResponse

    from ..models import AuditLog

    rows = db.scalars(
        select(AuditLog).where(AuditLog.vendor_id == vendor.id).order_by(AuditLog.created_at.desc())
    ).all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["at", "action", "actor", "target", "detail", "access_key_id"])
    for r in rows:
        writer.writerow([
            r.created_at.isoformat() if r.created_at else "",
            r.action, r.actor or "", r.target or "", r.detail or "", r.access_key_id or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="audit-{vendor.id}.csv"'},
    )
