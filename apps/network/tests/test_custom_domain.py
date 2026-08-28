from __future__ import annotations

import app.dns_providers as dns_providers
import app.routers.manage as manage
from tests.conftest import owner_headers


def test_add_custom_domain_returns_instructions(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["domain"] == "trust.example.com"
    assert body["status"] == "pending"
    assert body["tls"] == "none"
    assert body["txt_name"] == "_trustmcp.trust.example.com"
    assert body["txt_value"].startswith("trustmcp-verify=")
    recs = {rec["type"]: rec for rec in body["instructions"]["records"]}
    assert recs["CNAME"]["name"] == "trust.example.com"
    assert recs["CNAME"]["value"] == body["cname_target"]
    assert recs["TXT"]["name"] == "_trustmcp.trust.example.com"
    assert recs["TXT"]["value"] == body["txt_value"]


def test_add_custom_domain_rejects_bad_hostname(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    for bad in ["https://trust.example.com", "no-dot", "has space.com", ""]:
        r = client.post(
            f"/v1/vendors/{vid}/custom-domain", headers=h, json={"domain": bad}
        )
        assert r.status_code == 400, bad


def test_get_custom_domain_null_when_unset(client, vendor):
    vid, owner = vendor
    r = client.get(f"/v1/vendors/{vid}/custom-domain", headers=owner_headers(owner))
    assert r.status_code == 200
    assert r.json() == {"domain": None}


def test_verify_success_via_txt(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    ).json()

    def fake_resolve(name, rtype):
        if rtype == "TXT" and name == add["txt_name"]:
            return [add["txt_value"]]
        return []

    monkeypatch.setattr(manage, "doh_resolve", fake_resolve)
    # Ownership proven, edge reachable, but no cert serving yet -> provisioning.
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: True)
    r = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "verified"
    assert body["verified_at"] is not None
    assert body["tls"] == "provisioning"


def test_verify_tls_active_when_serving(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    ).json()
    monkeypatch.setattr(
        manage,
        "doh_resolve",
        lambda name, rtype: [add["txt_value"]] if rtype == "TXT" else [],
    )
    # HTTPS handshake succeeds -> the domain genuinely serves over TLS.
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: True)
    body = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h).json()
    assert body["status"] == "active"
    assert body["tls"] == "active"
    assert body["last_error"] is None


def test_verify_tls_blocked_when_edge_unreachable(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    ).json()
    monkeypatch.setattr(
        manage,
        "doh_resolve",
        lambda name, rtype: [add["txt_value"]] if rtype == "TXT" else [],
    )
    # No cert serving and our edge target doesn't resolve -> honest "blocked", and the
    # domain is verified (ownership) but NOT marked active.
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: False)
    body = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h).json()
    assert body["status"] == "verified"
    assert body["tls"] == "blocked"
    assert add["cname_target"] in body["last_error"]


def test_verify_success_via_cname(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    ).json()

    def fake_resolve(name, rtype):
        if rtype == "CNAME" and name == "trust.example.com":
            return [add["cname_target"] + "."]
        return []

    monkeypatch.setattr(manage, "doh_resolve", fake_resolve)
    # Avoid a real network probe; ownership via CNAME is what this test exercises.
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: True)
    body = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h).json()
    assert body["status"] == "verified"


def test_verify_failure_sets_error(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    monkeypatch.setattr(manage, "doh_resolve", lambda name, rtype: [])
    body = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h).json()
    assert body["status"] == "error"
    assert body["last_error"]
    assert "instructions" in body


def test_verify_network_failure_is_not_500(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )

    def boom(name, rtype):
        raise RuntimeError("network down")

    monkeypatch.setattr(manage, "doh_resolve", boom)
    r = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h)
    assert r.status_code == 200
    assert r.json()["status"] == "error"


def test_verify_registers_with_render_when_enabled(client, vendor, monkeypatch):
    from app.config import Settings, get_settings

    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    ).json()
    monkeypatch.setattr(
        manage, "doh_resolve", lambda name, rtype: [add["txt_value"]] if rtype == "TXT" else []
    )
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: True)

    # Turn on Render for this request and capture the registration call.
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        render_api_key="rnd_test", render_service_id="srv-123"
    )
    seen = {}

    def fake_ensure(settings, domain):
        seen["domain"] = domain
        return {"id": "cd-42", "verification_status": "verified"}

    monkeypatch.setattr(manage, "render_ensure_custom_domain", fake_ensure)
    try:
        body = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h).json()
    finally:
        client.app.dependency_overrides.pop(get_settings, None)

    assert seen["domain"] == "trust.example.com"
    assert body["render_domain_id"] == "cd-42"
    assert body["status"] == "verified" and body["tls"] == "provisioning"


