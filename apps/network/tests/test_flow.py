from __future__ import annotations

import hashlib

from tests.conftest import owner_headers


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_create_vendor_requires_service_token(client):
    r = client.post("/v1/vendors", json={"legal_name": "NoAuth"})
    assert r.status_code == 401


def test_full_publish_and_read_flow(client, vendor, service_token):
    vid, owner = vendor
    h = owner_headers(owner)

    # Add an artifact + upload content
    r = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "soc2_type2", "title": "SOC 2 Type II", "issued_at": "2026-01-15",
              "valid_until": "2027-01-15", "scope": "US"},
    )
    assert r.status_code == 201, r.text
    art = r.json()
    aid = art["id"]
    assert art["has_content"] is False

    content = b"%PDF-1.4 fake soc2 report"
    r = client.post(
        f"/v1/vendors/{vid}/artifacts/{aid}/content",
        headers=h,
        files={"file": ("soc2.pdf", content, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["sha256"] == hashlib.sha256(content).hexdigest()

    # Attestations
    r = client.put(
        f"/v1/vendors/{vid}/attestations",
        headers=h,
        json={"claims": [
            {"key": "mfa.enforced", "value": True, "evidence": [aid]},
            {"key": "data_residency", "value": ["US", "EU"], "evidence": [aid]},
        ]},
    )
    assert r.status_code == 200
    assert r.json()["count"] == 2

    client.post(f"/v1/vendors/{vid}/publish", headers=h)

    # --- Consumer requests access ---
    r = client.post(
        "/v1/keys/request",
        json={"vendor_id": vid, "requester": {"name": "Globex", "domain": "globex.com",
              "contact": "trust@globex.com"}, "scope": ["manifest", "attestations", "artifacts"]},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    request_id = r.json()["request_id"]

    # Owner approves
    r = client.post(f"/v1/vendors/{vid}/keys/requests/{request_id}/approve", headers=h, json={})
    assert r.status_code == 200, r.text
    grant = r.json()
    assert grant["status"] == "granted"
    key = grant["key"]
    key_id = grant["key_id"]

    bearer = {"Authorization": f"Bearer {key}"}

    # Read manifest
    r = client.get(f"/v1/vendors/{vid}/manifest", headers=bearer)
    assert r.status_code == 200, r.text
    manifest = r.json()
    assert manifest["vendor"]["id"] == vid
    assert len(manifest["artifacts"]) == 1

    # Read attestations
    r = client.get(f"/v1/vendors/{vid}/attestations", headers=bearer)
    assert r.status_code == 200
    keys = {c["key"] for c in r.json()["claims"]}
    assert "mfa.enforced" in keys

    # Freshness
    r = client.get(f"/v1/vendors/{vid}/freshness", headers=bearer)
    assert r.status_code == 200
    assert r.json()["items"][0]["status"] in {"valid", "expiring", "expired"}

    # Fetch artifact -> signed url + hash, then download and verify the hash
    r = client.get(f"/v1/vendors/{vid}/artifacts/{aid}", headers=bearer)
    assert r.status_code == 200, r.text
    link = r.json()
    assert link["sha256"] == hashlib.sha256(content).hexdigest()
    # local signed URL points back at /v1/files
    path = link["url"].replace("http://testserver", "")
    r = client.get(path)
    assert r.status_code == 200
    assert hashlib.sha256(r.content).hexdigest() == link["sha256"]

    # --- Revocation stops reads ---
    r = client.post(f"/v1/vendors/{vid}/keys/{key_id}/revoke", headers=h)
    assert r.status_code == 200
    r = client.get(f"/v1/vendors/{vid}/manifest", headers=bearer)
    assert r.status_code == 403


def test_scope_enforcement(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    # Request only manifest scope
    r = client.post(
        "/v1/keys/request",
        json={"vendor_id": vid, "requester": {"name": "G", "domain": "g.com", "contact": "a@g.com"},
              "scope": ["manifest"]},
    )
    request_id = r.json()["request_id"]
    grant = client.post(
        f"/v1/vendors/{vid}/keys/requests/{request_id}/approve", headers=h, json={}
    ).json()
    bearer = {"Authorization": f"Bearer {grant['key']}"}
    # manifest ok
    assert client.get(f"/v1/vendors/{vid}/manifest", headers=bearer).status_code == 200
    # attestations forbidden (scope missing)
    assert client.get(f"/v1/vendors/{vid}/attestations", headers=bearer).status_code == 403


def test_mark_endpoint_public(client, vendor):
    vid, _ = vendor
    r = client.get(f"/v1/mark/{vid}")
    assert r.status_code == 200
    assert r.json()["mark"] == "unverified"  # not yet verified


def test_public_profile_requires_publish(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    # Not published yet -> 404
    assert client.get(f"/v1/vendors/{vid}/public").status_code == 404

    client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "soc2_type2", "issued_at": "2026-01-15", "valid_until": "2027-01-15"},
    )
    client.put(
        f"/v1/vendors/{vid}/attestations",
        headers=h,
        json={"claims": [{"key": "mfa.enforced", "value": True, "evidence": []}]},
    )
    client.post(f"/v1/vendors/{vid}/publish", headers=h)

    r = client.get(f"/v1/vendors/{vid}/public")
    assert r.status_code == 200
    body = r.json()
    assert body["vendor"]["id"] == vid
    assert len(body["artifacts"]) == 1
    # No signed URLs or content leak in the public view.
    assert "url" not in body["artifacts"][0]
    assert body["claim_keys"] == ["mfa.enforced"]


def test_public_vs_private_artifact_access(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    # One public, one private artifact (both with content).
    pub = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "policy", "issued_at": "2026-01-01", "access": "public"},
    ).json()
    priv = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "soc2_type2", "issued_at": "2026-01-01", "access": "key_required"},
    ).json()
    for aid in (pub["id"], priv["id"]):
        client.post(
            f"/v1/vendors/{vid}/artifacts/{aid}/content",
            headers=h,
            files={"file": ("f.pdf", b"%PDF data", "application/pdf")},
        )
    client.post(f"/v1/vendors/{vid}/publish", headers=h)

    # Public artifact: downloadable with no key.
    r = client.get(f"/v1/vendors/{vid}/artifacts/{pub['id']}/public")
    assert r.status_code == 200, r.text
    assert r.json()["sha256"]

    # Private artifact: blocked on the public endpoint.
    r = client.get(f"/v1/vendors/{vid}/artifacts/{priv['id']}/public")
    assert r.status_code == 403
