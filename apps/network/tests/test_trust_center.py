from __future__ import annotations

from tests.conftest import owner_headers


def _publish(client, vid, owner):
    client.post(f"/v1/vendors/{vid}/publish", headers=owner_headers(owner))


def test_public_profile_includes_all_sections(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(
        f"/v1/vendors/{vid}/badges",
        headers=h,
        json={"badges": [{"name": "SOC 2 Type II", "standard": "soc2"}]},
    )
    client.put(
        f"/v1/vendors/{vid}/controls",
        headers=h,
        json={"controls": [{"category": "Infrastructure Security", "name": "Backups conducted"}]},
    )
    client.put(
        f"/v1/vendors/{vid}/data-types",
        headers=h,
        json={"data_types": [{"label": "Customer PII", "collected": True}]},
    )
    client.put(
        f"/v1/vendors/{vid}/faqs",
        headers=h,
        json={"faqs": [{"question": "Uptime?", "answer": "status.example.com"}]},
    )
    client.put(
        f"/v1/vendors/{vid}/updates",
        headers=h,
        json={"updates": [{"title": "SOC 2 available", "category": "Compliance"}]},
    )
    _publish(client, vid, owner)

    p = client.get(f"/v1/vendors/{vid}/public").json()
    assert p["badges"][0]["name"] == "SOC 2 Type II"
    assert p["controls"][0]["category"] == "Infrastructure Security"
    assert p["data_types"][0]["label"] == "Customer PII"
    assert p["faqs"][0]["question"] == "Uptime?"
    assert p["updates"][0]["title"] == "SOC 2 available"
    assert p["ask_enabled"] is False  # no API key configured in tests


def test_resource_category_in_public_artifacts(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    r = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={
            "type": "soc2_type2",
            "title": "SOC 2",
            "issued_at": "2026-01-01",
            "category": "Compliance",
            "access": "key_required",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["category"] == "Compliance"
    _publish(client, vid, owner)
    p = client.get(f"/v1/vendors/{vid}/public").json()
    assert p["artifacts"][0]["category"] == "Compliance"


def test_subscribe_and_list(client, vendor):
    vid, owner = vendor
    _publish(client, vid, owner)
    r = client.post(f"/v1/vendors/{vid}/subscribe", json={"email": "Reader@Co.com"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "reader@co.com"
    # idempotent
    client.post(f"/v1/vendors/{vid}/subscribe", json={"email": "reader@co.com"})
    out = client.get(f"/v1/vendors/{vid}/subscribers", headers=owner_headers(owner)).json()
    assert out["count"] == 1


def test_publishing_updates_emails_subscribers(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    _publish(client, vid, owner)
    client.post(f"/v1/vendors/{vid}/subscribe", json={"email": "reader@co.com"})

    sent: list[tuple] = []
    import app.routers.manage as manage

    monkeypatch.setattr(
        manage, "send_email", lambda settings, to, subject, body: sent.append((to, subject)) or True
    )
    # First publish notifies subscribers about the new update.
    r = client.put(
        f"/v1/vendors/{vid}/updates",
        headers=h,
        json={"updates": [{"title": "SOC 2 available", "published_at": "2026-01-20"}]},
    )
    assert r.json()["notified_new"] == 1
    assert len(sent) == 1
    assert sent[0][0] == "reader@co.com"

    # Re-saving the same update (editing the list) does NOT re-notify.
    sent.clear()
    r = client.put(
        f"/v1/vendors/{vid}/updates",
        headers=h,
        json={"updates": [{"title": "SOC 2 available", "published_at": "2026-01-20"}]},
    )
    assert r.json()["notified_new"] == 0
    assert sent == []


def test_ask_disabled_without_key(client, vendor):
    vid, owner = vendor
    _publish(client, vid, owner)
    r = client.post(f"/v1/vendors/{vid}/ask", json={"question": "Are you SOC 2?"})
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_reclaim_reissues_key(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    _publish(client, vid, owner)
    # Auto-grant a request so a granted KeyRequest exists for this email.
    client.put(
        f"/v1/vendors/{vid}/profile", headers=h, json={"auto_approve_domains": ["globex.com"]}
    )
    r = client.post(
        "/v1/keys/request",
        json={
            "vendor_id": vid,
            "requester": {"name": "Pat", "domain": "globex.com", "contact": "pat@globex.com"},
            "scope": ["manifest", "attestations", "artifacts"],
        },
    )
    assert r.json()["status"] == "granted"
    before = len(client.get(f"/v1/vendors/{vid}/keys", headers=h).json())

    r = client.post(f"/v1/vendors/{vid}/reclaim", json={"email": "pat@globex.com"})
    assert r.status_code == 200
    after = len(client.get(f"/v1/vendors/{vid}/keys", headers=h).json())
    assert after == before + 1  # a fresh key was minted

    # Unknown email is a no-op but returns the same uniform response.
    r = client.post(f"/v1/vendors/{vid}/reclaim", json={"email": "nobody@nowhere.com"})
    assert r.status_code == 200
    assert len(client.get(f"/v1/vendors/{vid}/keys", headers=h).json()) == after


def test_agreement_requires_enabled_then_records(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    _publish(client, vid, owner)
    payload = {
        "company_name": "Globex",
        "signer_name": "Pat Smith",
        "signer_email": "pat@globex.com",
        "signer_title": "GC",
    }
    # Disabled by default -> 403.
    r = client.post(f"/v1/vendors/{vid}/agreements", json=payload)
    assert r.status_code == 403

    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={"dpa_self_serve": True})
    r = client.post(f"/v1/vendors/{vid}/agreements", json=payload)
    assert r.status_code == 200, r.text
    agreements = client.get(f"/v1/vendors/{vid}/agreements", headers=h).json()
    assert len(agreements) == 1
    assert agreements[0]["company_name"] == "Globex"
    assert agreements[0]["status"] == "submitted"


def test_limited_access_request_scopes_artifacts(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    a = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "soc2_type2", "issued_at": "2026-01-01", "access": "key_required"},
    ).json()
    _publish(client, vid, owner)
    client.put(
        f"/v1/vendors/{vid}/profile", headers=h, json={"auto_approve_domains": ["globex.com"]}
    )
    r = client.post(
        "/v1/keys/request",
        json={
            "vendor_id": vid,
            "requester": {"name": "Pat", "domain": "globex.com", "contact": "pat@globex.com"},
            "artifact_ids": [a["id"]],
            "company": "Globex",
            "reason": "Vendor security review",
        },
    )
    assert r.json()["status"] == "granted"
    # The owner's request list reflects the limited scope + new fields.
    reqs = client.get(f"/v1/vendors/{vid}/keys/requests", headers=h).json()
    assert reqs[0]["artifact_ids"] == [a["id"]]
    assert reqs[0]["requester"]["company"] == "Globex"
    assert reqs[0]["reason"] == "Vendor security review"


def test_manual_approval_honors_requested_artifact_ids(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    a = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "soc2_type2", "issued_at": "2026-01-01", "access": "key_required"},
    ).json()
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    # A limited-access request with no auto-release -> stays pending.
    r = client.post(
        "/v1/keys/request",
        json={
            "vendor_id": vid,
            "requester": {"name": "Pat", "domain": "globex.com", "contact": "pat@globex.com"},
            "artifact_ids": [a["id"]],
        },
    )
    rid = r.json()["request_id"]
    # Owner approves WITHOUT specifying artifact_ids — must inherit the requested
    # limitation rather than silently grant full access.
    grant = client.post(
        f"/v1/vendors/{vid}/keys/requests/{rid}/approve", headers=h, json={}
    ).json()
    assert grant["artifact_ids"] == [a["id"]]
