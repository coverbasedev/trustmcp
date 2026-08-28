from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import crm
from .config import Settings
from .ids import key_id as new_key_id
from .models import AccessKey, AuditLog, Vendor
from .security import generate_access_key, hash_secret


def mint_key(
    db: Session,
    vendor: Vendor,
    *,
    requester_name: str,
    requester_domain: str,
    scope: list[str],
    settings: Settings,
    artifact_ids: list[str] | None = None,
    ttl_days: int | None = None,
) -> tuple[AccessKey, str]:
    """Create a granted access key and return (key, plaintext secret)."""
    secret = generate_access_key(settings)
    key = AccessKey(
        id=new_key_id(),
        vendor_id=vendor.id,
        key_hash=hash_secret(secret),
        display_hint=secret[-4:],
        requester_name=requester_name,
        requester_domain=requester_domain,
        scope=scope,
        artifact_ids=artifact_ids or [],
        status="granted",
        expires_at=datetime.now(UTC) + timedelta(days=ttl_days or settings.key_ttl_days),
    )
    db.add(key)
    return key, secret


def recompute_mark(vendor: Vendor, db: Session) -> str:
    """Recompute mark_status from verified domains, respecting the sticky 'revoked'
    state. A vendor revoked by the operator stays revoked until explicitly
    reinstated - re-verifying a domain must not silently re-grant the mark."""
    from .models import DomainVerification

    if vendor.mark_status == "revoked":
        return "revoked"
    has_verified = (
        db.scalar(
            select(DomainVerification.id).where(
                DomainVerification.vendor_id == vendor.id,
                DomainVerification.verified.is_(True),
            )
        )
        is not None
    )
    vendor.mark_status = "agent-ready" if has_verified else "unverified"
    return vendor.mark_status


def auto_release_reason(
    vendor: Vendor, requester_domain: str, *, has_contract: bool, settings: Settings
) -> str | None:
    """Decide whether a request should be auto-granted. Returns a reason string or None."""
    domain = requester_domain.strip().lower()
    allow = [d.strip().lower() for d in (vendor.auto_approve_domains or [])]
    if domain in allow:
        return "domain-allowlist"
    if vendor.auto_approve_on_contract and has_contract:
        return "contract-upload"
    if vendor.auto_approve_crm:
        res = crm.verify_relationship(settings, requester_domain, vendor)
        if res.get("found") is True:
            return f"crm:{res.get('provider')}"
    return None


def recommend(vendor: Vendor, req, settings: Settings) -> dict:
    """Advisory recommendation for a pending request (the 'approval agent').

    Deterministic, rules-based: combines CRM relationship, contract proof, NDA
    acceptance, and the domain allowlist into a suggested decision. Advisory only -
    a human (or agent) still approves."""
    reasons: list[str] = []
    positives = 0
    cautions = 0

    domain = req.requester_domain.strip().lower()
    if domain in [d.strip().lower() for d in (vendor.auto_approve_domains or [])]:
        reasons.append("domain is on the auto-approve allowlist")
        positives += 2

    if req.contract_storage_key:
        reasons.append("contract uploaded as proof of agreement")
        positives += 1

    if req.nda_accepted_at:
        reasons.append("NDA accepted")
        positives += 1

    crm_res = crm.verify_relationship(settings, req.requester_domain, vendor)
    if crm_res.get("configured"):
        if crm_res.get("found") is True:
            reasons.append(f"existing customer in {crm_res.get('provider')}")
            positives += 2
        elif crm_res.get("found") is False:
            reasons.append(f"no matching account in {crm_res.get('provider')}")
            cautions += 1

    if cautions and positives == 0:
        level = "caution"
    elif positives >= 2:
        level = "approve"
    elif positives >= 1:
        level = "review"
    else:
        level = "review"
    if not reasons:
        reasons.append("no corroborating signals - review manually")
    return {"level": level, "reasons": reasons}


