from __future__ import annotations

import app.routers.manage as manage
from tests.conftest import owner_headers


def _connect_and_verify(client, vendor, monkeypatch, host="trust.example.com"):
    """Add + verify a custom domain (ownership proven), leaving it verified."""
    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain", headers=h, json={"domain": host}
    ).json()
    monkeypatch.setattr(
        manage, "doh_resolve", lambda name, rtype: [add["txt_value"]] if rtype == "TXT" else []
    )
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: True)
    body = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h).json()
    assert body["status"] == "verified"
    return vid, h


def test_resolve_returns_vendor_when_verified_and_published(client, vendor, monkeypatch):
    vid, h = _connect_and_verify(client, vendor, monkeypatch)
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    r = client.get("/v1/custom-domains/resolve", params={"host": "trust.example.com"})
    assert r.status_code == 200, r.text
    assert r.json() == {"vendor_id": vid}


def test_resolve_is_case_and_dot_insensitive(client, vendor, monkeypatch):
    vid, h = _connect_and_verify(client, vendor, monkeypatch)
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    r = client.get("/v1/custom-domains/resolve", params={"host": "Trust.Example.com."})
    assert r.status_code == 200
    assert r.json()["vendor_id"] == vid


def test_resolve_404_when_unpublished(client, vendor, monkeypatch):
    # Verified but never published -> nothing to serve.
    _connect_and_verify(client, vendor, monkeypatch)
    r = client.get("/v1/custom-domains/resolve", params={"host": "trust.example.com"})
    assert r.status_code == 404


def test_resolve_404_when_domain_unverified(client, vendor):
    # Added but not verified (status "pending") -> must not resolve, even if published.
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain", headers=h, json={"domain": "trust.example.com"}
    )
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    r = client.get("/v1/custom-domains/resolve", params={"host": "trust.example.com"})
    assert r.status_code == 404


def test_resolve_404_for_unknown_host(client, vendor):
    r = client.get("/v1/custom-domains/resolve", params={"host": "nope.example.com"})
    assert r.status_code == 404
    r2 = client.get("/v1/custom-domains/resolve", params={"host": ""})
    assert r2.status_code == 404
