from __future__ import annotations

import io
import json

import pytest

import app.dns_providers as dns_providers
from app.dns_providers import (
    PROVIDERS,
    REGISTRY,
    CloudflareProvider,
    DnsProviderError,
    DnsRecord,
    GandiProvider,
    GoDaddyProvider,
    NamecheapProvider,
    PorkbunProvider,
    VercelProvider,
    detect_provider,
    provider_catalog,
    provider_meta,
)


class _FakeResp:
    def __init__(self, payload):
        self._raw = json.dumps(payload).encode()

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_godaddy_upsert_builds_requests(monkeypatch):
    seen = []

    def fake_urlopen(req, timeout=None):
        seen.append((req.get_method(), req.full_url, req.headers))
        return _FakeResp({})

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    records = [
        DnsRecord("CNAME", "trust.example.com", "cname.trustmcp.app"),
        DnsRecord("TXT", "_trustmcp.trust.example.com", "trustmcp-verify=abc"),
    ]
    GoDaddyProvider().upsert_records(
        "example.com", records, {"api_key": "k", "api_secret": "s"}
    )
    assert len(seen) == 2
    methods = {m for m, _, _ in seen}
    assert methods == {"PUT"}
    # sso-key auth header present.
    assert any("sso-key k:s" in str(h) for _, _, h in seen)


def test_godaddy_requires_credentials():
    with pytest.raises(DnsProviderError):
        GoDaddyProvider().upsert_records("example.com", [], {})


def test_cloudflare_upsert_finds_zone_and_posts(monkeypatch):
    calls = []

    def fake_urlopen(req, timeout=None):
        url = req.full_url
        method = req.get_method()
        calls.append((method, url))
        if "zones?name=" in url:
            return _FakeResp({"result": [{"id": "zone123"}]})
        if "dns_records?" in url and method == "GET":
            return _FakeResp({"result": []})  # nothing existing -> POST
        return _FakeResp({"result": {"id": "rec1"}})

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    records = [DnsRecord("CNAME", "trust.example.com", "cname.trustmcp.app")]
    CloudflareProvider().upsert_records(
        "example.com", records, {"api_token": "tok"}
    )
    assert any(m == "POST" for m, _ in calls)


def test_cloudflare_no_zone_raises(monkeypatch):
    monkeypatch.setattr(
        dns_providers.urllib.request,
        "urlopen",
        lambda req, timeout=None: _FakeResp({"result": []}),
    )
    with pytest.raises(DnsProviderError):
        CloudflareProvider().upsert_records(
            "example.com",
            [DnsRecord("CNAME", "trust.example.com", "x")],
            {"api_token": "tok"},
        )


def test_namecheap_raises_not_implemented():
    with pytest.raises(NotImplementedError):
        NamecheapProvider().upsert_records(
            "example.com",
            [DnsRecord("CNAME", "trust.example.com", "x")],
            {"api_user": "u", "api_key": "k", "username": "u", "client_ip": "1.2.3.4"},
        )


def test_http_error_becomes_dns_provider_error(monkeypatch):
    import urllib.error

    def fake_urlopen(req, timeout=None):
        raise urllib.error.HTTPError(
            req.full_url, 401, "Unauthorized", {}, io.BytesIO(b"nope")
        )

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(DnsProviderError):
        GoDaddyProvider().upsert_records(
            "example.com",
            [DnsRecord("CNAME", "trust.example.com", "x")],
            {"api_key": "k", "api_secret": "s"},
        )


def test_detect_provider_maps_nameserver(monkeypatch):
    def fake_urlopen(req, timeout=None):
        return _FakeResp(
            {"Answer": [{"data": "ns1.domaincontrol.com."}]}
        )

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    assert detect_provider("example.com") == "godaddy"


def test_detect_provider_walks_up_to_apex_for_subdomain(monkeypatch):
    # A subdomain (trust.example.com) has no NS delegation of its own; the apex
    # (example.com) does. Detection must walk up the labels to find it.
    seen = []

    # detect_provider calls urlopen(url) with a plain string URL (not a Request).
    def fake_urlopen(url, timeout=None):
        seen.append(url)
        if "name=trust.example.com" in url:
            # No Answer for the undelegated subdomain — detection must walk up.
            return _FakeResp({"Answer": []})
        return _FakeResp({"Answer": [{"data": "ns07.domaincontrol.com."}]})

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    assert detect_provider("trust.example.com") == "godaddy"
    # Confirms it actually queried the apex, not just the subdomain.
    assert any("name=example.com" in u for u in seen)


def test_detect_provider_reads_authority_soa(monkeypatch):
    # When the subdomain query itself returns the parent SOA in Authority, detection
    # should resolve from that without a second round trip.
    def fake_urlopen(url, timeout=None):
        return _FakeResp(
            {"Authority": [{"type": 6, "data": "ns01.domaincontrol.com. dns.jomax.net. 1 1 1 1 1"}]}
        )

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    assert detect_provider("trust.example.com") == "godaddy"


