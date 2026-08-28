from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ask import answer_question
from ..config import Settings, get_settings
from ..db import SessionLocal, get_db
from ..deps import get_storage
from ..esign import esign_enabled_for, send_dpa_envelope
from ..ids import agreement_id as new_agreement_id
from ..mailer import send_email
from ..models import (
    Agreement,
    Artifact,
    DomainVerification,
    KeyRequest,
    Subscriber,
    Vendor,
)
from ..ratelimit import rate_limit
from ..schemas import AgreementIn, AskIn, ReclaimIn, SubscribeIn
from ..services import audit, freshness_for, mint_key, public_resources
from ..storage import Storage

router = APIRouter(prefix="/v1/vendors/{vendor_id}", tags=["public"])

# Separate, vendor-id-free router for resolving a custom domain (e.g. trust.acme.com)
# to the vendor that owns it. The web app's middleware calls this to serve each
# vendor's trust center on their own connected domain — generic for every vendor.
domain_router = APIRouter(prefix="/v1", tags=["public"])


@domain_router.get("/custom-domains/resolve", dependencies=[Depends(rate_limit("public"))])
def resolve_custom_domain(host: str, db: Session = Depends(get_db)):
    """Map a custom-domain hostname to its published vendor id. Only resolves domains
    that are verified/active AND whose profile is published, so unverified or
    unpublished domains can't borrow another tenant's hostname. 404 when unknown."""
    h = (host or "").strip().lower().rstrip(".")
    if not h:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown domain")
    # Generic JSON path access compiles per-dialect (json_extract on SQLite, #>> on
    # Postgres), so the same query works in tests and production.
    domain_expr = Vendor.branding["custom_domain"]["domain"].as_string()
    status_expr = Vendor.branding["custom_domain"]["status"].as_string()
    vendor = db.scalars(
        select(Vendor).where(
            Vendor.published_at.is_not(None),
            domain_expr == h,
            status_expr.in_(("verified", "active")),
        )
    ).first()
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown domain")
    return {"vendor_id": vendor.id}


