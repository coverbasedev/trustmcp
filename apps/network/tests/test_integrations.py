"""Per-vendor integration credentials: Docusign e-sign config + CRM-over-MCP."""
from __future__ import annotations

import json
from types import SimpleNamespace

import httpx

from app.config import Settings
from app.esign import esign_enabled_for, resolve_config
from app.mcp_client import _build_args, _looks_found, _pick_tool, query_company
from tests.conftest import owner_headers

# Full per-vendor Docusign credential set used across the e-sign tests below.
_DOCUSIGN = {
    "docusign_account_id": "acct-1",
    "docusign_integration_key": "ikey-1",
    "docusign_user_id": "user-1",
    "docusign_private_key": "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----",
}


def test_resolve_config_vendor_overrides_global():
    settings = Settings(
        environment="test",
        docusign_account_id="global-acct",
        docusign_base_uri="https://demo.docusign.net/restapi",
    )
    vendor = SimpleNamespace(
        docusign_account_id="vendor-acct",
        docusign_integration_key=None,  # falls back to global (empty here)
        docusign_base_uri="https://na3.docusign.net/restapi",
        dpa_template_id="tmpl-v",
    )
    cfg = resolve_config(settings, vendor)
    assert cfg.account_id == "vendor-acct"  # vendor wins
    assert cfg.base_uri == "https://na3.docusign.net/restapi"  # vendor wins
    assert cfg.dpa_template_id == "tmpl-v"


def test_esign_enabled_for_vendor_without_global():
    settings = Settings(environment="test")  # no global Docusign
    assert esign_enabled_for(settings, None) is False
    vendor = SimpleNamespace(**_DOCUSIGN)
    assert esign_enabled_for(settings, vendor) is True


def test_docusign_per_vendor_config_round_trips_without_leaking_secrets(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={
        **_DOCUSIGN,
        "docusign_connect_hmac_key": "hmac-secret",
        "docusign_base_uri": "https://na3.docusign.net/restapi",
    })
    v = client.get(f"/v1/vendors/{vid}", headers=h).json()
    # Identifiers/URLs are echoed for the form...
    assert v["docusign_account_id"] == "acct-1"
    assert v["docusign_base_uri"] == "https://na3.docusign.net/restapi"
    assert v["docusign_configured"] is True
    # ...but secrets are never returned, only "set" booleans.
    assert "docusign_private_key" not in v
    assert "docusign_connect_hmac_key" not in v
    assert v["docusign_private_key_set"] is True
    assert v["docusign_connect_hmac_key_set"] is True


def test_send_endpoint_works_once_vendor_has_docusign(client, vendor, monkeypatch):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={
        "dpa_self_serve": True, "dpa_template_id": "tmpl-1", **_DOCUSIGN,
    })
    client.post(
        f"/v1/vendors/{vid}/agreements",
        json={"company_name": "Globex", "signer_name": "Pat", "signer_email": "pat@globex.com"},
    )
    agr = client.get(f"/v1/vendors/{vid}/agreements", headers=h).json()[0]
    # Stub the Docusign HTTP calls so we exercise the per-vendor enablement path.
    import app.esign as esign
    monkeypatch.setattr(esign, "_access_token", lambda cfg: "tok")
    monkeypatch.setattr(esign.httpx, "post", lambda *a, **k: SimpleNamespace(
        raise_for_status=lambda: None, json=lambda: {"envelopeId": "env-xyz"}))
    r = client.post(f"/v1/vendors/{vid}/agreements/{agr['id']}/send", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["envelope_id"] == "env-xyz"


def test_crm_mcp_token_not_leaked(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={
        "crm_provider": "hubspot", "crm_connection": "mcp",
        "crm_mcp_url": "https://crm.example.com/mcp", "crm_mcp_token": "mcp-secret",
    })
    v = client.get(f"/v1/vendors/{vid}", headers=h).json()
    assert v["crm_connection"] == "mcp"
    assert v["crm_mcp_url"] == "https://crm.example.com/mcp"
    assert v["crm_mcp_configured"] is True
    assert "crm_mcp_token" not in v


# --- MCP client heuristics ---------------------------------------------------


def test_pick_tool_prefers_company_search():
    tools = [
        {"name": "send_email", "description": "send an email"},
        {"name": "search_companies", "description": "search CRM companies by domain"},
    ]
    assert _pick_tool(tools)["name"] == "search_companies"
    assert _pick_tool([{"name": "noop", "description": "does nothing"}]) is None


def test_build_args_picks_known_argument():
    tool = {"inputSchema": {"properties": {"domain": {"type": "string"}, "limit": {}}}}
    assert _build_args(tool, "acme.com") == {"domain": "acme.com"}
    # No recognizable property -> first declared, else "query".
    assert _build_args({"inputSchema": {"properties": {"foo": {}}}}, "x") == {"foo": "x"}
    assert _build_args({}, "x") == {"query": "x"}


def test_looks_found():
    assert _looks_found({"content": [{"type": "text", "text": "Acme Inc — acme.com"}]}) is True
    assert _looks_found({"content": [{"type": "text", "text": "No results found"}]}) is False
    assert _looks_found({"content": []}) is False
    assert _looks_found({"isError": True}) is None


def test_diagnostics_requires_service_token(client):
    assert client.get("/v1/meta/diagnostics").status_code == 401
    bad = client.get("/v1/meta/diagnostics", headers={"X-TrustMCP-Service-Token": "nope"})
    assert bad.status_code == 401


def test_diagnostics_reports_feature_flags(client, service_token):
    r = client.get("/v1/meta/diagnostics", headers={"X-TrustMCP-Service-Token": service_token})
    assert r.status_code == 200
    d = r.json()
    # Booleans/identifiers only — never secret values.
    for key in ("smtp_configured", "ask_enabled", "s3_configured", "sentry_configured",
                "signing_key_stable", "database", "environment"):
        assert key in d
    assert isinstance(d["smtp_configured"], bool)
    assert "private_key" not in json.dumps(d).lower()
    assert d["database"] == "sqlite"  # the test DB


def test_query_company_via_mock_transport():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        method = body.get("method")
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "initialize":
            result = {"protocolVersion": "2025-06-18", "capabilities": {}}
        elif method == "tools/list":
            result = {"tools": [{"name": "search_companies",
                                 "description": "find a company by domain",
                                 "inputSchema": {"properties": {"domain": {"type": "string"}}}}]}
        elif method == "tools/call":
            assert body["params"]["arguments"] == {"domain": "globex.com"}
            result = {"content": [{"type": "text", "text": "Globex Corporation (globex.com)"}]}
        else:  # pragma: no cover
            return httpx.Response(400)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body.get("id"), "result": result})

    res = query_company("https://crm.example.com/mcp", "tok", "globex.com",
                        transport=httpx.MockTransport(handler))
    assert res["found"] is True
    assert res["detail"] == "search_companies"
