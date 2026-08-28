from __future__ import annotations

from app.config import Settings


def test_production_validation_flags_insecure_defaults():
    s = Settings(
        environment="production",
        service_token="dev-service-token",
        signing_private_key="",
        database_url="sqlite:///./x.db",
    )
    errors = s.validate_for_production()
    assert any("SERVICE_TOKEN" in e for e in errors)
    assert any("SIGNING_PRIVATE_KEY" in e for e in errors)
    assert any("DATABASE_URL" in e for e in errors)


def test_production_validation_passes_when_configured():
    s = Settings(
        environment="production",
        service_token="a-strong-secret",
        signing_private_key="c29tZS1zZWVk",
        database_url="postgresql://user:pw@host/db",
    )
    assert s.validate_for_production() == []


def test_non_production_never_blocks():
    s = Settings(environment="development", service_token="dev-service-token")
    assert s.validate_for_production() == []
    s = Settings(environment="test", service_token="dev-service-token")
    assert s.validate_for_production() == []