def test_verify_survives_render_error(client, vendor, monkeypatch):
    from app.config import Settings, get_settings
    from app.render_api import RenderError

    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    ).json()
    monkeypatch.setattr(
        manage, "doh_resolve", lambda name, rtype: [add["txt_value"]] if rtype == "TXT" else []
    )
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: True)
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        render_api_key="rnd_test", render_service_id="srv-123"
    )

    def boom(settings, domain):
        raise RenderError("render down")

    monkeypatch.setattr(manage, "render_ensure_custom_domain", boom)
    try:
        r = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h)
    finally:
        client.app.dependency_overrides.pop(get_settings, None)
    # A Render hiccup must not fail verification — ownership is still proven.
    assert r.status_code == 200
    assert r.json()["status"] == "verified"


def test_remove_custom_domain(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    r = client.delete(f"/v1/vendors/{vid}/custom-domain", headers=h)
    assert r.status_code == 200
    assert r.json() == {"domain": None, "removed": True}
    assert client.get(
        f"/v1/vendors/{vid}/custom-domain", headers=h
    ).json() == {"domain": None}


def test_custom_domain_survives_profile_save(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    client.put(
        f"/v1/vendors/{vid}/profile",
        headers=h,
        json={"branding": {"display_name": "Acme"}},
    )
    cd = client.get(f"/v1/vendors/{vid}/custom-domain", headers=h).json()
    assert cd["domain"] == "trust.example.com"


def test_detect_provider(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    monkeypatch.setattr(dns_providers, "detect_provider", lambda d: "cloudflare")
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain/dns/detect",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "cloudflare"
    assert body["supported"] is True and body["can_auto"] is True
    assert body["label"] == "Cloudflare"
    assert body["dns_panel_url"]
    assert any(f["name"] == "api_token" for f in body["fields"])
    # The catalog lets the UI offer a manual override without a hardcoded list.
    assert "cloudflare" in {e["key"] for e in body["catalog"]}


def test_detect_provider_unknown(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    monkeypatch.setattr(dns_providers, "detect_provider", lambda d: None)
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain/dns/detect",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    body = r.json()
    assert body["provider"] is None
    assert body["supported"] is False and body["can_auto"] is False
    assert body["label"] is None and body["fields"] == []
    # Catalog is still returned so the user can pick a provider manually.
    assert body["catalog"]


def test_auto_configure_success(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    calls = {}

    def fake_upsert(self, domain, records, credentials):
        calls["domain"] = domain
        calls["types"] = sorted(r.type for r in records)
        calls["creds"] = credentials

    monkeypatch.setattr(
        dns_providers.CloudflareProvider, "upsert_records", fake_upsert
    )
    # Adapters operate on the registrable zone, not the sub-host.
    monkeypatch.setattr(dns_providers, "zone_for", lambda d: "example.com")
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain/dns/auto-configure",
        headers=h,
        json={
            "domain": "trust.example.com",
            "provider": "cloudflare",
            "credentials": {"api_token": "secret"},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    assert calls["types"] == ["CNAME", "TXT"]
    assert calls["domain"] == "example.com"  # zone, not the sub-host

    # Credentials must never be persisted in branding or the audit log.
    cd = client.get(f"/v1/vendors/{vid}/custom-domain", headers=h).json()
    assert "secret" not in str(cd)
    audit = client.get(f"/v1/vendors/{vid}/audit", headers=h).json()
    auto = [a for a in audit if a["action"] == "custom_domain.dns_auto"]
    assert auto and auto[0]["detail"] == "cloudflare"
    assert "secret" not in str(audit)


def test_auto_configure_provider_failure_returns_400(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )

    def boom(self, domain, records, credentials):
        raise dns_providers.DnsProviderError("bad api key")

    monkeypatch.setattr(dns_providers.GoDaddyProvider, "upsert_records", boom)
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain/dns/auto-configure",
        headers=h,
        json={
            "domain": "trust.example.com",
            "provider": "godaddy",
            "credentials": {"api_key": "x", "api_secret": "y"},
        },
    )
    assert r.status_code == 400
    assert "bad api key" in r.json()["detail"]


def test_auto_configure_requires_matching_domain(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain/dns/auto-configure",
        headers=h,
        json={
            "domain": "other.example.com",
            "provider": "cloudflare",
            "credentials": {"api_token": "x"},
        },
    )
    assert r.status_code == 404