@router.get("/public", dependencies=[Depends(rate_limit("public"))])
def public_profile(
    vendor_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Unauthenticated trust-center summary: branding, the agent-ready mark, and the
    *list* of available evidence (types, dates, freshness) - but no document content
    and no signed URLs. Customers see what exists, then request a scoped key to read.
    Only available once the vendor has published."""
    vendor = db.get(Vendor, vendor_id)
    if vendor is None or vendor.published_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no published profile")

    fresh = {i["id"]: i for i in freshness_for(vendor, settings)["items"]}
    # Resources are laid out the way the vendor configured: hidden ones are
    # dropped, the rest ordered and grouped. `artifacts` keeps its original flat
    # shape so existing consumers are unaffected; `resources` carries the
    # grouped structure a renderer can walk directly.
    resources = public_resources(vendor, fresh)
    artifacts = resources["artifacts"]
    verified = db.scalars(
        select(DomainVerification).where(
            DomainVerification.vendor_id == vendor_id, DomainVerification.verified.is_(True)
        )
    ).all()
    arts_by_id = {a.id: a for a in vendor.artifacts}

    def _badge_evidence(artifact_id: str | None) -> dict | None:
        a = arts_by_id.get(artifact_id) if artifact_id else None
        if a is None:
            return None
        return {"id": a.id, "title": a.title or a.type, "access": a.access}

    badges = [
        {
            "name": b.name,
            "standard": b.standard,
            "logo_url": b.logo_url,
            "evidence": _badge_evidence(b.evidence_artifact_id),
            "issued_on": b.issued_on.isoformat() if b.issued_on else None,
            "valid_until": b.valid_until.isoformat() if b.valid_until else None,
        }
        for b in sorted(vendor.badges, key=lambda x: x.position)
    ]
    controls = [
        {"category": c.category, "name": c.name, "description": c.description, "status": c.status}
        for c in sorted(vendor.controls, key=lambda x: (x.category, x.position))
    ]
    data_types = [
        {"label": d.label, "collected": d.collected}
        for d in sorted(vendor.data_types, key=lambda x: x.position)
    ]
    faqs = [
        {"question": f.question, "answer": f.answer}
        for f in sorted(vendor.faqs, key=lambda x: x.position)
    ]
    updates = [
        {
            "title": u.title,
            "body": u.body,
            "category": u.category,
            "published_at": u.published_at.isoformat() if u.published_at else None,
        }
        for u in sorted(
            vendor.updates, key=lambda x: (x.published_at or x.created_at.date()), reverse=True
        )
    ]
    subprocessors = [
        {
            "name": s.name,
            "purpose": s.purpose,
            "location": s.location,
            "domain": s.domain,
            "category": s.category,
            "logo_url": s.logo_url,
        }
        for s in vendor.subprocessors
    ]
    branding = dict(vendor.branding or {})
    # Surface the wide (horizontal lockup) logo URL stored in the branding JSON.
    branding["wide_logo_url"] = (vendor.branding or {}).get("wide_logo_url")
    return {
        "vendor": {
            "id": vendor.id,
            "legal_name": vendor.legal_name,
            "product": vendor.product,
            "products": vendor.products or [],
            "domains": vendor.domains or [],
            "branding": branding,
        },
        "mark": vendor.mark_status,
        "verified_domains": [d.domain for d in verified],
        "published_at": vendor.published_at.isoformat() if vendor.published_at else None,
        "artifacts": artifacts,
        "resources": {
            "display": resources["display"],
            "featured": resources["featured"],
            "groups": resources["groups"],
        },
        "badges": badges,
        "controls": controls,
        "controls_updated_at": (
            vendor.controls_updated_at.isoformat() if vendor.controls_updated_at else None
        ),
        "data_types": data_types,
        "subprocessors": subprocessors,
        "faqs": faqs,
        "updates": updates,
        "claim_keys": sorted({c.key for c in vendor.claims}),
        "available_scopes": ["manifest", "attestations", "artifacts"],
        "accepts_contract": vendor.auto_approve_on_contract,
        "nda_required": vendor.nda_required,
        "nda_text": vendor.nda_text if vendor.nda_required else None,
        "dpa_self_serve": vendor.dpa_self_serve,
        "dpa_intro": vendor.dpa_intro,
        "ask_enabled": settings.ask_enabled,
    }


@router.get(
    "/artifacts/{artifact_id}/public",
    dependencies=[Depends(rate_limit("public.artifact"))],
)
def public_artifact(
    vendor_id: str,
    artifact_id: str,
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    """Unauthenticated download of an artifact whose access is "public". Private
    (key_required) artifacts are never served here - request a scoped key instead."""
    vendor = db.get(Vendor, vendor_id)
    if vendor is None or vendor.published_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no published profile")
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    if artifact.access != "public":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "artifact requires an access key")
    if not artifact.storage_key:
        raise HTTPException(status.HTTP_409_CONFLICT, "artifact has no uploaded content")
    url = storage.presign_get(artifact.storage_key, filename=f"{artifact.id}-{artifact.type}")
    audit(db, vendor_id, "read.artifact.public", actor="public", target=artifact_id)
    return {
        "id": artifact.id,
        "sha256": artifact.sha256,
        "url": url,
        "content_type": artifact.content_type,
        "expires_in": settings.signed_url_ttl_seconds,
    }


def _published_or_404(db: Session, vendor_id: str) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if vendor is None or vendor.published_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no published profile")
    return vendor


def deliver_dpa_envelope(settings: Settings, vendor_id: str, agreement_id: str) -> None:
    """Background task: create + send the Docusign envelope for a submitted DPA and
    record the result. Opens its own DB session (runs after the response)."""
    db = SessionLocal()
    try:
        vendor = db.get(Vendor, vendor_id)
        agreement = db.get(Agreement, agreement_id)
        if vendor is None or agreement is None:
            return
        try:
            envelope_id = send_dpa_envelope(settings, vendor, agreement)
            agreement.envelope_id = envelope_id
            agreement.status = "sent"
            db.add(agreement)
            db.commit()
            audit(db, vendor_id, "agreement.sent", target=agreement_id, detail=envelope_id)
        except Exception as e:  # pragma: no cover - network dependent
            audit(db, vendor_id, "agreement.esign_error", target=agreement_id, detail=str(e)[:300])
    finally:
        db.close()


@router.post("/subscribe", dependencies=[Depends(rate_limit("public.subscribe"))])
def subscribe(
    body: SubscribeIn,
    vendor_id: str,
    db: Session = Depends(get_db),
):
    """Subscribe an email to this trust center's updates (idempotent)."""
    vendor = _published_or_404(db, vendor_id)
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "valid email required")
    existing = db.scalar(
        select(Subscriber).where(
            Subscriber.vendor_id == vendor.id, Subscriber.email == email
        )
    )
    if existing is None:
        db.add(Subscriber(vendor_id=vendor.id, email=email, status="subscribed"))
    else:
        existing.status = "subscribed"
        db.add(existing)
    db.commit()
    audit(db, vendor.id, "subscribe", actor=email)
    return {"status": "subscribed", "email": email}


