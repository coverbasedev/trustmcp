"""End-to-end: drive the TrustMCP client + assessment loop against the real network
app running in-process (ASGI), proving the §8 flow works against the reference API."""

from __future__ import annotations

import httpx
import pytest

# Starlette's TestClient is backed by `httpx2` where that package is installed and
# by `httpx` otherwise, and each raises its own HTTPStatusError class. Assert
# against whichever is actually in play rather than pinning one — the point of the
# assertion is that the request was rejected, not which library reported it.
try:  # pragma: no cover - depends on the resolved dependency tree
    import httpx2

    HTTP_STATUS_ERRORS: tuple[type[Exception], ...] = (
        httpx.HTTPStatusError,
        httpx2.HTTPStatusError,
    )
except ImportError:  # pragma: no cover
    HTTP_STATUS_ERRORS = (httpx.HTTPStatusError,)


@pytest.fixture()
def network_client():
    # Starlette's TestClient is a synchronous httpx.Client bound to the ASGI app,
    # so it works as the injected HTTP client for TrustMCPClient and resolves the
    # absolute signed-URL host (http://network) back to the in-process app.
    from app.db import init_db
    from app.main import create_app
    from fastapi.testclient import TestClient

    init_db()
    app = create_app()
    with TestClient(app, base_url="http://network") as c:
        yield c


def _seed_acme(http: httpx.Client, monkeypatch) -> str:
    svc = {"X-TrustMCP-Service-Token": "test-service-token"}
    r = http.post("/v1/vendors", headers=svc, json={"legal_name": "Acme Corp",
                  "product": "Acme Platform", "domains": ["acme.com"]})
    body = r.json()
    vid, owner = body["id"], body["owner_token"]
    oh = {"X-TrustMCP-Owner-Token": owner}

    art = http.post(f"/v1/vendors/{vid}/artifacts", headers=oh,
                    json={"type": "soc2_type2", "title": "SOC 2 Type II",
                          "issued_at": "2026-01-15", "valid_until": "2027-01-15"}).json()
    http.post(f"/v1/vendors/{vid}/artifacts/{art['id']}/content", headers=oh,
              files={"file": ("soc2.pdf", b"%PDF fake report", "application/pdf")})

    http.put(f"/v1/vendors/{vid}/attestations", headers=oh, json={"claims": [
        {"key": "mfa.enforced", "value": True, "evidence": [art["id"]]},
        {"key": "encryption.at_rest", "value": "AES-256", "evidence": [art["id"]]},
        {"key": "encryption.in_transit", "value": "TLS 1.2+", "evidence": [art["id"]]},
        {"key": "breach_notification_hours", "value": 72, "evidence": [art["id"]]},
        {"key": "data_residency", "value": ["US", "EU"], "evidence": [art["id"]]},
    ]})

    # Verify domain -> grant the mark.
    http.post(f"/v1/vendors/{vid}/domains", headers=oh, json={"domain": "acme.com"})
    import app.verification as verification
    dv = http.post(f"/v1/vendors/{vid}/domains", headers=oh, json={"domain": "acme.com"}).json()
    monkeypatch.setattr(verification, "fetch_txt_records", lambda name: [dv["dns_record_value"]])
    http.post(f"/v1/vendors/{vid}/domains/acme.com/verify", headers=oh)
    return vid, oh


def test_full_assessment_loop(network_client, monkeypatch):
    from demo_assessment import run_assessment
    from trustmcp_client import TrustMCPClient

    vid, oh = _seed_acme(network_client, monkeypatch)

    # Customer requests access; vendor approves.
    req = network_client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": "globex.com", "contact": "trust@globex.com"},
        "scope": ["manifest", "attestations", "artifacts"],
    }).json()
    grant = network_client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=oh, json={}
    ).json()

    # Drive the client + assessment loop through the in-process network.
    client = TrustMCPClient(network="http://network", keys={vid: grant["key"]}, http=network_client)
    report = run_assessment(client, vid, {"name": "Globex", "domain": "globex.com",
                                          "contact": "trust@globex.com"})

    assert report["mark"]["mark"] == "agent-ready"
    assert report["verdict"] == "pass"
    assert all(c["result"] == "pass" for c in report["controls"])
    assert report["artifacts_verified"], "should have fetched + hash-verified an artifact"
    assert all(a["hash_ok"] for a in report["artifacts_verified"])


def test_signature_verification_and_new_tools(network_client, monkeypatch):
    from trustmcp_client import SignatureError, TrustMCPClient

    vid, oh = _seed_acme(network_client, monkeypatch)
    req = network_client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": "globex.com", "contact": "t@globex.com"},
        "scope": ["manifest", "attestations", "artifacts"],
    }).json()
    grant = network_client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=oh, json={}
    ).json()
    client = TrustMCPClient(network="http://network", keys={vid: grant["key"]}, http=network_client)

    # Signed manifest verifies against the network key.
    assert client.get_manifest(vid)["vendor"]["id"] == vid
    assert client.get_network_key()["public_key"]

    # Framework mapping + OSCAL + graph tools work through the client.
    assert client.get_frameworks()["frameworks"]
    mapped = client.get_mapped_attestations(vid, "soc2")
    assert any(c["present"] for c in mapped["controls"])
    assert client.get_oscal(vid, "soc2")["component-definition"]["components"]
    assert "subprocessors" in client.get_subprocessor_graph(vid)

    # A tampered signature is rejected.
    bad = TrustMCPClient(network="http://network", keys={vid: grant["key"]}, http=network_client)

    def fake_key():
        return {"public_key": "AAAA", "alg": "Ed25519"}

    monkeypatch.setattr(bad, "get_network_key", fake_key)
    try:
        bad.get_manifest(vid)
        raise AssertionError("expected SignatureError")
    except SignatureError:
        pass


