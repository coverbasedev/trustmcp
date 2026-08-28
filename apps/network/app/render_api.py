"""Thin Render API client for custom-domain TLS provisioning.

When a customer's custom domain is verified, we register it on the Render web
service that serves trust centers (``POST .../custom-domains``). Render then runs
its own DNS check and issues a Let's Encrypt certificate. We don't manage ACME
ourselves — Render does — so this module is just enough of the API to register a
domain and read back its verification/cert status.

All calls are best-effort and guarded by ``settings.render_enabled``; callers must
tolerate :class:`RenderError` and a fully-unconfigured deployment (the custom-domain
flow still works, it just reports honest "blocked"/"provisioning" status without
requesting a cert). Docs: https://api-docs.render.com/reference/create-custom-domain
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class RenderError(RuntimeError):
    """A Render API call failed (non-2xx, network error, or misconfiguration)."""


def _base(settings: Settings) -> str:
    root = settings.render_api_base.rstrip("/")
    return f"{root}/v1/services/{settings.render_service_id}/custom-domains"


def _headers(settings: Settings) -> dict[str, str]:
    if not settings.render_enabled:
        raise RenderError("Render API is not configured (render_api_key/service_id)")
    return {
        "Authorization": f"Bearer {settings.render_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _normalize_one(d: dict[str, Any]) -> dict[str, Any]:
    # List items wrap each record as {"customDomain": {...}}; create/get return it flat.
    inner = d.get("customDomain") if isinstance(d.get("customDomain"), dict) else d
    return {
        "id": inner.get("id"),
        "name": inner.get("name"),
        # Render reports "verified" once DNS points at the service; the managed cert
        # follows shortly after. We surface it but treat live HTTPS as the real signal.
        "verification_status": inner.get("verificationStatus") or inner.get("verification_status"),
    }


def _normalize(obj: Any, name: str | None = None) -> dict[str, Any]:
    """Coerce a Render custom-domain response into a flat record. Render is
    inconsistent: create returns a *list*, get-one returns a dict, list returns a list
    of ``{"customDomain": …}`` wrappers. Accept all shapes, and when a target ``name``
    is given prefer the matching entry over the first."""
    items = obj if isinstance(obj, list) else [obj]
    records = [_normalize_one(d) for d in items if isinstance(d, dict)]
    if name:
        target = name.rstrip(".").lower()
        for rec in records:
            if (rec.get("name") or "").rstrip(".").lower() == target:
                return rec
    return records[0] if records else {"id": None, "name": name, "verification_status": None}


def get_custom_domain(settings: Settings, name: str) -> dict[str, Any] | None:
    """Return the registered domain (normalized) or ``None`` if not registered yet."""
    try:
        r = httpx.get(f"{_base(settings)}/{name}", headers=_headers(settings), timeout=10)
    except httpx.HTTPError as e:  # pragma: no cover - network failure path
        raise RenderError(f"render get failed: {e}") from e
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        raise RenderError(f"render get returned {r.status_code}: {r.text[:200]}")
    return _normalize(r.json(), name)


def add_custom_domain(settings: Settings, name: str) -> dict[str, Any]:
    """Register ``name`` on the Render service so Render issues its certificate.
    Idempotent: if the domain already exists, returns the existing record."""
    try:
        r = httpx.post(
            _base(settings), headers=_headers(settings), json={"name": name}, timeout=10
        )
    except httpx.HTTPError as e:  # pragma: no cover - network failure path
        raise RenderError(f"render add failed: {e}") from e
    if r.status_code in (200, 201):
        return _normalize(r.json(), name)
    # Already registered — Render returns 409 (or 400 mentioning it). Fall back to GET.
    if r.status_code in (400, 409):
        existing = get_custom_domain(settings, name)
        if existing:
            return existing
    raise RenderError(f"render add returned {r.status_code}: {r.text[:200]}")


def verify_custom_domain(settings: Settings, name: str) -> dict[str, Any]:
    """Ask Render to (re)run DNS verification, which kicks off cert issuance once the
    domain resolves to the service. Returns the (normalized) post-verify status."""
    try:
        r = httpx.post(
            f"{_base(settings)}/{name}/verify", headers=_headers(settings), timeout=10
        )
    except httpx.HTTPError as e:  # pragma: no cover - network failure path
        raise RenderError(f"render verify failed: {e}") from e
    if r.status_code >= 400:
        raise RenderError(f"render verify returned {r.status_code}: {r.text[:200]}")
    # The verify endpoint may return an empty body; fall back to a fresh GET.
    if r.content:
        return _normalize(r.json(), name)
    existing = get_custom_domain(settings, name)
    return existing or {"id": None, "name": name, "verification_status": None}


def ensure_custom_domain(settings: Settings, name: str) -> dict[str, Any]:
    """Register the domain (idempotent) and trigger verification/issuance. Returns the
    normalized Render status. High-level entry point used by the verify endpoint and
    the cert-provisioning poller."""
    record = add_custom_domain(settings, name)
    try:
        return verify_custom_domain(settings, name)
    except RenderError:
        # Verification can lag right after creation; the poller will retry. Still
        # report what we have so the caller can persist the Render domain id.
        return record
