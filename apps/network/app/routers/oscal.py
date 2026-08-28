"""OSCAL exchange endpoints.

Two surfaces live here.

Point-in-time, under `/v1/vendors/{vendor_id}/oscal/...`: one route per OSCAL
model plus a bundle, in JSON, YAML, or XML. These require the `attestations`
scope — the same entitlement as reading claims, because that is what they carry.

Continuous, under the same prefix: a cursor feed, an SSE stream, and webhook
subscriptions. A consumer polls or subscribes and re-pulls only the models a
change actually invalidated.

Network-level routes (`/v1/oscal/...`) are unauthenticated: the claim catalog,
the per-framework profiles, and the capability descriptor a consumer reads to
negotiate before it holds any key at all.
"""

from __future__ import annotations

import json

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import oscal as oscal_mod
from ..config import Settings, get_settings
from ..db import SessionLocal, get_db
from ..frameworks import FRAMEWORKS
from ..ids import new_id
from ..models import OscalSubscription, Vendor
from ..oscal import feed as feed_mod
from ..oscal.catalog import catalog as build_catalog
from ..oscal.catalog import profile as build_profile
from ..security import KeyContext, require_owner, require_scope
from ..services import audit
from ..signing import get_signer

router = APIRouter(prefix="/v1/vendors/{vendor_id}/oscal", tags=["oscal"])
network_router = APIRouter(prefix="/v1/oscal", tags=["oscal"])

MAX_CHANGE_PAGE = 500


def _frameworks(raw: str | None) -> list[str] | None:
    """Parse a comma-separated `framework` query into a validated list."""
    if not raw:
        return None
    wanted = [f.strip() for f in raw.split(",") if f.strip()]
    unknown = [f for f in wanted if f not in FRAMEWORKS]
    if unknown:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"unknown framework(s): {', '.join(unknown)}"
        )
    return wanted or None


def _respond(document: dict, fmt: str, *, sign: bool = True) -> Response:
    """Render and sign an OSCAL document.

    The signature covers the exact bytes returned, in whatever format was asked
    for — so a consumer that pulled XML verifies the XML it holds, not a JSON
    re-rendering of it.
    """
    try:
        body, media_type = oscal_mod.render(document, fmt)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    headers = {
        "X-TrustMCP-OSCAL-Version": oscal_mod.OSCAL_VERSION,
        "X-TrustMCP-OSCAL-Digest": oscal_mod.digest_of(document),
    }
    encoded = body.encode()
    if sign:
        signer = get_signer()
        headers["X-TrustMCP-Signature"] = signer.sign(encoded)
        headers["X-TrustMCP-Key-Id"] = signer.key_id
    return Response(content=encoded, media_type=media_type, headers=headers)


def _context(ctx: KeyContext, settings: Settings):
    return oscal_mod.from_vendor(ctx.vendor, settings)


# --- Network-level (unauthenticated) ----------------------------------------


@network_router.get("/capabilities")
def oscal_capabilities() -> dict:
    """What this deployment supports. Read this first: it names every model,
    format, alias, and endpoint, so a consumer negotiates instead of guessing."""
    return oscal_mod.capabilities()


@network_router.get("/catalog")
def oscal_catalog(format: str = Query("json")) -> Response:
    """The TrustMCP claim vocabulary as an OSCAL catalog."""
    return _respond(build_catalog(), format)


@network_router.get("/profile/{framework}")
def oscal_profile(framework: str, format: str = Query("json")) -> Response:
    """The baseline of controls TrustMCP evidence addresses for a framework."""
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown framework: {framework}")
    return _respond(build_profile(framework), format)


@network_router.post("/validate")
def oscal_validate(document: dict = Body(...)) -> dict:
    """Validate an OSCAL document's structure.

    Open to anyone: it reads the posted document and returns findings, touching
    nothing else. Useful before an import, and as a way to check a document
    TrustMCP produced against a consumer's own pipeline.
    """
    return oscal_mod.validate(document)


