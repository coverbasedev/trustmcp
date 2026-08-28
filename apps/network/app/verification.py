from __future__ import annotations

import json
import urllib.parse
import urllib.request

import httpx


def fetch_txt_records(name: str) -> list[str]:
    """Look up DNS TXT records. Imported lazily so the package works without
    dnspython installed (e.g. in tests that monkeypatch this function)."""
    try:
        import dns.resolver  # type: ignore
    except ImportError:  # pragma: no cover
        return []
    try:
        answers = dns.resolver.resolve(name, "TXT")
    except Exception:
        return []
    out: list[str] = []
    for rdata in answers:
        out.append(b"".join(rdata.strings).decode(errors="ignore"))
    return out


def fetch_well_known(domain: str) -> str:
    url = f"https://{domain}/.well-known/trustmcp-challenge.txt"
    try:
        # A domain-control challenge must be served directly at the well-known URL.
        # Do NOT follow redirects: a redirect to an attacker-controlled host would
        # let a domain spoof control it doesn't have (mild SSRF/spoof surface).
        r = httpx.get(url, timeout=10, follow_redirects=False)
        r.raise_for_status()
        return r.text.strip()
    except Exception:
        return ""


def doh_resolve(name: str, rtype: str) -> list[str]:
    """Best-effort DNS-over-HTTPS lookup via Google's resolver using only the stdlib
    (no dnspython dep). Returns the list of answer data strings (TXT values are
    de-quoted). Returns [] on any failure so callers treat it as "not found yet"."""
    url = (
        "https://dns.google/resolve?name="
        + urllib.parse.quote(name)
        + "&type="
        + urllib.parse.quote(rtype)
    )
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            payload = json.loads(resp.read().decode(errors="ignore"))
    except Exception:
        return []
    out: list[str] = []
    for answer in payload.get("Answer", []) or []:
        data = str(answer.get("data", "")).strip()
        # TXT answers come back wrapped in double quotes.
        if data.startswith('"') and data.endswith('"'):
            data = data[1:-1]
        out.append(data)
    return out


def verify_domain(domain: str, challenge_token: str, dns_prefix: str) -> tuple[bool, str]:
    """Returns (verified, method). Checks DNS TXT first, then the well-known file."""
    record_name = f"{dns_prefix}.{domain}"
    txts = fetch_txt_records(record_name)
    if any(challenge_token in t for t in txts):
        return True, "dns"
    if fetch_well_known(domain) == challenge_token:
        return True, "well-known"
    return False, ""


def host_resolves(name: str) -> bool:
    """True if `name` resolves to at least one A/AAAA address (following CNAMEs).
    Used to tell whether our edge target (cname.trustmcp.app) is actually routable
    before we claim a TLS certificate can be provisioned. Best-effort; never raises."""
    name = (name or "").rstrip(".")
    if not name:
        return False
    # dns.google follows the CNAME chain and returns the terminal A/AAAA records, so
    # a non-empty answer means the name ultimately points at an address.
    return bool(doh_resolve(name, "A")) or bool(doh_resolve(name, "AAAA"))


def probe_https(domain: str, timeout: float = 4.0) -> bool:
    """Best-effort check that `domain` is serving a TLS certificate valid for itself.
    Completes a real handshake with hostname + chain verification, so a True result
    means HTTPS is genuinely live (not merely "provisioning"). Never raises."""
    import socket
    import ssl

    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((domain, 443), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
                # A verified handshake yields a peer cert; absence means no valid TLS.
                return bool(ssock.getpeercert())
    except Exception:
        return False

