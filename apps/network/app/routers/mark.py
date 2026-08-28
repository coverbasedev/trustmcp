from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DomainVerification, Vendor
from ..ratelimit import rate_limit

router = APIRouter(prefix="/v1/mark", tags=["mark"])


@router.get("/{vendor_id}", dependencies=[Depends(rate_limit("mark"))])
def get_mark(vendor_id: str, db: Session = Depends(get_db)):
    """Public, unauthenticated. Consumers verify the agent-ready mark here rather
    than trusting a self-asserted `mark` field in the discovery record."""
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor not found")
    verified = db.scalars(
        select(DomainVerification).where(
            DomainVerification.vendor_id == vendor_id, DomainVerification.verified.is_(True)
        )
    ).all()
    return {
        "vendor_id": vendor.id,
        "legal_name": vendor.legal_name,
        "mark": vendor.mark_status,
        "verified_domains": [d.domain for d in verified],
        "issued": vendor.mark_status == "agent-ready",
        "revoked": vendor.mark_status == "revoked",
    }
