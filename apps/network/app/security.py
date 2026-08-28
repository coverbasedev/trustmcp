from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db
from .models import AccessKey, Vendor


def hash_secret(secret: str) -> str:
    """SHA-256 hash for at-rest storage of keys/tokens. Tokens are high-entropy
    random strings, so a fast hash with no salt is appropriate (and lets us look
    keys up by hash)."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def generate_owner_token() -> str:
    return f"tmcp_owner_{secrets.token_urlsafe(32)}"


def generate_access_key(settings: Settings) -> str:
    return f"{settings.key_prefix}_{secrets.token_urlsafe(32)}"


# --- Auth dependencies -------------------------------------------------------


def require_service_token(
    x_trustmcp_service_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Used by the web backend to create/manage vendors on behalf of users."""
    if not x_trustmcp_service_token or not secrets.compare_digest(
        x_trustmcp_service_token, settings.service_token
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service token")


def require_owner(
    vendor_id: str = Path(...),
    x_trustmcp_owner_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Vendor:
    """Vendor owner authentication for trust-center management endpoints."""
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor not found")
    if not x_trustmcp_owner_token or not secrets.compare_digest(
        hash_secret(x_trustmcp_owner_token), vendor.owner_token_hash
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid owner token")
    return vendor


class KeyContext:
    def __init__(self, key: AccessKey, vendor: Vendor):
        self.key = key
        self.vendor = vendor


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def authenticate_key(
    vendor_id: str = Path(...),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> KeyContext:
    token = _bearer_token(authorization)
    key = db.scalar(select(AccessKey).where(AccessKey.key_hash == hash_secret(token)))
    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid access key")
    if key.vendor_id != vendor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "key not valid for this vendor")
    if key.status == "revoked":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "access key revoked")
    expires = key.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires < datetime.now(UTC):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "access key expired")
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vendor not found")
    return KeyContext(key=key, vendor=vendor)


def require_scope(scope: str):
    """Dependency factory enforcing a scope on the authenticated access key."""

    def _dep(
        ctx: KeyContext = Depends(authenticate_key),
        db: Session = Depends(get_db),
    ) -> KeyContext:
        if scope not in (ctx.key.scope or []):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"key missing required scope: {scope}"
            )
        ctx.key.last_used_at = datetime.now(UTC)
        db.add(ctx.key)
        db.commit()
        return ctx

    return _dep
