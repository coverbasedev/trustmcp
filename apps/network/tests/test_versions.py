from __future__ import annotations

import hashlib

from tests.conftest import owner_headers


def test_artifact_versioning(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    art = client.post(
        f"/v1/vendors/{vid}/artifacts", headers=h,
        json={"type": "soc2_type2", "issued_at": "2026-01-01"},
    ).json()
    aid = art["id"]
    assert art["version"] == 1

    v1 = b"%PDF version one"
    r = client.post(
        f"/v1/vendors/{vid}/artifacts/{aid}/content", headers=h,
        files={"file": ("soc2.pdf", v1, "application/pdf")},
    ).json()
    assert r["version"] == 1  # first upload is still v1

    v2 = b"%PDF version two refreshed"
    r = client.post(
        f"/v1/vendors/{vid}/artifacts/{aid}/content", headers=h,
        data={"note": "annual refresh"},
        files={"file": ("soc2.pdf", v2, "application/pdf")},
    ).json()
    assert r["version"] == 2
    assert r["sha256"] == hashlib.sha256(v2).hexdigest()

    # Owner history shows current + 1 archived.
    hist = client.get(f"/v1/vendors/{vid}/manage/artifacts/{aid}/versions", headers=h).json()
    assert [v["version"] for v in hist["versions"]] == [2, 1]
    assert hist["versions"][1]["note"] == "annual refresh"

    # Consumer can read history and fetch a specific version.
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    req = client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "G", "domain": "g.com", "contact": "a@g.com"},
        "scope": ["manifest", "artifacts"],
    }).json()
    grant = client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=h, json={}
    ).json()
    bearer = {"Authorization": f"Bearer {grant['key']}"}

    vers = client.get(f"/v1/vendors/{vid}/artifacts/{aid}/versions", headers=bearer)
    assert vers.status_code == 200
    assert [v["version"] for v in vers.json()["versions"]] == [2, 1]

    # Fetch the archived v1 and verify its hash.
    link = client.get(f"/v1/vendors/{vid}/artifacts/{aid}/versions/1", headers=bearer).json()
    assert link["sha256"] == hashlib.sha256(v1).hexdigest()
    path = link["url"].replace("http://testserver", "")
    got = client.get(path)
    assert hashlib.sha256(got.content).hexdigest() == hashlib.sha256(v1).hexdigest()

    # Manifest reflects the current version number.
    m = client.get(f"/v1/vendors/{vid}/manifest", headers=bearer).json()
    assert m["artifacts"][0]["version"] == 2
