"""Domain Connect — the open "Plaid for DNS" standard.

Domain Connect (https://www.domainconnect.org) lets a service provider (us) apply
DNS records to a customer's zone *without* the customer ever pasting an API key.
The customer's DNS provider (GoDaddy, IONOS, 1&1, Cloudflare, and ~dozens more)
hosts a consent UI; we send the user there in a popup with a template + the values
to fill in, they authenticate to their own provider and approve, and the provider
writes the records directly. Nothing is stored on our side.

This module implements the client half of the **synchronous** flow:

  1. Discovery — find the zone's Domain Connect API host from its
     ``_domainconnect`` TXT record (walking up to the registrable apex, since the
     record lives there, not on the ``trust.`` subdomain the customer points at us).
  2. Settings — GET ``/v2/{zone}/settings`` for that host to learn whether the
     provider supports the synchronous flow and where its consent UI lives.
  3. Apply URL — build the provider's ``/apply`` URL for our published template,
     pre-filled with the CNAME target and TXT value, plus a redirect back to us.

Going live additionally requires our template (``providerId``/``serviceId``) to be
registered with the providers — they ingest templates from the Domain Connect
open-source templates repo. The template we submit lives under
``apps/network/domain-connect/templates/``.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

_HTTP_TIMEOUT = 5


def _doh_txt(name: str) -> list[str]:
    """Resolve TXT records for ``name`` via DNS-over-HTTPS (stdlib only). Returns
    de-quoted values, or [] on any failure."""
    url = "https://dns.google/resolve?name=" + urllib.parse.quote(name) + "&type=TXT"
    try:
        with urllib.request.urlopen(url, timeout=_HTTP_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode(errors="ignore"))
    except Exception:
        return []
    out: list[str] = []
    for answer in payload.get("Answer", []) or []:
        data = str(answer.get("data", "")).strip()
        if data.startswith('"') and data.endswith('"'):
            data = data[1:-1]
        data = data.strip().rstrip(".")
        if data:
            out.append(data)
    return out


def _get_json(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=_HTTP_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode(errors="ignore"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def discover_zone(domain: str) -> tuple[str, str] | None:
    """Return ``(zone, api_host)`` for the nearest ancestor that advertises a Domain
    Connect endpoint via a ``_domainconnect`` TXT record, else None. Domain Connect is
    configured at the registrable apex (``example.com``), not the subdomain a
    customer points at us (``trust.example.com``), so we walk up the labels."""
    domain = (domain or "").strip().lower().rstrip(".")
    if not domain:
        return None
    labels = domain.split(".")
    for i in range(max(len(labels) - 1, 1)):
        zone = ".".join(labels[i:])
        for txt in _doh_txt("_domainconnect." + zone):
            host = txt.strip().lower().rstrip(".")
            # The TXT value is a bare hostname (the provider's DC API root).
            if host and "/" not in host and "." in host:
                return zone, host
    return None


def get_settings(api_host: str, zone: str) -> dict | None:
    """Fetch the provider's Domain Connect settings for ``zone``."""
    url = f"https://{api_host}/v2/{urllib.parse.quote(zone)}/settings"
    return _get_json(url)


def build_apply_flow(
    domain: str,
    *,
    template_params: dict[str, str],
    provider_id: str,
    service_id: str,
    redirect_uri: str = "",
    state: str = "",
) -> dict | None:
    """Discover the customer's DNS provider and, if it supports the synchronous flow,
    return ``{provider_name, apply_url, zone, host}``. ``template_params`` fills the
    ``%variable%`` placeholders in our published template (e.g. ``cname``, ``token``).
    The ``apply_url`` is the provider-hosted consent page that, once approved, writes
    our records. Returns None when the domain has no Domain Connect support (caller
    falls back to the per-provider API path or manual records)."""
    found = discover_zone(domain)
    if not found:
        return None
    zone, api_host = found
    settings = get_settings(api_host, zone)
    if not settings:
        return None
    sync_ux = str(settings.get("urlSyncUX") or "").strip().rstrip("/")
    if not sync_ux.startswith("https://"):
        return None

    # The "host" parameter is the sub-zone portion the records hang off of: for
    # trust.example.com in zone example.com that's "trust"; for an apex it's "".
    host = domain[: -len(zone)].rstrip(".") if domain != zone else ""

    # Standard domain/host/redirect/state fields plus our template variables. Reserved
    # keys win over template_params; empty values are omitted.
    params = {
        **template_params,
        "domain": zone,
        "host": host,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v != ""})
    apply_url = (
        f"{sync_ux}/v2/domainTemplates/providers/"
        f"{urllib.parse.quote(provider_id)}/services/{urllib.parse.quote(service_id)}"
        f"/apply?{query}"
    )
    provider_name = (
        settings.get("providerName") or settings.get("providerId") or api_host
    )
    return {
        "provider_name": str(provider_name),
        "apply_url": apply_url,
        "zone": zone,
        "host": host,
    }