# --- Point-in-time (scoped) --------------------------------------------------


@router.get("/bundle")
def oscal_bundle(
    vendor_id: str,
    framework: str | None = Query(None, description="Comma-separated framework ids"),
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Every vendor OSCAL model in one response, with per-document digests.

    The digests are the point: a continuous consumer stores them and, on the
    next pull, re-parses only the documents whose digest moved.
    """
    audit(
        db,
        vendor_id,
        "read.oscal.bundle",
        access_key_id=ctx.key.id,
        actor=ctx.key.requester_domain,
    )
    payload = oscal_mod.bundle(_context(ctx, settings), frameworks=_frameworks(framework))
    payload["cursor"] = feed_mod.current_cursor(db, vendor_id)
    return payload


@router.get("/changes")
def oscal_changes(
    vendor_id: str,
    since: int = Query(0, ge=0, description="Cursor from a previous response"),
    limit: int = Query(100, ge=1, le=MAX_CHANGE_PAGE),
    models: str | None = Query(None, description="Comma-separated OSCAL model names"),
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
) -> dict:
    """Changes since a cursor — the polling form of continuous exchange."""
    wanted = [m.strip() for m in models.split(",")] if models else None
    return feed_mod.changes_since(db, vendor_id, since, limit=limit, models=wanted)


@router.get("/stream")
def oscal_stream(
    vendor_id: str,
    request: Request,
    since: int = Query(0, ge=0),
    ctx: KeyContext = Depends(require_scope("attestations")),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Server-sent events over the change log.

    `Last-Event-ID` is honored on reconnect, so a dropped connection resumes
    from the last change the client actually received rather than replaying from
    zero or silently skipping the gap.
    """
    resume = since
    last_event_id = request.headers.get("last-event-id")
    if last_event_id and last_event_id.isdigit():
        resume = int(last_event_id)

    generator = feed_mod.stream_events(
        SessionLocal, vendor_id, resume, settings.public_base_url.rstrip("/")
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/subscriptions")
def list_subscriptions(
    vendor_id: str,
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
) -> dict:
    """The caller's own subscriptions. Scoped to the access key that created
    them — one customer never sees another's endpoints."""
    subs = db.scalars(
        select(OscalSubscription).where(
            OscalSubscription.vendor_id == vendor_id,
            OscalSubscription.access_key_id == ctx.key.id,
        )
    ).all()
    return {"vendor_id": vendor_id, "subscriptions": [_subscription_out(s) for s in subs]}


@router.post("/subscriptions", status_code=201)
def create_subscription(
    vendor_id: str,
    body: dict = Body(...),
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
) -> dict:
    """Register a webhook for this vendor's OSCAL changes.

    The subscription is bound to the access key that created it: revoking or
    expiring the key stops delivery, so access and notification never drift
    apart.
    """
    url = (body.get("url") or "").strip()
    if not url.startswith("https://") and not url.startswith("http://localhost"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "url must be https (http is accepted only for localhost during development)",
        )
    models = body.get("models") or []
    unknown = [m for m in models if m not in oscal_mod.VENDOR_MODELS]
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"unknown model(s): {', '.join(unknown)}"
        )
    fmt = (body.get("format") or "json").lower()
    if fmt not in oscal_mod.FORMATS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unsupported format: {fmt}")

    sub = OscalSubscription(
        id=new_id("sub", 10),
        vendor_id=vendor_id,
        url=url,
        secret=body.get("secret"),
        models=models,
        format=fmt,
        subscriber_domain=ctx.key.requester_domain,
        access_key_id=ctx.key.id,
        last_cursor=feed_mod.current_cursor(db, vendor_id),
    )
    db.add(sub)
    db.commit()
    audit(
        db,
        vendor_id,
        "oscal.subscribe",
        access_key_id=ctx.key.id,
        actor=ctx.key.requester_domain,
        target=sub.id,
        detail=url,
    )
    return _subscription_out(sub)


@router.delete("/subscriptions/{subscription_id}", status_code=204)
def delete_subscription(
    vendor_id: str,
    subscription_id: str,
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
) -> Response:
    sub = db.get(OscalSubscription, subscription_id)
    if sub is None or sub.vendor_id != vendor_id or sub.access_key_id != ctx.key.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "subscription not found")
    db.delete(sub)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _subscription_out(sub: OscalSubscription) -> dict:
    return {
        "id": sub.id,
        "vendor_id": sub.vendor_id,
        "url": sub.url,
        "models": sub.models or [],
        "format": sub.format,
        "status": sub.status,
        "last_cursor": sub.last_cursor,
        "last_status": sub.last_status,
        "failures": sub.failures,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


# --- Import (owner) ----------------------------------------------------------


@router.post("/import")
def import_oscal(
    vendor_id: str,
    background: BackgroundTasks,
    body: dict = Body(...),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Populate a trust center from an OSCAL document.

    Owner-authenticated, and a dry run by default: `{"document": {...}}` returns
    the plan and changes nothing. Pass `"apply": true` to write it, and
    `"mode": "replace"` to make claims and controls match the document exactly
    instead of merging.
    """
    document = body.get("document")
    if document is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "body must contain a 'document'")
    mode = (body.get("mode") or "merge").lower()
    if mode not in ("merge", "replace"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "mode must be 'merge' or 'replace'")

    plan = oscal_mod.plan_import(document)
    if not body.get("apply"):
        return {"applied": False, "dry_run": True, "plan": plan.as_dict()}

    result = oscal_mod.apply_import(db, vendor, plan, mode=mode)
    change = feed_mod.record_change(
        db,
        vendor_id,
        "oscal.imported",
        subject=plan.model,
        detail={"mode": mode, "applied": result["applied"]},
    )
    background.add_task(
        _fan_out, vendor_id, change.sequence, settings.public_base_url.rstrip("/")
    )
    audit(
        db,
        vendor_id,
        "oscal.import",
        actor="owner",
        target=plan.model,
        detail=json.dumps(result["applied"]),
    )
    return {"applied": True, "dry_run": False, "plan": plan.as_dict(), "result": result}


def _fan_out(vendor_id: str, sequence: int, network_url: str) -> None:
    """Deliver a recorded change to subscribers, in its own session.

    Background tasks outlive the request's session, so this opens a fresh one
    and re-reads the change rather than holding a detached instance.
    """
    from ..models import OscalChange

    with SessionLocal() as db:
        change = db.scalar(
            select(OscalChange).where(
                OscalChange.vendor_id == vendor_id, OscalChange.sequence == sequence
            )
        )
        if change is None:
            return
        feed_mod.fan_out(db, vendor_id, change, network_url)


# --- One route per model (registered last so /bundle, /changes etc. win) ------


@router.get("/{model}")
def oscal_model(
    vendor_id: str,
    model: str,
    format: str = Query("json", description="json | yaml | xml"),
    framework: str | None = Query(None, description="Comma-separated framework ids"),
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    """One OSCAL model for this vendor, at this instant.

    `model` accepts the OSCAL name (`component-definition`) or a short alias
    (`cdef`, `ssp`, `poam`).
    """
    resolved = oscal_mod.resolve_model(model)
    if resolved not in oscal_mod.VENDOR_MODELS:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"unknown OSCAL model '{model}'. Available: {', '.join(oscal_mod.VENDOR_MODELS)}",
        )
    audit(
        db,
        vendor_id,
        f"read.oscal.{resolved}",
        access_key_id=ctx.key.id,
        actor=ctx.key.requester_domain,
    )
    document = oscal_mod.build(
        resolved, _context(ctx, settings), frameworks=_frameworks(framework)
    )
    return _respond(document, format)
