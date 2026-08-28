from __future__ import annotations

import re

import httpx

from .config import Settings

# Allow only the characters that can appear in a hostname. This strips schemes,
# paths, quotes, backslashes, and control chars so the value is safe to embed in a
# SOQL/HubSpot query (defense-in-depth; the token is already read-only + scoped).
_DOMAIN_RE = re.compile(r"[^a-z0-9.\-]")


def _clean(domain: str) -> str:
    host = domain.strip().lower().replace("https://", "").replace("http://", "").split("/")[0]
    return _DOMAIN_RE.sub("", host)


def verify_relationship(settings: Settings, domain: str, vendor=None) -> dict:
    """Check whether `domain` is an existing customer in the configured CRM.

    Per-vendor credentials (when set on the vendor) take precedence over the
    network-global config. Returns {configured, provider, found, detail}. Used for
    auto-release and recommendations on every request channel (web, API, MCP)."""
    domain = _clean(domain)

    # Per-vendor CRM credentials win. The vendor connects either via a pasted API
    # token ("api", the default) or via its own CRM MCP server ("mcp").
    v_provider = getattr(vendor, "crm_provider", None) if vendor is not None else None
    if v_provider:
        connection = getattr(vendor, "crm_connection", None) or "api"
        if connection == "mcp" and getattr(vendor, "crm_mcp_url", None):
            return _mcp(domain, vendor, v_provider)
        if getattr(vendor, "crm_token", None):
            if v_provider == "hubspot":
                return _hubspot(domain, vendor.crm_token)
            if v_provider == "salesforce" and getattr(vendor, "crm_instance_url", None):
                return _salesforce(domain, vendor.crm_instance_url, vendor.crm_token)

    if settings.hubspot_token:
        return _hubspot(domain, settings.hubspot_token)
    if settings.salesforce_instance_url and settings.salesforce_access_token:
        return _salesforce(
            domain, settings.salesforce_instance_url, settings.salesforce_access_token
        )
    return {"configured": False, "provider": "none", "found": None}


def _mcp(domain: str, vendor, provider: str) -> dict:
    """Verify a relationship via the vendor's own CRM MCP server (best-effort).

    Auth is either a static bearer token or an OAuth client-credentials grant."""
    from .mcp_client import oauth_client_credentials_token, query_company

    auth = getattr(vendor, "crm_mcp_auth", None) or (
        "bearer" if getattr(vendor, "crm_mcp_token", None) else "none"
    )
    token: str | None = None
    if auth == "oauth" and getattr(vendor, "crm_mcp_token_url", None):
        token = oauth_client_credentials_token(
            vendor.crm_mcp_token_url,
            vendor.crm_mcp_client_id or "",
            vendor.crm_mcp_client_secret or "",
        )
    elif auth == "bearer":
        token = getattr(vendor, "crm_mcp_token", None)

    res = query_company(vendor.crm_mcp_url, token, domain)
    return {
        "configured": True,
        "provider": provider,
        "found": res.get("found"),
        "detail": res.get("detail"),
    }


def _hubspot(domain: str, token: str) -> dict:
    try:
        r = httpx.post(
            "https://api.hubapi.com/crm/v3/objects/companies/search",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "filterGroups": [
                    {"filters": [{"propertyName": "domain", "operator": "EQ", "value": domain}]}
                ],
                "properties": ["name", "domain"],
                "limit": 1,
            },
            timeout=15,
        )
        if r.status_code != 200:
            return {
                "configured": True, "provider": "hubspot",
                "found": None, "detail": f"HTTP {r.status_code}",
            }
        data = r.json()
        found = (data.get("total") or len(data.get("results", []))) > 0
        return {"configured": True, "provider": "hubspot", "found": found}
    except Exception as e:  # pragma: no cover - network dependent
        return {"configured": True, "provider": "hubspot", "found": None, "detail": str(e)}


def _salesforce(domain: str, instance: str, token: str) -> dict:
    try:
        soql = f"SELECT Id, Name FROM Account WHERE Website LIKE '%{domain}%' LIMIT 1"
        r = httpx.get(
            f"{instance}/services/data/v60.0/query",
            params={"q": soql},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if r.status_code != 200:
            return {
                "configured": True, "provider": "salesforce",
                "found": None, "detail": f"HTTP {r.status_code}",
            }
        found = (r.json().get("totalSize") or 0) > 0
        return {"configured": True, "provider": "salesforce", "found": found}
    except Exception as e:  # pragma: no cover - network dependent
        return {"configured": True, "provider": "salesforce", "found": None, "detail": str(e)}
