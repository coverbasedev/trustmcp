from __future__ import annotations

import os
import tempfile

import pytest

# Configure a throwaway environment BEFORE the app modules read settings.
_tmp = tempfile.mkdtemp(prefix="trustmcp-test-")
os.environ["TRUSTMCP_ENVIRONMENT"] = "test"
os.environ["TRUSTMCP_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["TRUSTMCP_STORAGE_LOCAL_DIR"] = f"{_tmp}/artifacts"
os.environ["TRUSTMCP_SERVICE_TOKEN"] = "test-service-token"
os.environ["TRUSTMCP_PUBLIC_BASE_URL"] = "http://testserver"
os.environ["TRUSTMCP_RATE_LIMIT_PER_MINUTE"] = "0"  # disable rate limiting in tests


@pytest.fixture(scope="session")
def service_token() -> str:
    return "test-service-token"


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.db import Base, engine, init_db
    from app.main import create_app

    # Isolate each test: drop + recreate all tables.
    Base.metadata.drop_all(bind=engine)
    init_db()
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def vendor(client, service_token):
    """Creates a vendor and returns (vendor_id, owner_token)."""
    r = client.post(
        "/v1/vendors",
        headers={"X-TrustMCP-Service-Token": service_token},
        json={"legal_name": "Acme Corp", "product": "Acme Platform", "domains": ["acme.com"]},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return body["id"], body["owner_token"]


def owner_headers(token: str) -> dict:
    return {"X-TrustMCP-Owner-Token": token}


@pytest.fixture()
def populated_vendor(client, vendor):
    """A vendor with an artifact, claims, controls, and a subprocessor, published.

    Returns `(vendor_id, owner_token, artifact_id)`. Most OSCAL assertions need
    a profile with something in it — an empty vendor exports valid but empty
    documents, which proves very little.
    """
    vid, owner = vendor
    h = owner_headers(owner)

    r = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={
            "type": "soc2_type2",
            "title": "SOC 2 Type II",
            "issued_at": "2026-01-15",
            "valid_until": "2027-01-15",
            "category": "Compliance",
        },
    )
    aid = r.json()["id"]
    client.post(
        f"/v1/vendors/{vid}/artifacts/{aid}/content",
        headers=h,
        files={"file": ("soc2.pdf", b"%PDF-1.4 report", "application/pdf")},
    )
    client.put(
        f"/v1/vendors/{vid}/attestations",
        headers=h,
        json={
            "claims": [
                {"key": "mfa.enforced", "value": True, "evidence": [aid]},
                {"key": "encryption.at_rest", "value": True},
                {"key": "breach_notification_hours", "value": 72},
            ]
        },
    )
    client.put(
        f"/v1/vendors/{vid}/controls",
        headers=h,
        json={
            "controls": [
                {
                    "category": "Infrastructure Security",
                    "name": "Backups tested",
                    "status": "operating",
                },
                {
                    "category": "Infrastructure Security",
                    "name": "Log retention",
                    "status": "not_operating",
                },
            ]
        },
    )
    client.put(
        f"/v1/vendors/{vid}/subprocessors",
        headers=h,
        json={
            "subprocessors": [
                {"name": "AWS", "purpose": "Hosting", "location": "us-east-1",
                 "domain": "aws.amazon.com"}
            ]
        },
    )
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    return vid, owner, aid


def grant_key(client, vendor_id: str, owner_token: str, scope: list[str] | None = None) -> str:
    """Request and approve an access key, returning the bearer secret."""
    r = client.post(
        "/v1/keys/request",
        json={
            "vendor_id": vendor_id,
            "requester": {"name": "Globex", "domain": "globex.com", "contact": "t@globex.com"},
            "scope": scope or ["manifest", "attestations", "artifacts"],
        },
    )
    request_id = r.json()["request_id"]
    r = client.post(
        f"/v1/vendors/{vendor_id}/keys/requests/{request_id}/approve",
        headers=owner_headers(owner_token),
        json={},
    )
    return r.json()["key"]
