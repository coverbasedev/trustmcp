from __future__ import annotations

from tests.conftest import owner_headers


def test_domain_verification_grants_mark(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)

    # Add a domain -> get challenge
    r = client.post(f"/v1/vendors/{vid}/domains", headers=h, json={"domain": "acme.com"})
    assert r.status_code == 200, r.text
    challenge = r.json()
    token = challenge["dns_record_value"]
    assert token.startswith("trustmcp-verify=")

    # Verify fails before the record exists
    import app.verification as verification

    monkeypatch.setattr(verification, "fetch_txt_records", lambda name: [])
    monkeypatch.setattr(verification, "fetch_well_known", lambda domain: "")
    r = client.post(f"/v1/vendors/{vid}/domains/acme.com/verify", headers=h)
    assert r.status_code == 400

    # Now the DNS TXT record "exists"
    monkeypatch.setattr(verification, "fetch_txt_records", lambda name: [token])
    r = client.post(f"/v1/vendors/{vid}/domains/acme.com/verify", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["verified"] is True
    assert r.json()["mark_status"] == "agent-ready"

    # Public mark endpoint now reflects it
    r = client.get(f"/v1/mark/{vid}")
    assert r.json()["mark"] == "agent-ready"
    assert "acme.com" in r.json()["verified_domains"]


def test_well_known_fallback(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    r = client.post(f"/v1/vendors/{vid}/domains", headers=h, json={"domain": "globex.com"})
    token = r.json()["dns_record_value"]

    import app.verification as verification

    monkeypatch.setattr(verification, "fetch_txt_records", lambda name: [])
    monkeypatch.setattr(verification, "fetch_well_known", lambda domain: token)
    r = client.post(f"/v1/vendors/{vid}/domains/globex.com/verify", headers=h)
    assert r.status_code == 200
    assert r.json()["method"] == "well-known"
