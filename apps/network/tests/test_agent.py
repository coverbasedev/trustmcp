from __future__ import annotations

from tests.conftest import owner_headers


def _request(client, vid, domain="newco.com", scope=None):
    return client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "NewCo", "domain": domain, "contact": "a@newco.com"},
        "scope": scope or ["manifest"],
    })


def test_per_vendor_crm_used_for_auto_release(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    # Configure per-vendor HubSpot creds + CRM auto-release.
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={
        "crm_provider": "hubspot", "crm_token": "vendor-token", "auto_approve_crm": True,
    })
    import app.crm as crm
    monkeypatch.setattr(crm, "_hubspot", lambda domain, token: {
        "configured": True, "provider": "hubspot", "found": True, "_token": token,
    })
    r = _request(client, vid).json()
    assert r["status"] == "granted"
    assert r["reason"] == "crm:hubspot"


def test_crm_config_not_leaked_in_vendor_out(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h,
               json={"crm_provider": "hubspot", "crm_token": "super-secret"})
    v = client.get(f"/v1/vendors/{vid}", headers=h).json()
    assert v["crm_provider"] == "hubspot"
    assert v["crm_configured"] is True
    assert "crm_token" not in v  # never echoed back


def test_approval_agent_auto_grants_confident_request(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={
        "crm_provider": "hubspot", "crm_token": "t", "agent_auto_approve": True,
    })
    import app.crm as crm
    monkeypatch.setattr(crm, "_hubspot", lambda domain, token: {
        "configured": True, "provider": "hubspot", "found": True,
    })
    # No auto_approve_crm policy set, but the agent acts on a confident recommendation.
    r = _request(client, vid).json()
    assert r["status"] == "granted"
    assert r["reason"] == "agent:recommendation"


def test_agent_off_leaves_pending(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h,
               json={"crm_provider": "hubspot", "crm_token": "t"})
    import app.crm as crm
    monkeypatch.setattr(crm, "_hubspot", lambda domain, token: {
        "configured": True, "provider": "hubspot", "found": True,
    })
    # agent_auto_approve defaults off -> stays pending, but recommendation is "approve".
    assert _request(client, vid).json()["status"] == "pending"
    reqs = client.get(f"/v1/vendors/{vid}/keys/requests", headers=h).json()
    pending = [r for r in reqs if r["status"] == "pending"][0]
    assert pending["recommendation"]["level"] == "approve"