def test_detect_provider_unknown(monkeypatch):
    monkeypatch.setattr(
        dns_providers.urllib.request,
        "urlopen",
        lambda req, timeout=None: _FakeResp({"Answer": [{"data": "ns1.other.net."}]}),
    )
    assert detect_provider("example.com") is None


def test_detect_provider_network_failure(monkeypatch):
    def boom(req, timeout=None):
        raise RuntimeError("dns down")

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", boom)
    assert detect_provider("example.com") is None


def test_detect_provider_vercel(monkeypatch):
    monkeypatch.setattr(
        dns_providers.urllib.request,
        "urlopen",
        lambda req, timeout=None: _FakeResp({"Answer": [{"data": "ns1.vercel-dns.com."}]}),
    )
    assert detect_provider("example.com") == "vercel"


def test_detect_provider_route53_substring(monkeypatch):
    # AWS nameservers (ns-123.awsdns-45.net) match by substring, not a clean suffix.
    monkeypatch.setattr(
        dns_providers.urllib.request,
        "urlopen",
        lambda req, timeout=None: _FakeResp({"Answer": [{"data": "ns-512.awsdns-00.net."}]}),
    )
    assert detect_provider("example.com") == "route53"


def test_registry_invariants():
    # Every adapter is registered, and every auto-capable provider has credential fields.
    for key, adapter in PROVIDERS.items():
        assert REGISTRY[key].adapter is adapter
    for info in REGISTRY.values():
        if info.auto:
            assert info.fields, f"{info.key} is auto but has no fields"
    # Catalog only lists auto-capable providers and carries their fields.
    cat = provider_catalog()
    assert all(e["can_auto"] and e["fields"] for e in cat)
    assert {"vercel", "cloudflare", "godaddy"} <= {e["key"] for e in cat}


def test_provider_meta_detect_only_vs_auto():
    # Namecheap is detected + deep-linked but not auto (destructive API).
    nc = provider_meta("namecheap")
    assert nc["label"] == "Namecheap"
    assert nc["can_auto"] is False and nc["dns_panel_url"]
    # Vercel is auto with an API token field.
    vc = provider_meta("vercel")
    assert vc["can_auto"] is True
    assert any(f["name"] == "api_token" and f["secret"] for f in vc["fields"])
    assert provider_meta(None) == {}
    assert provider_meta("nope") == {}


def test_vercel_upsert_deletes_then_creates(monkeypatch):
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append((req.get_method(), req.full_url))
        if req.get_method() == "GET":
            return _FakeResp({"records": [{"id": "old1", "type": "CNAME", "name": "trust"}]})
        return _FakeResp({})

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    VercelProvider().upsert_records(
        "example.com",
        [DnsRecord("CNAME", "trust.example.com", "cname.trustmcp.app")],
        {"api_token": "tok"},
    )
    methods = [m for m, _ in calls]
    assert "DELETE" in methods and "POST" in methods


def test_porkbun_upsert_edits_by_name_type(monkeypatch):
    seen = []

    def fake_urlopen(req, timeout=None):
        seen.append(req.full_url)
        return _FakeResp({"status": "SUCCESS"})

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    PorkbunProvider().upsert_records(
        "example.com",
        [DnsRecord("CNAME", "trust.example.com", "cname.trustmcp.app")],
        {"api_key": "k", "api_secret": "s"},
    )
    assert any("editByNameType/example.com/CNAME/trust" in u for u in seen)


def test_gandi_upsert_puts_rrset(monkeypatch):
    seen = []

    def fake_urlopen(req, timeout=None):
        seen.append((req.get_method(), req.full_url))
        return _FakeResp({})

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    GandiProvider().upsert_records(
        "example.com",
        [DnsRecord("CNAME", "trust.example.com", "cname.trustmcp.app")],
        {"api_key": "k"},
    )
    assert any(m == "PUT" and "/records/trust/CNAME" in u for m, u in seen)


def test_porkbun_requires_credentials():
    with pytest.raises(DnsProviderError):
        PorkbunProvider().upsert_records("example.com", [], {})


def test_zone_for_walks_to_delegated_apex(monkeypatch):
    # trust.example.com isn't a zone cut; example.com is (NS in Answer).
    def fake_urlopen(url, timeout=None):
        if "name=example.com" in url:
            return _FakeResp({"Answer": [{"type": 2, "data": "ns1.example.net."}]})
        return _FakeResp({"Authority": [{"type": 6, "data": "soa"}]})

    monkeypatch.setattr(dns_providers.urllib.request, "urlopen", fake_urlopen)
    assert dns_providers.zone_for("trust.example.com") == "example.com"


def test_zone_for_apex_is_itself():
    assert dns_providers.zone_for("example.com") == "example.com"


def test_zone_for_falls_back_without_dns(monkeypatch):
    monkeypatch.setattr(
        dns_providers.urllib.request, "urlopen",
        lambda url, timeout=None: (_ for _ in ()).throw(RuntimeError("dns down")),
    )
    assert dns_providers.zone_for("a.b.example.com") == "example.com"