def insights(db: Session, vendor: Vendor) -> dict:
    """Usage analytics aggregated from the audit log, keys, and requests."""
    from collections import Counter

    from .models import AccessKey, AuditLog, KeyRequest

    now = datetime.now(UTC)
    reqs = db.scalars(select(KeyRequest).where(KeyRequest.vendor_id == vendor.id)).all()
    req_status = Counter(r.status for r in reqs)
    auto = sum(1 for r in reqs if r.auto_approved)

    keys = db.scalars(select(AccessKey).where(AccessKey.vendor_id == vendor.id)).all()
    active = 0
    for k in keys:
        exp = k.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=UTC)
        if k.status == "granted" and exp > now:
            active += 1
    revoked = sum(1 for k in keys if k.status == "revoked")

    rows = db.scalars(select(AuditLog).where(AuditLog.vendor_id == vendor.id)).all()
    read_actions = ("read.artifact", "read.artifact.version")
    reads_by_artifact = Counter(
        r.target for r in rows if r.action in read_actions and r.target
    )
    reads_by_requester = Counter(
        r.actor for r in rows if r.action.startswith("read.") and r.actor
    )
    recent = sorted(rows, key=lambda r: r.created_at, reverse=True)[:15]

    return {
        "vendor_id": vendor.id,
        "requests": {
            "total": len(reqs),
            "pending": req_status.get("pending", 0),
            "granted": req_status.get("granted", 0),
            "denied": req_status.get("denied", 0),
            "auto_approved": auto,
        },
        "keys": {"total": len(keys), "active": active, "revoked": revoked},
        "reads": {
            "total": sum(1 for r in rows if r.action.startswith("read.")),
            "by_artifact": [
                {"artifact_id": k, "reads": v} for k, v in reads_by_artifact.most_common(10)
            ],
            "by_requester": [
                {"requester": k, "reads": v} for k, v in reads_by_requester.most_common(10)
            ],
        },
        "recent_activity": [
            {
                "action": r.action,
                "actor": r.actor,
                "target": r.target,
                "at": r.created_at.isoformat(),
            }
            for r in recent
        ],
    }


def freshness_for(vendor: Vendor, settings: Settings, today: date | None = None) -> dict:
    today = today or datetime.now(UTC).date()
    window = settings.expiring_window_days
    items = []
    for a in sorted(vendor.artifacts, key=lambda x: x.id):
        if a.valid_until is None:
            items.append({"id": a.id, "status": "valid", "valid_until": None, "days_left": None})
            continue
        days_left = (a.valid_until - today).days
        if days_left < 0:
            status = "expired"
        elif days_left <= window:
            status = "expiring"
        else:
            status = "valid"
        items.append(
            {
                "id": a.id,
                "status": status,
                "valid_until": a.valid_until.isoformat(),
                "days_left": days_left,
            }
        )
    return {
        "vendor_id": vendor.id,
        "checked_at": datetime.now(UTC).isoformat(),
        "items": items,
    }


def build_manifest(vendor: Vendor) -> dict:
    artifacts = []
    for a in sorted(vendor.artifacts, key=lambda x: x.issued_at, reverse=True):
        entry = {
            "id": a.id,
            "type": a.type,
            "issued_at": a.issued_at.isoformat(),
            "valid_until": a.valid_until.isoformat() if a.valid_until else None,
            "sha256": a.sha256,
            "access": a.access,
            "version": a.version,
            "uri": f"/v1/vendors/{vendor.id}/artifacts/{a.id}",
        }
        if a.title:
            entry["title"] = a.title
        if a.format:
            entry["format"] = a.format
        if a.scope:
            entry["scope"] = a.scope
        artifacts.append(entry)
    return {
        "schema_version": "0.1",
        "vendor": {
            "id": vendor.id,
            "legal_name": vendor.legal_name,
            "domains": vendor.domains or [],
            "product": vendor.product,
        },
        "published_at": (vendor.published_at or vendor.created_at).isoformat()
        if (vendor.published_at or vendor.created_at)
        else None,
        "artifacts": artifacts,
        "attestations_uri": f"/v1/vendors/{vendor.id}/attestations",
        "subprocessors_uri": f"/v1/vendors/{vendor.id}/subprocessors",
    }


