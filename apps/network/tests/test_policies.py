from __future__ import annotations

from tests.conftest import owner_headers


def _request(client, vid, scope=None, domain="globex.com"):
    return client.post(
        "/v1/keys/request",
        json={
            "vendor_id": vid,
            "requester": {"name": "Globex", "domain": domain, "contact": "t@globex.com"},
            "scope": scope or ["manifest", "attestations", "artifacts"],
        },
    )


def test_auto_release_domain_allowlist(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(
        f"/v1/vendors/{vid}/profile",
        headers=h,
        json={"auto_approve_domains": ["globex.com"]},
    )
    r = _request(client, vid)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "granted"
    assert body["auto_approved"] is True
    assert body["reason"] == "domain-allowlist"
    # The returned key works immediately.
    bearer = {"Authorization": f"Bearer {body['key']}"}
    assert client.get(f"/v1/vendors/{vid}/manifest", headers=bearer).status_code == 200


def test_non_allowlisted_stays_pending(client, vendor):
    vid, owner = vendor
    client.put(
        f"/v1/vendors/{vid}/profile",
        headers=owner_headers(owner),
        json={"auto_approve_domains": ["acme-customer.com"]},
    )
    assert _request(client, vid, domain="stranger.com").json()["status"] == "pending"


def test_per_artifact_scope(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    a = client.post(
        f"/v1/vendors/{vid}/artifacts", headers=h,
        json={"type": "soc2_type2", "issued_at": "2026-01-01"},
    ).json()
    b = client.post(
        f"/v1/vendors/{vid}/artifacts", headers=h,
        json={"type": "pentest", "issued_at": "2026-01-01"},
    ).json()
    for aid in (a["id"], b["id"]):
        client.post(
            f"/v1/vendors/{vid}/artifacts/{aid}/content", headers=h,
            files={"file": ("f.pdf", b"%PDF x", "application/pdf")},
        )
    req = _request(client, vid, scope=["artifacts"]).json()
    grant = client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve",
        headers=h,
        json={"artifact_ids": [a["id"]]},
    ).json()
    bearer = {"Authorization": f"Bearer {grant['key']}"}
    # allowed artifact ok
    assert client.get(f"/v1/vendors/{vid}/artifacts/{a['id']}", headers=bearer).status_code == 200
    # other artifact blocked
    assert client.get(f"/v1/vendors/{vid}/artifacts/{b['id']}", headers=bearer).status_code == 403


def test_contract_auto_release(client, vendor):
    vid, owner = vendor
    client.put(
        f"/v1/vendors/{vid}/profile",
        headers=owner_headers(owner),
        json={"auto_approve_on_contract": True},
    )
    r = client.post(
        "/v1/keys/request-with-contract",
        data={
            "vendor_id": vid, "name": "Globex", "domain": "globex.com",
            "contact": "t@globex.com", "scope": "manifest,artifacts",
        },
        files={"file": ("msa.pdf", b"%PDF signed contract", "application/pdf")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "granted"
    assert body["reason"] == "contract-upload"


def test_directory_lists_published(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    # unpublished -> not in directory
    assert client.get("/v1/directory").json()["count"] == 0
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    d = client.get("/v1/directory").json()
    assert d["count"] == 1
    assert d["vendors"][0]["id"] == vid
    # opt out -> removed
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={"listed": False})
    assert client.get("/v1/directory").json()["count"] == 0


def test_audit_csv_export(client, vendor):
    vid, owner = vendor
    r = client.get(f"/v1/vendors/{vid}/audit.csv", headers=owner_headers(owner))
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert r.text.splitlines()[0] == "at,action,actor,target,detail,access_key_id"
