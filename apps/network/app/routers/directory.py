from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Vendor
from ..ratelimit import rate_limit

router = APIRouter(prefix="/v1/directory", tags=["directory"])


@router.get("", dependencies=[Depends(rate_limit("directory"))])
def directory(
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Public list of published, opt-in agent-ready vendors (the network directory)."""
    vendors = db.scalars(
        select(Vendor)
        .where(Vendor.published_at.isnot(None), Vendor.listed.is_(True))
        .order_by(Vendor.legal_name)
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        "count": len(vendors),
        "vendors": [
            {
                "id": v.id,
                "legal_name": v.legal_name,
                "product": v.product,
                "domains": v.domains or [],
                "mark": v.mark_status,
                "display_name": (v.branding or {}).get("display_name") or v.legal_name,
                "headline": (v.branding or {}).get("headline"),
            }
            for v in sorted(vendors, key=lambda x: x.legal_name.lower())
        ],
    }
