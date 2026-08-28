from __future__ import annotations

from tests.conftest import owner_headers


def _seed_and_grant(client, vid, h):
    client.post(f"/v1/vendors/{vid}/artifacts", headers=h,
                json={"type": "soc2_type2", "issued_at": "2026-01-01"})
    client.put(f"/v1/vendors/{vid}/attestations", headers=h, json={"claims": [
        {"key": "mfa.enforced", "value": True, "evidence": []},
        {"key": "encryption.at_rest", "value": "AES-256", "evidence": []},
    ]})
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    req = client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": "globex.com", "contact": "t@globex.com"},
        "scope": ["manifest", "attestations"],
    }).json()
    grant = client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=h, json={}
    ).json()
    return {"Authorization": f"Bearer {grant['key']}"}


def test_recommendation_on_pending(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    # allowlisted domain would auto-grant; use a non-listed domain to stay pending.
    client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Stranger", "domain": "stranger.com", "contact": "a@stranger.com"},
        "scope": ["manifest"],
    })
    reqs = client.get(f"/v1/vendors/{vid}/keys/requests", headers=h).json()
    pending = [r for r in reqs if r["status"] == "pending"][0]
    assert "recommendation" in pending
    assert pending["recommendation"]["level"] in {"approve", "review", "caution"}
    assert pending["recommendation"]["reasons"]


def test_insights_aggregates(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    bearer = _seed_and_grant(client, vid, h)
    client.get(f"/v1/vendors/{vid}/manifest", headers=bearer)
    client.get(f"/v1/vendors/{vid}/attestations", headers=bearer)

    ins = client.get(f"/v1/vendors/{vid}/insights", headers=h).json()
    assert ins["requests"]["granted"] >= 1
    assert ins["keys"]["active"] >= 1
    assert ins["reads"]["total"] >= 2
    assert len(ins["recent_activity"]) > 0


def test_oscal_export(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    bearer = _seed_and_grant(client, vid, h)
    r = client.get(f"/v1/vendors/{vid}/attestations/oscal?framework=soc2", headers=bearer)
    assert r.status_code == 200
    cd = r.json()["component-definition"]
    assert cd["components"][0]["type"] == "service"
    reqs = cd["components"][0]["control-implementations"][0]["implemented-requirements"]
    control_ids = {ir["control-id"] for ir in reqs}
    assert "CC6.1" in control_ids  # mfa.enforced
    assert client.get(
        f"/v1/vendors/{vid}/attestations/oscal?framework=nope", headers=bearer
    ).status_code == 404
