from __future__ import annotations

from tests.conftest import owner_headers


def _verify(client, monkeypatch, vid, owner, domain):
    h = owner_headers(owner)
    r = client.post(f"/v1/vendors/{vid}/domains", headers=h, json={"domain": domain})
    token = r.json()["dns_record_value"]
    import app.verification as verification

    monkeypatch.setattr(verification, "fetch_txt_records", lambda name: [token])
    monkeypatch.setattr(verification, "fetch_well_known", lambda domain: "")
    r = client.post(f"/v1/vendors/{vid}/domains/{domain}/verify", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_operator_revoke_is_sticky(client, vendor, service_token, monkeypatch):
    vid, owner = vendor
    _verify(client, monkeypatch, vid, owner, "acme.com")
    assert client.get(f"/v1/mark/{vid}").json()["mark"] == "agent-ready"

    # Operator revokes (service token, not owner).
    svc = {"X-TrustMCP-Service-Token": service_token}
    r = client.post(f"/v1/vendors/{vid}/mark/revoke", headers=svc, json={"reason": "abuse"})
    assert r.status_code == 200, r.text
    body = client.get(f"/v1/mark/{vid}").json()
    assert body["mark"] == "revoked"
    assert body["revoked"] is True
    assert body["issued"] is False

    # Re-verifying a domain must NOT silently re-grant the mark.
    h = owner_headers(owner)
    client.post(f"/v1/vendors/{vid}/domains", headers=h, json={"domain": "acme2.com"})
    import app.verification as verification

    monkeypatch.setattr(verification, "fetch_txt_records", lambda name: [
        # any token works since verify reads the stored challenge; fetch the real one
    ])
    # Fetch the stored challenge and make it "exist".
    challenge = client.post(
        f"/v1/vendors/{vid}/domains", headers=h, json={"domain": "acme2.com"}
    ).json()["dns_record_value"]
    monkeypatch.setattr(verification, "fetch_txt_records", lambda name: [challenge])
    r = client.post(f"/v1/vendors/{vid}/domains/acme2.com/verify", headers=h)
    assert r.status_code == 200
    assert r.json()["mark_status"] == "revoked"
    assert client.get(f"/v1/mark/{vid}").json()["mark"] == "revoked"

    # Operator reinstates -> back to agent-ready (verified domains exist).
    r = client.post(f"/v1/vendors/{vid}/mark/reinstate", headers=svc)
    assert r.status_code == 200
    assert r.json()["mark_status"] == "agent-ready"
    assert client.get(f"/v1/mark/{vid}").json()["mark"] == "agent-ready"


def test_owner_cannot_revoke(client, vendor):
    vid, owner = vendor
    r = client.post(f"/v1/vendors/{vid}/mark/revoke", headers=owner_headers(owner))
    assert r.status_code == 401


def test_remove_only_domain_falls_back_to_unverified(client, vendor, monkeypatch):
    vid, owner = vendor
    _verify(client, monkeypatch, vid, owner, "acme.com")
    h = owner_headers(owner)
    r = client.delete(f"/v1/vendors/{vid}/domains/acme.com", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["mark_status"] == "unverified"
    assert client.get(f"/v1/mark/{vid}").json()["mark"] == "unverified"
