from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..deps import get_storage
from ..frameworks import FRAMEWORKS, map_claims
from ..models import Artifact, ArtifactVersion, Vendor
from ..security import KeyContext, require_scope
from ..services import audit, build_attestations, build_manifest, freshness_for
from ..signing import get_signer
from ..storage import Storage

router = APIRouter(prefix="/v1/vendors/{vendor_id}", tags=["read"])


def _artifact_link(ctx, artifact, version, storage, settings) -> dict:
    """Build a signed download link, applying per-download PDF watermarking when the
    vendor enables it. Watermarking changes the bytes, so both the watermarked sha256
    and the original sha256 are returned."""
    from datetime import UTC, datetime

    from ..watermark import is_pdf, stamp_pdf

    base = {"id": artifact.id, "version": version, "expires_in": settings.signed_url_ttl_seconds}
    if not ctx.vendor.watermark_downloads:
        url = storage.presign_get(artifact.storage_key, filename=f"{artifact.id}-v{version}")
        return {**base, "sha256": artifact.sha256, "url": url, "watermarked": False}

    data = storage.get(artifact.storage_key)
    if not is_pdf(data, artifact.content_type):
        url = storage.presign_get(artifact.storage_key, filename=f"{artifact.id}-v{version}")
        return {**base, "sha256": artifact.sha256, "url": url, "watermarked": False}

    issued_at = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    # Tiled mark = the requester's organization; footer = full identity + timestamp.
    org = ctx.key.requester_domain
    who = ctx.key.requester_name or org
    footer = f"Confidential · provided to {who} ({org}) · {issued_at}"
    stamped = stamp_pdf(data, org, footer)
    import hashlib

    # Deterministic key by (artifact, version, requester, day) so repeated downloads
    # overwrite one blob instead of accumulating a new file on every request. Bounds
    # storage growth on the watermark path (the stamp only varies to the minute, but
    # keying by day keeps one blob per requester per day - good enough to deter leaks).
    day = datetime.now(UTC).strftime("%Y%m%d")
    fingerprint = hashlib.sha256(
        f"{ctx.key.requester_domain}|{day}".encode()
    ).hexdigest()[:16]
    wm_key = f"{ctx.vendor.id}/{artifact.id}/_wm/v{version}-{fingerprint}.pdf"
    storage.put(wm_key, stamped, "application/pdf")
    url = storage.presign_get(wm_key, filename=f"{artifact.id}-v{version}.pdf")
    return {
        **base,
        "sha256": hashlib.sha256(stamped).hexdigest(),
        "original_sha256": artifact.sha256,
        "url": url,
        "watermarked": True,
    }


def signed_json(data: dict) -> Response:
    """Serialize once and attach an Ed25519 signature header over the exact bytes."""
    body = json.dumps(data, separators=(",", ":"), sort_keys=True).encode()
    signer = get_signer()
    return Response(
        content=body,
        media_type="application/json",
        headers={"X-TrustMCP-Signature": signer.sign(body), "X-TrustMCP-Key-Id": signer.key_id},
    )


@router.get("/manifest")
def get_manifest(
    vendor_id: str,
    ctx: KeyContext = Depends(require_scope("manifest")),
    db: Session = Depends(get_db),
):
    audit(db, vendor_id, "read.manifest", access_key_id=ctx.key.id, actor=ctx.key.requester_domain)
    return signed_json(build_manifest(ctx.vendor))


@router.get("/attestations")
def get_attestations(
    vendor_id: str,
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
):
    audit(
        db, vendor_id, "read.attestations", access_key_id=ctx.key.id, actor=ctx.key.requester_domain
    )
    return signed_json(build_attestations(ctx.vendor))


@router.get("/attestations/mapped")
def get_attestations_mapped(
    vendor_id: str,
    framework: str = Query(...),
    ctx: KeyContext = Depends(require_scope("attestations")),
):
    """Map this vendor's claims onto a control framework (soc2 / nist_800_53 / iso_27001)."""
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown framework: {framework}")
    claims = build_attestations(ctx.vendor)["claims"]
    return {"vendor_id": vendor_id, **map_claims(framework, claims)}


@router.get("/attestations/oscal")
def get_attestations_oscal(
    vendor_id: str,
    framework: str = Query("soc2"),
    ctx: KeyContext = Depends(require_scope("attestations")),
    settings: Settings = Depends(get_settings),
):
    """Export the vendor's claims as an OSCAL component definition.

    Kept at its original path for existing consumers. The full OSCAL surface —
    every model, three formats, and the continuous change feed — lives under
    `/v1/vendors/{vendor_id}/oscal/`.
    """
    from ..oscal import component_definition, from_vendor, supported

    if framework not in supported():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown framework: {framework}")
    return component_definition(from_vendor(ctx.vendor, settings), [framework])


