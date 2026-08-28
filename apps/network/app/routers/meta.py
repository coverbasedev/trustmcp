from __future__ import annotations

from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..frameworks import list_frameworks
from ..security import require_service_token
from ..signing import get_signer

router = APIRouter(prefix="/v1", tags=["meta"])


@router.get("/meta/diagnostics", dependencies=[Depends(require_service_token)])
def diagnostics(settings: Settings = Depends(get_settings)):
    """Operator self-check: which optional integrations are configured.

    Service-token gated and returns only booleans/identifiers (never secret
    values), so it's safe for a deployment smoke test. `production_blockers` is
    the same list the app refuses to boot on when TRUSTMCP_ENVIRONMENT=production."""
    dialect = settings.database_url.split(":", 1)[0].split("+", 1)[0] or "unknown"
    return {
        "environment": settings.environment,
        "database": dialect,  # "postgresql" | "sqlite" | …
        "signing_key_stable": bool(settings.signing_private_key),
        "smtp_configured": settings.use_smtp,
        "ask_enabled": settings.ask_enabled,  # Anthropic "Ask a question" widget
        "ask_model": settings.ask_model,
        "s3_configured": settings.use_s3,
        "sentry_configured": bool(settings.sentry_dsn),
        "web_base_url_set": bool(settings.web_base_url),
        "production_blockers": settings.validate_for_production(),
        "production_warnings": settings.production_warnings(),
    }


@router.get("/network/key")
def network_key():
    """The network's Ed25519 public key for verifying signed responses."""
    signer = get_signer()
    return {"alg": "Ed25519", "public_key": signer.public_key_b64, "key_id": signer.key_id}


@router.get("/frameworks")
def frameworks():
    """Control frameworks available for claim mapping."""
    return {"frameworks": list_frameworks()}
