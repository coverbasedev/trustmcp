from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

# All HTTP here uses only the stdlib (no new deps). Network calls use short timeouts
# and raise a clear exception on failure so the caller can fall back to manual setup.
# IMPORTANT: never log, store, or audit DNS-provider credentials.

_HTTP_TIMEOUT = 5  # seconds


@dataclass
class DnsRecord:
    type: str  # e.g. "CNAME" | "TXT"
    name: str  # the record name (host)
    value: str  # the record value (target / TXT content)


class DnsProviderError(Exception):
    """Raised when a provider API call fails (auth, network, or API error)."""


def _http_json(
    method: str,
    url: str,
    *,
    headers: dict | None = None,
    body: dict | None = None,
) -> dict:
    """Issue a JSON HTTP request via stdlib urllib. Returns the decoded JSON body
    (or {} when empty). Raises DnsProviderError on any failure."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            raw = resp.read().decode(errors="ignore")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode(errors="ignore")[:300]
        except Exception:
            pass
        raise DnsProviderError(f"provider API error {e.code}: {detail}") from e
    except Exception as e:
        raise DnsProviderError(f"provider request failed: {e}") from e
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        return {}


class DnsProvider:
    """Base provider adapter. Subclasses create/replace the requested records."""

    name: str = "base"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        """Create or update the given records on the provider. Raises
        DnsProviderError (or a subclass) on failure."""
        raise NotImplementedError


def _subdomain_host(domain: str, record_name: str) -> str:
    """Return the host portion of record_name relative to the registrable domain
    (providers usually want the host, not the FQDN). '@' for the apex."""
    record_name = record_name.rstrip(".")
    domain = domain.rstrip(".")
    if record_name == domain:
        return "@"
    suffix = f".{domain}"
    if record_name.endswith(suffix):
        return record_name[: -len(suffix)]
    return record_name


def _fqdn(value: str) -> str:
    """Ensure a CNAME target is a trailing-dot FQDN (some providers require it)."""
    v = value.strip()
    return v if v.endswith(".") else v + "."


# --- Provider API adapters ----------------------------------------------------
# Each adapter performs a non-destructive upsert of a single (type, host) record at
# a time. They never touch other records in the zone. Credentials are passed in and
# used in-process only — never stored.


class GoDaddyProvider(DnsProvider):
    name = "godaddy"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        key = credentials.get("api_key")
        secret = credentials.get("api_secret")
        if not key or not secret:
            raise DnsProviderError("GoDaddy requires api_key and api_secret")
        headers = {"Authorization": f"sso-key {key}:{secret}"}
        # GoDaddy replaces all records of a (type, name); PUT one record-set at a time.
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            url = (
                f"https://api.godaddy.com/v1/domains/{urllib.parse.quote(domain)}"
                f"/records/{rec.type}/{urllib.parse.quote(host)}"
            )
            payload = [{"data": rec.value, "ttl": 600}]
            _http_json("PUT", url, headers=headers, body=payload)  # type: ignore[arg-type]


class CloudflareProvider(DnsProvider):
    name = "cloudflare"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        token = credentials.get("api_token")
        if not token:
            raise DnsProviderError("Cloudflare requires api_token")
        headers = {"Authorization": f"Bearer {token}"}
        # Find the zone for the registrable domain.
        zone_resp = _http_json(
            "GET",
            "https://api.cloudflare.com/client/v4/zones?name="
            + urllib.parse.quote(domain),
            headers=headers,
        )
        zones = zone_resp.get("result") or []
        if not zones:
            raise DnsProviderError(f"no Cloudflare zone found for {domain}")
        zone_id = zones[0].get("id")
        base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
        for rec in records:
            body = {
                "type": rec.type,
                "name": rec.name,
                "content": rec.value,
                "ttl": 600,
                "proxied": False,
            }
            # Upsert: if a record with this name+type exists, PUT it; else POST.
            existing = _http_json(
                "GET",
                f"{base}?type={rec.type}&name=" + urllib.parse.quote(rec.name),
                headers=headers,
            )
            found = existing.get("result") or []
            if found:
                rec_id = found[0].get("id")
                _http_json("PUT", f"{base}/{rec_id}", headers=headers, body=body)
            else:
                _http_json("POST", base, headers=headers, body=body)


class NamecheapProvider(DnsProvider):
    name = "namecheap"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        api_user = credentials.get("api_user")
        api_key = credentials.get("api_key")
        username = credentials.get("username")
        client_ip = credentials.get("client_ip")
        if not all([api_user, api_key, username, client_ip]):
            raise DnsProviderError(
                "Namecheap requires api_user, api_key, username, and client_ip"
            )
        # Namecheap's setHosts is destructive (it replaces ALL host records for the
        # domain), so a correct implementation must first getHosts and merge. That
        # round-trip plus XML parsing is fragile to do safely here; guide the user to
        # manual setup rather than risk clobbering their existing DNS.
        parts = (domain or "").rsplit(".", 2)
        sld, tld = (parts[-2], parts[-1]) if len(parts) >= 2 else ("", "")
        params = {
            "ApiUser": api_user,
            "ApiKey": api_key,
            "UserName": username,
            "ClientIp": client_ip,
            "Command": "namecheap.domains.dns.setHosts",
            "SLD": sld,
            "TLD": tld,
        }
        for i, rec in enumerate(records, start=1):
            params[f"HostName{i}"] = _subdomain_host(domain, rec.name)
            params[f"RecordType{i}"] = rec.type
            params[f"Address{i}"] = rec.value
            params[f"TTL{i}"] = "600"
        # Request shape is prepared; intentionally not executed to avoid wiping
        # existing host records (setHosts replaces the full set).
        raise NotImplementedError(
            "Namecheap automatic setup is not supported safely (setHosts replaces all "
            "host records). Please add the CNAME and TXT records manually."
        )


class VercelProvider(DnsProvider):
    name = "vercel"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        token = credentials.get("api_token")
        if not token:
            raise DnsProviderError("Vercel requires api_token")
        team = (credentials.get("team_id") or "").strip()
        q = f"?teamId={urllib.parse.quote(team)}" if team else ""
        headers = {"Authorization": f"Bearer {token}"}
        dom = urllib.parse.quote(domain)
        existing = _http_json(
            "GET", f"https://api.vercel.com/v4/domains/{dom}/records{q}", headers=headers
        )
        current = existing.get("records") or []
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            name = "" if host == "@" else host
            value = _fqdn(rec.value) if rec.type == "CNAME" else rec.value
            # Vercel has no upsert: delete any conflicting record-set, then create.
            for ex in current:
                if ex.get("type") == rec.type and (ex.get("name") or "") == name:
                    rid = ex.get("id")
                    if rid:
                        _http_json(
                            "DELETE",
                            f"https://api.vercel.com/v2/domains/records/"
                            f"{urllib.parse.quote(rid)}{q}",
                            headers=headers,
                        )
            body = {"type": rec.type, "name": name, "value": value, "ttl": 600}
            _http_json(
                "POST", f"https://api.vercel.com/v2/domains/{dom}/records{q}",
                headers=headers, body=body,
            )


class DigitalOceanProvider(DnsProvider):
    name = "digitalocean"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        token = credentials.get("api_token")
        if not token:
            raise DnsProviderError("DigitalOcean requires api_token")
        headers = {"Authorization": f"Bearer {token}"}
        base = (
            f"https://api.digitalocean.com/v2/domains/"
            f"{urllib.parse.quote(domain)}/records"
        )
        existing = _http_json("GET", f"{base}?per_page=200", headers=headers)
        current = existing.get("domain_records") or []
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            name = "@" if host == "@" else host
            data = _fqdn(rec.value) if rec.type == "CNAME" else rec.value
            body = {"type": rec.type, "name": name, "data": data, "ttl": 600}
            found = [
                r for r in current
                if r.get("type") == rec.type and r.get("name") == name
            ]
            if found:
                _http_json("PUT", f"{base}/{found[0]['id']}", headers=headers, body=body)
            else:
                _http_json("POST", base, headers=headers, body=body)


class LinodeProvider(DnsProvider):
    name = "linode"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        token = credentials.get("api_token")
        if not token:
            raise DnsProviderError("Linode requires api_token")
        headers = {"Authorization": f"Bearer {token}"}
        listed = _http_json(
            "GET", "https://api.linode.com/v4/domains",
            headers={**headers, "X-Filter": json.dumps({"domain": domain})},
        )
        domains = listed.get("data") or []
        if not domains:
            raise DnsProviderError(f"no Linode domain found for {domain}")
        base = f"https://api.linode.com/v4/domains/{domains[0]['id']}/records"
        current = (_http_json("GET", base, headers=headers).get("data")) or []
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            name = "" if host == "@" else host
            target = _fqdn(rec.value) if rec.type == "CNAME" else rec.value
            body = {"type": rec.type, "name": name, "target": target, "ttl_sec": 300}
            found = [
                r for r in current
                if r.get("type") == rec.type and (r.get("name") or "") == name
            ]
            if found:
                _http_json("PUT", f"{base}/{found[0]['id']}", headers=headers, body=body)
            else:
                _http_json("POST", base, headers=headers, body=body)


class HetznerProvider(DnsProvider):
    name = "hetzner"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        token = credentials.get("api_token")
        if not token:
            raise DnsProviderError("Hetzner requires api_token")
        headers = {"Auth-API-Token": token}
        zones = _http_json(
            "GET", f"https://dns.hetzner.com/api/v1/zones?name={urllib.parse.quote(domain)}",
            headers=headers,
        ).get("zones") or []
        if not zones:
            raise DnsProviderError(f"no Hetzner zone found for {domain}")
        zone_id = zones[0]["id"]
        current = _http_json(
            "GET", f"https://dns.hetzner.com/api/v1/records?zone_id={zone_id}",
            headers=headers,
        ).get("records") or []
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            name = "@" if host == "@" else host
            value = _fqdn(rec.value) if rec.type == "CNAME" else rec.value
            body = {"zone_id": zone_id, "type": rec.type, "name": name, "value": value, "ttl": 600}
            found = [
                r for r in current
                if r.get("type") == rec.type and r.get("name") == name
            ]
            if found:
                _http_json(
                    "PUT", f"https://dns.hetzner.com/api/v1/records/{found[0]['id']}",
                    headers=headers, body=body,
                )
            else:
                _http_json(
                    "POST", "https://dns.hetzner.com/api/v1/records",
                    headers=headers, body=body,
                )


class PorkbunProvider(DnsProvider):
    name = "porkbun"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        key = credentials.get("api_key")
        secret = credentials.get("api_secret")
        if not key or not secret:
            raise DnsProviderError("Porkbun requires api_key and api_secret")
        auth = {"apikey": key, "secretapikey": secret}
        dom = urllib.parse.quote(domain)
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            name = "" if host == "@" else host
            # editByNameType upserts the whole (type, subdomain) set in one call.
            resp = _http_json(
                "POST",
                f"https://api.porkbun.com/api/json/v3/dns/editByNameType/"
                f"{dom}/{rec.type}/{urllib.parse.quote(name)}",
                body={**auth, "content": rec.value, "ttl": "600"},
            )
            if str(resp.get("status")).upper() != "SUCCESS":
                # Nothing to edit yet — create it.
                _http_json(
                    "POST", f"https://api.porkbun.com/api/json/v3/dns/create/{dom}",
                    body={**auth, "name": name, "type": rec.type,
                          "content": rec.value, "ttl": "600"},
                )


class GandiProvider(DnsProvider):
    name = "gandi"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        key = credentials.get("api_key")
        if not key:
            raise DnsProviderError("Gandi requires api_key")
        headers = {"Authorization": f"Apikey {key}"}
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            name = "@" if host == "@" else host
            value = _fqdn(rec.value) if rec.type == "CNAME" else rec.value
            # PUT on the (name, type) rrset upserts in one call.
            _http_json(
                "PUT",
                f"https://api.gandi.net/v5/livedns/domains/{urllib.parse.quote(domain)}"
                f"/records/{urllib.parse.quote(name)}/{rec.type}",
                headers=headers,
                body={"rrset_values": [value], "rrset_ttl": 600},
            )


class NameComProvider(DnsProvider):
    name = "namecom"

    def upsert_records(self, domain: str, records: list[DnsRecord], credentials: dict) -> None:
        user = credentials.get("api_user")
        token = credentials.get("api_token")
        if not user or not token:
            raise DnsProviderError("Name.com requires api_user and api_token")
        basic = base64.b64encode(f"{user}:{token}".encode()).decode()
        headers = {"Authorization": f"Basic {basic}"}
        base = f"https://api.name.com/v4/domains/{urllib.parse.quote(domain)}/records"
        current = (_http_json("GET", base, headers=headers).get("records")) or []
        for rec in records:
            host = _subdomain_host(domain, rec.name)
            h = "" if host == "@" else host
            body = {"host": h, "type": rec.type, "answer": rec.value, "ttl": 300}
            found = [
                r for r in current
                if r.get("type") == rec.type and (r.get("host") or "") == h
            ]
            if found:
                _http_json("PUT", f"{base}/{found[0]['id']}", headers=headers, body=body)
            else:
                _http_json("POST", base, headers=headers, body=body)


# --- Provider registry --------------------------------------------------------
# A single source of truth that powers (a) nameserver-based auto-detection, (b) the
# API-key auto-configure path, and (c) the guided "open your DNS panel" deep-link for
# providers we can name but don't have a write adapter for. `auto=True` means we can
# create the records via API; otherwise we detect + deep-link + show manual records.


@dataclass(frozen=True)
class CredField:
    name: str
    label: str
    secret: bool = False
    optional: bool = False


@dataclass(frozen=True)
class ProviderInfo:
    key: str
    label: str
    ns_suffixes: tuple[str, ...] = ()
    panel_url: str = ""  # deep-link into the provider's DNS management UI
    adapter: DnsProvider | None = None
    fields: tuple[CredField, ...] = ()

    @property
    def auto(self) -> bool:
        """True when we can create records via API (adapter + credential fields)."""
        return self.adapter is not None and bool(self.fields)


def _f(name: str, label: str, secret: bool = False, optional: bool = False) -> CredField:
    return CredField(name=name, label=label, secret=secret, optional=optional)


REGISTRY: dict[str, ProviderInfo] = {
    # --- Providers with a write adapter (one-click via API key) ---
    "cloudflare": ProviderInfo(
        "cloudflare", "Cloudflare", ("cloudflare.com",),
        "https://dash.cloudflare.com/", CloudflareProvider(),
        (_f("api_token", "API token", secret=True),),
    ),
    "godaddy": ProviderInfo(
        "godaddy", "GoDaddy", ("domaincontrol.com", "secureserver.net"),
        "https://dcc.godaddy.com/control/portfolio", GoDaddyProvider(),
        (_f("api_key", "API key"), _f("api_secret", "API secret", secret=True)),
    ),
    "vercel": ProviderInfo(
        "vercel", "Vercel", ("vercel-dns.com",),
        "https://vercel.com/dashboard/domains", VercelProvider(),
        (_f("api_token", "API token", secret=True),
         _f("team_id", "Team ID", optional=True)),
    ),
    "digitalocean": ProviderInfo(
        "digitalocean", "DigitalOcean", ("digitalocean.com",),
        "https://cloud.digitalocean.com/networking/domains", DigitalOceanProvider(),
        (_f("api_token", "API token", secret=True),),
    ),
    "linode": ProviderInfo(
        "linode", "Linode / Akamai", ("linode.com",),
        "https://cloud.linode.com/domains", LinodeProvider(),
        (_f("api_token", "API token", secret=True),),
    ),
    "hetzner": ProviderInfo(
        "hetzner", "Hetzner", ("hetzner.com", "hetzner.de", "your-server.de"),
        "https://dns.hetzner.com/", HetznerProvider(),
        (_f("api_token", "DNS API token", secret=True),),
    ),
    "porkbun": ProviderInfo(
        "porkbun", "Porkbun", ("porkbun.com",),
        "https://porkbun.com/account/domainsSpeedy", PorkbunProvider(),
        (_f("api_key", "API key"), _f("api_secret", "Secret API key", secret=True)),
    ),
    "gandi": ProviderInfo(
        "gandi", "Gandi", ("gandi.net",),
        "https://admin.gandi.net/domain/", GandiProvider(),
        (_f("api_key", "API key / PAT", secret=True),),
    ),
    "namecom": ProviderInfo(
        "namecom", "Name.com", ("name.com",),
        "https://www.name.com/account/domain", NameComProvider(),
        (_f("api_user", "API username"), _f("api_token", "API token", secret=True)),
    ),
    # --- Detect-only providers (named + deep-linked; records added manually) ---
    "namecheap": ProviderInfo(
        "namecheap", "Namecheap", ("registrar-servers.com",),
        "https://ap.www.namecheap.com/domains/domaincontrolpanel/",
        NamecheapProvider(),  # adapter intentionally guides to manual (destructive API)
    ),
    "route53": ProviderInfo(
        # AWS nameservers look like ns-123.awsdns-45.net — matched by substring below,
        # not a clean suffix.
        "route53", "Amazon Route 53", (),
        "https://console.aws.amazon.com/route53/v2/hostedzones",
    ),
    "googleclouddns": ProviderInfo(
        "googleclouddns", "Google Cloud DNS", ("googledomains.com",),
        "https://console.cloud.google.com/net-services/dns/zones",
    ),
    "azure": ProviderInfo(
        "azure", "Azure DNS",
        ("azure-dns.com", "azure-dns.net", "azure-dns.org", "azure-dns.info"),
        "https://portal.azure.com/",
    ),
    "ionos": ProviderInfo(
        "ionos", "IONOS / 1&1",
        ("ui-dns.com", "ui-dns.de", "ui-dns.org", "ui-dns.biz"),
        "https://my.ionos.com/domains",
    ),
    "ovh": ProviderInfo(
        "ovh", "OVHcloud", ("ovh.net",), "https://www.ovh.com/manager/",
    ),
    "dnsimple": ProviderInfo(
        "dnsimple", "DNSimple", ("dnsimple.com", "dnsimple-edge.net"),
        "https://dnsimple.com/dashboard",
    ),
    "dnsmadeeasy": ProviderInfo(
        "dnsmadeeasy", "DNS Made Easy", ("dnsmadeeasy.com",),
        "https://cp.dnsmadeeasy.com/",
    ),
    "ns1": ProviderInfo(
        "ns1", "NS1 / Netlify", ("nsone.net",), "https://my.nsone.net/",
    ),
    "dynadot": ProviderInfo(
        "dynadot", "Dynadot", ("dynadot.com",), "https://www.dynadot.com/account/domain/",
    ),
    "hover": ProviderInfo(
        "hover", "Hover", ("hover.com",), "https://www.hover.com/control_panel",
    ),
    "squarespace": ProviderInfo(
        "squarespace", "Squarespace / Google Domains",
        ("squarespacedns.com",), "https://account.squarespace.com/domains",
    ),
    "namesilo": ProviderInfo(
        "namesilo", "NameSilo", ("namesilo.com",), "https://www.namesilo.com/account_domains.php",
    ),
    "dreamhost": ProviderInfo(
        "dreamhost", "DreamHost", ("dreamhost.com",), "https://panel.dreamhost.com/",
    ),
    "bluehost": ProviderInfo(
        "bluehost", "Bluehost", ("bluehost.com",), "https://my.bluehost.com/",
    ),
    "hostinger": ProviderInfo(
        "hostinger", "Hostinger", ("hostinger.com", "dns-parking.com"),
        "https://hpanel.hostinger.com/",
    ),
    "wix": ProviderInfo(
        "wix", "Wix", ("wixdns.net",), "https://www.wix.com/my-account/domains",
    ),
}


# Adapters available for the API-key auto-configure path, keyed by provider key.
PROVIDERS: dict[str, DnsProvider] = {
    key: info.adapter for key, info in REGISTRY.items() if info.adapter is not None
}

# Known nameserver suffixes -> provider key, for best-effort auto-detection. Longer
# (more specific) suffixes are checked first so e.g. "azure-dns.com" wins cleanly.
_NS_SUFFIX_TO_PROVIDER: dict[str, str] = {
    suffix: info.key for info in REGISTRY.values() for suffix in info.ns_suffixes
}
_NS_SUFFIXES_BY_LEN: list[tuple[str, str]] = sorted(
    _NS_SUFFIX_TO_PROVIDER.items(), key=lambda kv: len(kv[0]), reverse=True
)

# Providers whose nameserver hostnames carry an identifying substring rather than a
# clean DNS suffix (e.g. AWS's ns-123.awsdns-45.net).
_NS_CONTAINS: list[tuple[str, str]] = [("awsdns-", "route53")]


def provider_meta(key: str | None) -> dict:
    """Public-facing metadata for a detected provider (label, deep-link, whether we
    can auto-configure). Returns {} for unknown keys."""
    info = REGISTRY.get(key or "")
    if info is None:
        return {}
    return {
        "key": info.key,
        "label": info.label,
        "dns_panel_url": info.panel_url,
        "can_auto": info.auto,
        "fields": [
            {"name": f.name, "label": f.label, "secret": f.secret, "optional": f.optional}
            for f in info.fields
        ],
    }


def provider_catalog() -> list[dict]:
    """All providers we can auto-configure (for the manual "choose your provider"
    override in the UI), each with its credential field spec."""
    return [provider_meta(key) for key, info in REGISTRY.items() if info.auto]


def _resolve_nameservers(name: str) -> list[str]:
    """Resolve nameserver hostnames for ``name`` via DNS-over-HTTPS. Reads both the
    Answer section (a direct NS delegation) and the Authority section (the parent
    zone's SOA, returned when ``name`` itself isn't a zone cut), so a subdomain that
    isn't delegated still surfaces its parent's nameservers. Returns [] on failure."""
    url = "https://dns.google/resolve?name=" + urllib.parse.quote(name) + "&type=NS"
    try:
        with urllib.request.urlopen(url, timeout=_HTTP_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode(errors="ignore"))
    except Exception:
        return []
    hosts: list[str] = []
    for section in ("Answer", "Authority"):
        for rec in payload.get(section, []) or []:
            data = str(rec.get("data", "")).strip().lower()
            if not data:
                continue
            # SOA records (DNS type 6) carry the primary nameserver as their first,
            # space-separated field; everything else (NS, type 2) is a bare hostname.
            if rec.get("type") == 6:
                data = data.split()[0]
            data = data.rstrip(".")
            if data:
                hosts.append(data)
    return hosts


def _match_provider(nameservers: list[str]) -> str | None:
    """Map a list of nameserver hostnames to a known provider key, most-specific
    suffix first. Returns None when nothing matches."""
    for ns in nameservers:
        for suffix, provider in _NS_SUFFIXES_BY_LEN:
            if ns == suffix or ns.endswith("." + suffix):
                return provider
        for needle, provider in _NS_CONTAINS:
            if needle in ns:
                return provider
    return None


def _has_ns_delegation(name: str) -> bool:
    """True when ``name`` is a delegated DNS zone cut — its NS query returns NS records
    in the Answer section (not just the parent SOA in Authority)."""
    url = "https://dns.google/resolve?name=" + urllib.parse.quote(name) + "&type=NS"
    try:
        with urllib.request.urlopen(url, timeout=_HTTP_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode(errors="ignore"))
    except Exception:
        return False
    return any(r.get("type") == 2 for r in (payload.get("Answer") or []))


def zone_for(domain: str) -> str:
    """Best-effort registrable DNS zone for ``domain``: the longest ancestor that is a
    delegated zone (has its own NS records). Provider APIs operate on the zone
    (``example.com``), not the sub-host a customer points at us
    (``trust.example.com``). Falls back to the last two labels when DNS is
    unavailable or nothing looks delegated."""
    domain = (domain or "").strip().lower().rstrip(".")
    labels = [label for label in domain.split(".") if label]
    if len(labels) <= 2:
        return domain
    for i in range(len(labels) - 1):
        candidate = ".".join(labels[i:])
        if _has_ns_delegation(candidate):
            return candidate
    return ".".join(labels[-2:])


def detect_provider(domain: str) -> str | None:
    """Best-effort: resolve the domain's nameservers via DNS-over-HTTPS and map a
    known nameserver suffix to a provider key. NS delegation lives at the registrable
    apex (e.g. ``example.com``), not at the subdomain a customer actually points at
    us (``trust.example.com``), so we walk up the labels until nameservers turn up.
    Returns None on any failure or no match (caller falls back to manual setup)."""
    domain = (domain or "").strip().lower().rstrip(".")
    if not domain:
        return None
    labels = domain.split(".")
    # Walk from the full name up to the registrable apex (the last two labels).
    for i in range(max(len(labels) - 1, 1)):
        name = ".".join(labels[i:])
        match = _match_provider(_resolve_nameservers(name))
        if match:
            return match
    return None