def build_attestations(vendor: Vendor) -> dict:
    claims = [
        {"key": c.key, "value": c.value, "evidence": c.evidence or []}
        for c in sorted(vendor.claims, key=lambda x: x.key)
    ]
    generated = vendor.attestations_generated_at or vendor.created_at
    return {
        "schema_version": "0.1",
        "vendor_id": vendor.id,
        "generated_at": generated.isoformat() if generated else None,
        "claims": claims,
    }


def audit(
    db: Session,
    vendor_id: str,
    action: str,
    *,
    access_key_id: str | None = None,
    actor: str | None = None,
    target: str | None = None,
    detail: str | None = None,
) -> None:
    db.add(
        AuditLog(
            vendor_id=vendor_id,
            access_key_id=access_key_id,
            actor=actor,
            action=action,
            target=target,
            detail=detail,
        )
    )
    db.commit()


# --- Public resource presentation --------------------------------------------


def resource_display_for(vendor: Vendor) -> dict:
    """The vendor's resource-display settings, merged over the defaults.

    Stored as a partial JSON blob so a vendor who set one field years ago still
    picks up new defaults for the rest rather than being frozen at whatever the
    schema looked like the day they saved.
    """
    from .schemas import ResourceDisplay

    stored = vendor.resource_display or {}
    known = ResourceDisplay().model_dump()
    return {**known, **{k: v for k, v in stored.items() if k in known}}


def _artifact_sort_key(artifact) -> tuple:
    """Owner-set position first, then newest issue date, then id.

    Falling through to the date keeps the old behavior for every vendor who has
    never touched ordering: they all sit at position 0, so the list still reads
    newest-first.
    """
    return (artifact.position or 0, -artifact.issued_at.toordinal(), artifact.id)


def public_resources(vendor: Vendor, freshness_map: dict) -> dict:
    """The public resource list, laid out the way the vendor configured.

    Returns both a flat `artifacts` list (unchanged shape, so existing consumers
    and the current trust-center UI keep working) and a `groups` structure that
    a renderer can walk directly.
    """
    display = resource_display_for(vendor)
    visible = [a for a in vendor.artifacts if not a.hidden]

    def entry(a) -> dict:
        row = {
            "id": a.id,
            "type": a.type,
            "title": a.title,
            "description": a.description,
            "category": a.category,
            "issued_at": a.issued_at.isoformat(),
            "valid_until": a.valid_until.isoformat() if a.valid_until else None,
            "access": a.access,
            "freshness": freshness_map.get(a.id, {}).get("status"),
            "product_ids": a.product_ids or [],
            "featured": a.featured,
            "position": a.position or 0,
            "source": a.source or "upload",
        }
        if display["show_hashes"]:
            row["sha256"] = a.sha256
        return row

    ordered = sorted(visible, key=_artifact_sort_key)
    grouped: dict[str, list[dict]] = {}
    for a in ordered:
        key = _group_key(a, display["group_by"], vendor)
        grouped.setdefault(key, []).append(entry(a))

    # Named categories first in the order the vendor set; the rest alphabetically
    # after them, so a newly added category shows up instead of vanishing.
    preferred = [c for c in display["category_order"] if c in grouped]
    remaining = sorted(k for k in grouped if k not in preferred)
    groups = [{"title": key, "resources": grouped[key]} for key in [*preferred, *remaining]]

    return {
        "display": display,
        "artifacts": [entry(a) for a in ordered],
        "featured": [entry(a) for a in ordered if a.featured] if display["feature_band"] else [],
        "groups": groups,
        "hidden_count": len(vendor.artifacts) - len(visible),
    }


def _group_key(artifact, group_by: str, vendor: Vendor) -> str:
    if group_by == "none":
        return "Resources"
    if group_by == "type":
        return artifact.type
    if group_by == "product":
        names = {p.get("id"): p.get("name") for p in (vendor.products or [])}
        ids = artifact.product_ids or []
        if not ids:
            return "All products"
        return ", ".join(names.get(pid, pid) for pid in ids)
    return artifact.category or "Other"
