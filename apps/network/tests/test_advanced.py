from __future__ import annotations

import json

from tests.conftest import owner_headers


def _grant(client, vid, h, scope=None, domain="globex.com", nda=False):
    body = {
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": domain, "contact": "t@globex.com"},
        "scope": scope or ["manifest", "attestations", "artifacts"],
    }
    if nda:
        body["nda_accepted"] = True
    req = client.post("/v1/keys/request", json=body)
    rid = req.json()["request_id"]
    grant = client.post(f"/v1/vendors/{vid}/keys/requests/{rid}/approve", headers=h, json={}).json()
    return {"Authorization": f"Bearer {grant['key']}"}


# --- NDA gate ---------------------------------------------------------------


def test_nda_required_blocks_then_allows(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h,
               json={"nda_required": True, "nda_text": "Mutual NDA v1"})
    body = {"vendor_id": vid,
            "requester": {"name": "G", "domain": "g.com", "contact": "a@g.com"},
            "scope": ["manifest"]}
    assert client.post("/v1/keys/request", json=body).status_code == 422
    body["nda_accepted"] = True
    assert client.post("/v1/keys/request", json=body).json()["status"] == "pending"


# --- Signed responses -------------------------------------------------------


def test_manifest_is_signed_and_verifiable(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    bearer = _grant(client, vid, h, scope=["manifest"])
    r = client.get(f"/v1/vendors/{vid}/manifest", headers=bearer)
    assert r.status_code == 200
    sig = r.headers["X-TrustMCP-Signature"]
    key = client.get("/v1/network/key").json()["public_key"]
    from app.signing import verify

    assert verify(key, sig, r.content) is True
    # Tampered body fails.
    assert verify(key, sig, r.content + b" ") is False


# --- Webhooks ---------------------------------------------------------------


def test_webhook_emitted_on_request(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h,
               json={"webhook_url": "https://hook.example/x", "webhook_secret": "s3cret"})

    captured = {}
    import app.routers.keys as keys_mod

    def fake_deliver(url, secret, event, data):
        captured["url"] = url
        captured["event"] = event
        captured["data"] = data
        return True

    monkeypatch.setattr(keys_mod, "deliver", fake_deliver)
    client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "G", "domain": "g.com", "contact": "a@g.com"},
        "scope": ["manifest"],
    })
    assert captured["event"] == "key.requested"
    assert captured["url"] == "https://hook.example/x"


def test_webhook_signature_roundtrip():
    from app.webhooks import sign_payload

    body = json.dumps({"event": "x"}).encode()
    sig = sign_payload("secret", body)
    assert sig.startswith("sha256=")
    # Recomputing with the same secret matches.
    assert sign_payload("secret", body) == sig
    assert sign_payload("other", body) != sig


# --- Framework mapping ------------------------------------------------------


def test_framework_mapping(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/attestations", headers=h, json={"claims": [
        {"key": "mfa.enforced", "value": True, "evidence": []},
        {"key": "encryption.at_rest", "value": "AES-256", "evidence": []},
    ]})
    bearer = _grant(client, vid, h, scope=["attestations"])
    assert client.get("/v1/frameworks").json()["frameworks"]
    r = client.get(f"/v1/vendors/{vid}/attestations/mapped?framework=soc2", headers=bearer)
    assert r.status_code == 200
    controls = {c["control"]: c for c in r.json()["controls"]}
    assert controls["CC6.1"]["present"] is True  # mfa.enforced maps here
    assert controls["CC6.7"]["present"] is True  # encryption.at_rest
    # unknown framework -> 404
    assert client.get(
        f"/v1/vendors/{vid}/attestations/mapped?framework=nope", headers=bearer
    ).status_code == 404


# --- nth-party graph --------------------------------------------------------


def test_subprocessor_graph_links_published_vendor(client, vendor, service_token):
    vid, owner = vendor
    h = owner_headers(owner)
    # A second vendor that is published with domain sub.example.
    sub = client.post("/v1/vendors", headers={"X-TrustMCP-Service-Token": service_token},
                      json={"legal_name": "SubProc Inc", "domains": ["subproc.example"]}).json()
    sh = owner_headers(sub["owner_token"])
    client.post(f"/v1/vendors/{sub['id']}/publish", headers=sh)

    client.put(f"/v1/vendors/{vid}/subprocessors", headers=h, json={"subprocessors": [
        {"name": "SubProc Inc", "purpose": "Hosting", "domain": "subproc.example"},
        {"name": "Unlinked Co", "purpose": "Email", "domain": "nowhere.example"},
    ]})
    bearer = _grant(client, vid, h, scope=["attestations"])
    g = client.get(f"/v1/vendors/{vid}/graph", headers=bearer).json()
    by_name = {s["name"]: s for s in g["subprocessors"]}
    assert by_name["SubProc Inc"]["linked_vendor"]["vendor_id"] == sub["id"]
    assert by_name["Unlinked Co"]["linked_vendor"] is None