def test_revoked_key_blocks_loop(network_client, monkeypatch):
    from trustmcp_client import TrustMCPClient

    vid, oh = _seed_acme(network_client, monkeypatch)
    req = network_client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "G", "domain": "g.com", "contact": "a@g.com"},
        "scope": ["manifest"],
    }).json()
    grant = network_client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=oh, json={}
    ).json()
    network_client.post(f"/v1/vendors/{vid}/keys/{grant['key_id']}/revoke", headers=oh)

    client = TrustMCPClient(network="http://network", keys={vid: grant["key"]}, http=network_client)
    with pytest.raises(HTTP_STATUS_ERRORS):
        client.get_manifest(vid)


def test_oscal_exchange_through_the_client(network_client, monkeypatch):
    """The full OSCAL surface, driven exactly as the MCP tools drive it."""
    from trustmcp_client import TrustMCPClient

    vid, oh = _seed_acme(network_client, monkeypatch)
    req = network_client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": "globex.com", "contact": "t@globex.com"},
        "scope": ["manifest", "attestations", "artifacts"],
    }).json()
    grant = network_client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=oh, json={}
    ).json()
    client = TrustMCPClient(network="http://network", keys={vid: grant["key"]}, http=network_client)

    capabilities = client.get_oscal_capabilities()
    models = [m["name"] for m in capabilities["vendor_models"]]
    assert "plan-of-action-and-milestones" in models

    for model in models:
        document = client.get_oscal_model(vid, model)
        assert model in document
        assert client.validate_oscal(document)["valid"], model

    # Aliases and non-JSON formats come back as text ready for another tool.
    assert client.get_oscal_model(vid, "ssp", fmt="yaml").startswith("system-security-plan:")
    assert client.get_oscal_model(vid, "poam", fmt="xml").startswith("<?xml")

    bundle = client.get_oscal_bundle(vid)
    assert set(bundle["documents"]) == set(models)
    assert bundle["digests"]

    assert client.get_oscal_catalog()["catalog"]["groups"]
    assert client.get_oscal_profile("soc2")["profile"]["imports"]


def test_continuous_polling_only_refetches_what_moved(network_client, monkeypatch):
    """The loop an agent actually runs: poll with a cursor, re-pull the invalidated
    models, and get nothing back when nothing changed."""
    from trustmcp_client import TrustMCPClient

    vid, oh = _seed_acme(network_client, monkeypatch)
    req = network_client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": "globex.com", "contact": "t@globex.com"},
        "scope": ["manifest", "attestations", "artifacts"],
    }).json()
    grant = network_client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=oh, json={}
    ).json()
    client = TrustMCPClient(network="http://network", keys={vid: grant["key"]}, http=network_client)

    caught_up = client.get_oscal_changes(vid)["cursor"]
    assert client.get_oscal_changes(vid, caught_up)["changes"] == []

    network_client.put(f"/v1/vendors/{vid}/controls", headers=oh, json={
        "controls": [{"category": "Security", "name": "Backups", "status": "not_operating"}]
    })
    batch = client.get_oscal_changes(vid, caught_up)
    assert [c["event"] for c in batch["changes"]] == ["controls.replaced"]
    assert "plan-of-action-and-milestones" in batch["changes"][0]["models"]

    # The re-pulled POA&M carries the newly disclosed gap.
    poam = client.get_oscal_model(vid, "plan-of-action-and-milestones")
    titles = [i["title"] for i in poam["plan-of-action-and-milestones"]["poam-items"]]
    assert any("Backups" in t for t in titles)


def test_subscription_round_trip(network_client, monkeypatch):
    from trustmcp_client import TrustMCPClient

    vid, oh = _seed_acme(network_client, monkeypatch)
    req = network_client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": "globex.com", "contact": "t@globex.com"},
        "scope": ["attestations"],
    }).json()
    grant = network_client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=oh, json={}
    ).json()
    client = TrustMCPClient(network="http://network", keys={vid: grant["key"]}, http=network_client)

    sub = client.subscribe_oscal(
        vid, "https://grc.globex.com/hooks/trustmcp", secret="s3cret",
        models=["assessment-results"],
    )
    assert sub["status"] == "active"
    assert [s["id"] for s in client.list_oscal_subscriptions(vid)["subscriptions"]] == [sub["id"]]
    assert client.unsubscribe_oscal(vid, sub["id"])
    assert client.list_oscal_subscriptions(vid)["subscriptions"] == []
