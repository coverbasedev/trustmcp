from __future__ import annotations

import json
import urllib.parse

import app.domain_connect as dc
from tests.conftest import owner_headers


class _FakeResp:
    def __init__(self, payload):
        self._raw = json.dumps(payload).encode()

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _godaddy_doh(url, timeout=None):
    """Fake DoH + settings backend for a GoDaddy-managed example.com zone where the
    custom domain is the trust. subdomain (so discovery must walk up to the apex)."""
    if "dns.google/resolve" in url:
        if "name=_domainconnect.trust.example.com" in url:
            return _FakeResp({"Answer": []})  # no DC record on the subdomain
        if "name=_domainconnect.example.com" in url:
            return _FakeResp({"Answer": [{"data": '"_domainconnect.gd.domaincontrol.com."'}]})
        return _FakeResp({"Answer": []})
    if "/v2/example.com/settings" in url:
        return _FakeResp(
            {
                "providerId": "godaddy",
                "providerName": "GoDaddy",
                "urlSyncUX": "https://dcc.godaddy.com/manage",
                "urlAPI": "https://api.godaddy.com",
            }
        )
    return _FakeResp({})


def test_discover_zone_walks_up_to_apex(monkeypatch):
    monkeypatch.setattr(dc.urllib.request, "urlopen", _godaddy_doh)
    assert dc.discover_zone("trust.example.com") == (
        "example.com",
        "_domainconnect.gd.domaincontrol.com",
    )


def test_discover_zone_none_when_no_record(monkeypatch):
    monkeypatch.setattr(
        dc.urllib.request,
        "urlopen",
        lambda url, timeout=None: _FakeResp({"Answer": []}),
    )
    assert dc.discover_zone("trust.example.com") is None


def test_build_apply_flow_builds_sync_url(monkeypatch):
    monkeypatch.setattr(dc.urllib.request, "urlopen", _godaddy_doh)
    flow = dc.build_apply_flow(
        "trust.example.com",
        template_params={"cname": "cname.trustmcp.app", "token": "abc123"},
        provider_id="trustmcp.app",
        service_id="trust-center",
        redirect_uri="https://app.trustmcp.app/domain-connect/callback",
        state="vendor_1",
    )
    assert flow is not None
    assert flow["provider_name"] == "GoDaddy"
    assert flow["zone"] == "example.com"
    assert flow["host"] == "trust"

    url = flow["apply_url"]
    assert url.startswith(
        "https://dcc.godaddy.com/manage/v2/domainTemplates/providers/"
        "trustmcp.app/services/trust-center/apply?"
    )
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q["domain"] == ["example.com"]
    assert q["host"] == ["trust"]
    assert q["cname"] == ["cname.trustmcp.app"]
    assert q["token"] == ["abc123"]
    assert q["redirect_uri"] == ["https://app.trustmcp.app/domain-connect/callback"]
    assert q["state"] == ["vendor_1"]


def test_build_apply_flow_apex_has_empty_host(monkeypatch):
    def backend(url, timeout=None):
        if "dns.google/resolve" in url and "name=_domainconnect.example.com" in url:
            return _FakeResp({"Answer": [{"data": "_domainconnect.gd.domaincontrol.com"}]})
        if "/v2/example.com/settings" in url:
            return _FakeResp({"providerName": "GoDaddy", "urlSyncUX": "https://dcc.godaddy.com/manage"})
        return _FakeResp({"Answer": []})

    monkeypatch.setattr(dc.urllib.request, "urlopen", backend)
    flow = dc.build_apply_flow(
        "example.com",
        template_params={"cname": "cname.trustmcp.app", "token": "abc"},
        provider_id="trustmcp.app",
        service_id="trust-center",
    )
    assert flow is not None
    assert flow["host"] == ""
    # host="" is omitted from the query entirely.
    q = urllib.parse.parse_qs(urllib.parse.urlparse(flow["apply_url"]).query)
    assert "host" not in q


def test_build_apply_flow_none_without_sync_support(monkeypatch):
    def backend(url, timeout=None):
        if "dns.google/resolve" in url and "name=_domainconnect.example.com" in url:
            return _FakeResp({"Answer": [{"data": "_domainconnect.example.net"}]})
        if "/settings" in url:
            # Settings present but no synchronous UX advertised.
            return _FakeResp({"providerName": "SomeDNS", "urlAsyncUX": "https://x/async"})
        return _FakeResp({"Answer": []})

    monkeypatch.setattr(dc.urllib.request, "urlopen", backend)
    assert (
        dc.build_apply_flow(
            "trust.example.com",
            template_params={"cname": "c", "token": "t"},
            provider_id="p",
            service_id="s",
        )
        is None
    )


# ---- endpoint ----------------------------------------------------------------


def test_domain_connect_discover_endpoint(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain", headers=h, json={"domain": "trust.example.com"}
    )
    import app.domain_connect as dcmod

    monkeypatch.setattr(dcmod.urllib.request, "urlopen", _godaddy_doh)
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain/dns/domain-connect/discover",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["supported"] is True
    assert body["provider_name"] == "GoDaddy"
    assert "/services/trust-center/apply?" in body["apply_url"]


def test_domain_connect_discover_unsupported(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(
        f"/v1/vendors/{vid}/custom-domain", headers=h, json={"domain": "trust.example.com"}
    )
    import app.domain_connect as dcmod

    monkeypatch.setattr(
        dcmod.urllib.request, "urlopen", lambda url, timeout=None: _FakeResp({"Answer": []})
    )
    r = client.post(
        f"/v1/vendors/{vid}/custom-domain/dns/domain-connect/discover",
        headers=h,
        json={"domain": "trust.example.com"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"supported": False, "provider_name": None, "apply_url": None}