@router.get("/graph")
def get_subprocessor_graph(
    vendor_id: str,
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
):
    """nth-party graph: subprocessors, linked to TrustMCP vendors when their domain matches a
    published profile. Lets an agent traverse the supply chain."""
    edges = []
    for s in ctx.vendor.subprocessors:
        linked = None
        if s.domain:
            d = s.domain.strip().lower()
            for v in db.scalars(select(Vendor).where(Vendor.published_at.isnot(None))).all():
                if d in [x.lower() for x in (v.domains or [])]:
                    linked = {"vendor_id": v.id, "legal_name": v.legal_name, "mark": v.mark_status}
                    break
        edges.append(
            {
                "name": s.name,
                "purpose": s.purpose,
                "location": s.location,
                "domain": s.domain,
                "category": s.category,
                "logo_url": s.logo_url,
                "linked_vendor": linked,
            }
        )
    return {"vendor_id": vendor_id, "subprocessors": edges}


@router.get("/subprocessors")
def get_subprocessors(
    vendor_id: str,
    ctx: KeyContext = Depends(require_scope("attestations")),
    db: Session = Depends(get_db),
):
    audit(
        db,
        vendor_id,
        "read.subprocessors",
        access_key_id=ctx.key.id,
        actor=ctx.key.requester_domain,
    )
    return {
        "vendor_id": vendor_id,
        "subprocessors": [
            {
                "name": s.name, "purpose": s.purpose, "location": s.location,
                "domain": s.domain, "category": s.category, "logo_url": s.logo_url,
            }
            for s in ctx.vendor.subprocessors
        ],
    }


@router.get("/freshness")
def get_freshness(
    vendor_id: str,
    ctx: KeyContext = Depends(require_scope("manifest")),
    settings: Settings = Depends(get_settings),
):
    return freshness_for(ctx.vendor, settings)


@router.get("/artifacts/{artifact_id}")
def get_artifact(
    vendor_id: str,
    artifact_id: str,
    ctx: KeyContext = Depends(require_scope("artifacts")),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    allow = ctx.key.artifact_ids or []
    if allow and artifact_id not in allow:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "key not scoped to this artifact")
    if not artifact.storage_key:
        raise HTTPException(status.HTTP_409_CONFLICT, "artifact has no uploaded content")
    audit(
        db,
        vendor_id,
        "read.artifact",
        access_key_id=ctx.key.id,
        actor=ctx.key.requester_domain,
        target=artifact_id,
    )
    return _artifact_link(ctx, artifact, artifact.version, storage, settings)


@router.get("/artifacts/{artifact_id}/versions")
def get_artifact_versions(
    vendor_id: str,
    artifact_id: str,
    ctx: KeyContext = Depends(require_scope("artifacts")),
    db: Session = Depends(get_db),
):
    """Version history (metadata only) for an artifact, newest first."""
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    allow = ctx.key.artifact_ids or []
    if allow and artifact_id not in allow:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "key not scoped to this artifact")
    history = db.scalars(
        select(ArtifactVersion)
        .where(ArtifactVersion.artifact_id == artifact_id)
        .order_by(ArtifactVersion.version.desc())
    ).all()
    return {
        "artifact_id": artifact.id,
        "versions": [
            {
                "version": artifact.version,
                "sha256": artifact.sha256,
                "issued_at": artifact.issued_at.isoformat(),
                "valid_until": artifact.valid_until.isoformat() if artifact.valid_until else None,
                "current": True,
            },
            *[
                {
                    "version": v.version,
                    "sha256": v.sha256,
                    "issued_at": v.issued_at.isoformat() if v.issued_at else None,
                    "valid_until": v.valid_until.isoformat() if v.valid_until else None,
                    "current": False,
                }
                for v in history
            ],
        ],
    }


@router.get("/artifacts/{artifact_id}/versions/{version}")
def get_artifact_version_content(
    vendor_id: str,
    artifact_id: str,
    version: int,
    ctx: KeyContext = Depends(require_scope("artifacts")),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    """Signed download URL for a specific (current or archived) artifact version."""
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.vendor_id != vendor_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    allow = ctx.key.artifact_ids or []
    if allow and artifact_id not in allow:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "key not scoped to this artifact")

    if version == artifact.version:
        storage_key, sha = artifact.storage_key, artifact.sha256
    else:
        v = db.scalar(
            select(ArtifactVersion).where(
                ArtifactVersion.artifact_id == artifact_id, ArtifactVersion.version == version
            )
        )
        if v is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
        storage_key, sha = v.storage_key, v.sha256
    if not storage_key:
        raise HTTPException(status.HTTP_409_CONFLICT, "version has no content")
    url = storage.presign_get(storage_key, filename=f"{artifact.id}-v{version}")
    audit(
        db, vendor_id, "read.artifact.version",
        access_key_id=ctx.key.id, actor=ctx.key.requester_domain, target=f"{artifact_id}@{version}",
    )
    return {"id": artifact.id, "version": version, "sha256": sha, "url": url,
            "expires_in": settings.signed_url_ttl_seconds}