@router.post("/ask", dependencies=[Depends(rate_limit("public.ask"))])
def ask(
    body: AskIn,
    vendor_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Answer a visitor question grounded in the published profile (AI assistant)."""
    vendor = _published_or_404(db, vendor_id)
    question = body.question.strip()
    if not question:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "question required")
    result = answer_question(vendor, question, settings)
    audit(db, vendor.id, "ask", actor="public", detail=question[:200])
    return result


@router.post("/reclaim", dependencies=[Depends(rate_limit("public.reclaim"))])
def reclaim_access(
    body: ReclaimIn,
    vendor_id: str,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Reclaim access by email. If the email previously had a granted request, mint
    a fresh scoped key for the same scope and email it (email ownership = identity
    proof). Always returns the same response to avoid leaking who has access."""
    email = body.email.strip().lower()
    vendor = _published_or_404(db, vendor_id)
    prior = db.scalars(
        select(KeyRequest)
        .where(
            KeyRequest.vendor_id == vendor.id,
            KeyRequest.requester_contact == email,
            KeyRequest.status == "granted",
        )
        .order_by(KeyRequest.created_at.desc())
    ).first()
    if prior is not None:
        key, secret = mint_key(
            db,
            vendor,
            requester_name=prior.requester_name,
            requester_domain=prior.requester_domain,
            scope=prior.scope,
            settings=settings,
            artifact_ids=prior.artifact_ids or [],
        )
        audit(db, vendor.id, "key.reclaimed", target=key.id, actor=email)
        background.add_task(
            send_email,
            settings,
            email,
            f"Your access key for {vendor.legal_name}'s trust center",
            (
                f"You requested to reclaim access to {vendor.legal_name}'s trust center.\n\n"
                f"  vendor_id: {vendor.id}\n  key: {secret}\n"
                f"  scope: {', '.join(prior.scope)}\n  expires: {key.expires_at.isoformat()}\n\n"
                f"Treat this key as a secret. If you didn't request this, ignore this email."
            ),
        )
    # Uniform response regardless of whether a match was found.
    return {"status": "ok", "message": "If that email has access, we've emailed a new key."}


@router.post("/agreements", dependencies=[Depends(rate_limit("public.agreement"))])
def submit_agreement(
    body: AgreementIn,
    vendor_id: str,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Submit a self-service agreement (e.g. DPA). Stores the submission, optionally
    subscribes the contact to updates, and notifies the vendor owner to route it to
    signature."""
    vendor = _published_or_404(db, vendor_id)
    if not vendor.dpa_self_serve:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "self-service agreements are not enabled")
    agreement = Agreement(
        id=new_agreement_id(),
        vendor_id=vendor.id,
        type=body.type,
        company_name=body.company_name,
        signer_name=body.signer_name,
        signer_email=body.signer_email,
        signer_title=body.signer_title,
        contact_details=body.contact_details,
        address=body.address or {},
        doing_business_as=body.doing_business_as,
        registration_number=body.registration_number,
        subscribe_email=body.subscribe_email,
        status="submitted",
    )
    db.add(agreement)
    if body.subscribe_email:
        sub_email = body.subscribe_email.strip().lower()
        if "@" in sub_email and not db.scalar(
            select(Subscriber).where(
                Subscriber.vendor_id == vendor.id, Subscriber.email == sub_email
            )
        ):
            db.add(Subscriber(vendor_id=vendor.id, email=sub_email, status="subscribed"))
    db.commit()
    audit(db, vendor.id, "agreement.submit", actor=body.signer_email, target=agreement.id)

    # If Docusign is configured (and a template exists), send a real signature
    # envelope to the signer in the background. Otherwise notify the owner to route
    # it manually.
    template = vendor.dpa_template_id or settings.docusign_dpa_template_id
    if esign_enabled_for(settings, vendor) and template:
        background.add_task(deliver_dpa_envelope, settings, vendor.id, agreement.id)
    elif vendor.notify_email:
        background.add_task(
            send_email,
            settings,
            vendor.notify_email,
            f"New {body.type.upper()} request for {vendor.legal_name} ({body.company_name})",
            (
                f"{body.signer_name} ({body.signer_email}) at {body.company_name} requested a "
                f"{body.type.upper()}.\nReview and send for signature in your dashboard.\n"
                f"Agreement id: {agreement.id}"
            ),
        )
    return {"status": "submitted", "id": agreement.id}
