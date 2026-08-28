"""Docusign Connect webhook: receives envelope status updates and syncs them onto
the matching Agreement (submitted -> sent -> signed/declined/voided).

Public endpoint, optionally authenticated via Docusign Connect's HMAC header."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..esign import map_envelope_status, resolve_config
from ..models import Agreement, Vendor
from ..services import audit

log = logging.getLogger("trustmcp.esign")

router = APIRouter(prefix="/v1/esign", tags=["esign"])


def _verify_hmac(key: str, raw: bytes, header: str | None) -> bool:
    if not key:
        return True  # verification not configured - accept
    if not header:
        return False
    digest = hmac.new(key.encode(), raw, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, header)


def _extract(payload: dict) -> tuple[str | None, str | None]:
    """Pull (envelope_id, status) from the Connect JSON payload across known shapes."""
    data = payload.get("data") or payload
    envelope_id = (
        data.get("envelopeId")
        or payload.get("envelopeId")
        or (data.get("envelopeSummary") or {}).get("envelopeId")
    )
    env_status = (
        (data.get("envelopeSummary") or {}).get("status")
        or data.get("status")
        or payload.get("status")
    )
    return envelope_id, env_status


@router.post("/webhook")
async def docusign_webhook(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    raw = await request.body()
    try:
        payload = await request.json()
    except Exception:
        return Response(status_code=status.HTTP_400_BAD_REQUEST)

    envelope_id, env_status = _extract(payload)

    # The HMAC key is per-vendor (each trust center signs from its own Docusign
    # account), so locate the matching agreement/vendor first, then verify the
    # signature against that vendor's effective Connect key. The HMAC is computed
    # over the original raw bytes, so finding the agreement first is safe.
    agreement = (
        db.scalar(select(Agreement).where(Agreement.envelope_id == envelope_id))
        if envelope_id
        else None
    )
    vendor = db.get(Vendor, agreement.vendor_id) if agreement is not None else None
    hmac_key = resolve_config(settings, vendor).connect_hmac_key
    if not _verify_hmac(hmac_key, raw, request.headers.get("X-DocuSign-Signature-1")):
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    mapped = map_envelope_status(env_status)
    if not envelope_id or not mapped:
        return {"status": "ignored"}
    if agreement is None:
        return {"status": "unknown_envelope"}
    # Only advance status; never regress. Docusign Connect can deliver events out of
    # order or retry an older one, which would otherwise flip a signed DPA back to
    # "sent". Terminal states (signed/declined/voided) are sticky.
    if not _advances(agreement.status, mapped):
        return {"status": "ignored", "agreement_status": agreement.status}
    agreement.status = mapped
    db.add(agreement)
    db.commit()
    audit(
        db, agreement.vendor_id, "agreement.status", target=agreement.id, detail=mapped
    )
    return {"status": "ok", "agreement_status": mapped}


# Status progression rank - a higher rank may overwrite a lower one, never the reverse.
_RANK = {"submitted": 0, "sent": 1, "signed": 2, "declined": 2, "voided": 2}


def _advances(current: str, incoming: str) -> bool:
    cur = _RANK.get(current, 0)
    inc = _RANK.get(incoming, 0)
    # Don't move off a terminal state, and don't go backwards.
    if cur >= 2:
        return False
    return inc > cur
