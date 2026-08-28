"""Shared OSCAL primitives.

Everything the model builders need in common: the OSCAL version we emit,
deterministic UUID derivation, and the small helpers that build `metadata`,
`props`, `links`, `parties`, and `back-matter` resources.

Deterministic UUIDs matter here. OSCAL identifies every object by UUID, and a
continuous exchange re-emits the same document over and over. If the UUIDs were
random (uuid4), a consumer diffing two pulls would see every object as new. We
derive them with uuid5 from a stable namespace plus a logical path, so the same
logical object always carries the same UUID across exports, processes, and
replicas — and a changed *value* shows up as a changed field rather than a
changed identity.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, date, datetime

# OSCAL release this exporter targets. Bump together with the model builders.
OSCAL_VERSION = "1.1.3"

# The document version we stamp on exports. Distinct from OSCAL_VERSION: this is
# TrustMCP's own revision of the export shape.
DOCUMENT_VERSION = "1.0.0"

# UUIDv5 namespace for all TrustMCP-derived OSCAL identifiers. Fixed forever —
# changing it would re-identify every object in every consumer's store.
TRUSTMCP_NAMESPACE = uuid.UUID("6f2a1c94-3f8f-5a63-9d3e-1f0a7b5c2e41")

# Property namespace for TrustMCP-specific props/links. OSCAL requires a URI.
NS = "https://trustmcp.org/ns/oscal"


def derive_uuid(*parts: str) -> str:
    """A stable UUIDv5 for a logical object, derived from its path.

    `derive_uuid("vnd_acme", "component", "service")` returns the same value on
    every call, in every process, forever.
    """
    return str(uuid.uuid5(TRUSTMCP_NAMESPACE, "/".join(str(p) for p in parts)))


def now_iso() -> str:
    """OSCAL `dateTime-with-timezone`: RFC3339 with an explicit offset."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def as_iso(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat().replace("+00:00", "Z")
    return value.isoformat()


def prop(name: str, value: object, *, ns: str | None = NS, clazz: str | None = None) -> dict:
    """An OSCAL `property`. Non-core names are namespaced so consumers can tell
    TrustMCP extensions apart from OSCAL-defined properties."""
    out: dict = {"name": name, "value": _stringify(value)}
    if ns:
        out["ns"] = ns
    if clazz:
        out["class"] = clazz
    return out


def link(href: str, rel: str, text: str | None = None, media_type: str | None = None) -> dict:
    out: dict = {"href": href, "rel": rel}
    if media_type:
        out["media-type"] = media_type
    if text:
        out["text"] = text
    return out


def _stringify(value: object) -> str:
    """OSCAL prop values are strings. Booleans lower-case, lists comma-joined."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        return ", ".join(_stringify(v) for v in value)
    if value is None:
        return ""
    return str(value)


def metadata(
    title: str,
    *,
    last_modified: str | None = None,
    version: str = DOCUMENT_VERSION,
    parties: list[dict] | None = None,
    roles: list[dict] | None = None,
    responsible_parties: list[dict] | None = None,
    props: list[dict] | None = None,
    links: list[dict] | None = None,
) -> dict:
    """An OSCAL `metadata` block with every required field populated."""
    out: dict = {
        "title": title,
        "last-modified": last_modified or now_iso(),
        "version": version,
        "oscal-version": OSCAL_VERSION,
    }
    if roles:
        out["roles"] = roles
    if parties:
        out["parties"] = parties
    if responsible_parties:
        out["responsible-parties"] = responsible_parties
    if props:
        out["props"] = props
    if links:
        out["links"] = links
    return out


# --- Parties and roles -------------------------------------------------------

# The roles every TrustMCP export declares. `provider` is the vendor publishing
# the trust center; `assessor` is whoever consumes the evidence.
ROLES = [
    {
        "id": "provider",
        "title": "Service Provider",
        "description": "The vendor publishing this trust center.",
    },
    {
        "id": "assessor",
        "title": "Assessor",
        "description": "The party evaluating the published evidence.",
    },
    {
        "id": "trust-anchor",
        "title": "Trust Anchor",
        "description": (
            "The TrustMCP network that verifies domain ownership and signs "
            "published documents."
        ),
    },
]


def vendor_party(vendor_id: str, legal_name: str, domains: list[str]) -> dict:
    """The vendor as an OSCAL `party` of type organization."""
    party: dict = {
        "uuid": derive_uuid(vendor_id, "party", "vendor"),
        "type": "organization",
        "name": legal_name,
        "props": [prop("trustmcp-vendor-id", vendor_id)],
    }
    if domains:
        party["links"] = [link(f"https://{d}", "website") for d in domains]
        party["email-addresses"] = []
    return party


def network_party(network_url: str) -> dict:
    return {
        "uuid": derive_uuid("network", network_url, "party"),
        "type": "organization",
        "name": "TrustMCP Network",
        "links": [link(network_url, "website")],
    }


def responsible_party(role_id: str, party_uuids: list[str]) -> dict:
    return {"role-id": role_id, "party-uuids": party_uuids}


# --- Back matter -------------------------------------------------------------


def resource(
    uuid_: str,
    title: str,
    *,
    description: str | None = None,
    props: list[dict] | None = None,
    rlinks: list[dict] | None = None,
) -> dict:
    """A `back-matter/resource` — how OSCAL carries evidence by reference."""
    out: dict = {"uuid": uuid_, "title": title}
    if description:
        out["description"] = description
    if props:
        out["props"] = props
    if rlinks:
        out["rlinks"] = rlinks
    return out


def rlink(href: str, media_type: str | None = None, hashes: list[dict] | None = None) -> dict:
    out: dict = {"href": href}
    if media_type:
        out["media-type"] = media_type
    if hashes:
        out["hashes"] = hashes
    return out


def sha256_hash(digest: str | None) -> list[dict]:
    """OSCAL `hash` entries. Lets a consumer verify the bytes it downloads."""
    return [{"algorithm": "SHA-256", "value": digest}] if digest else []


def digest_of(document: object) -> str:
    """A stable sha256 over a document's canonical JSON form.

    Used by the continuous feed to answer "did anything actually change?"
    without diffing structures. `last-modified` is excluded from the digest so a
    re-export with no substantive change hashes identically.
    """
    return hashlib.sha256(canonical_bytes(document)).hexdigest()


def canonical_bytes(document: object) -> bytes:
    return json.dumps(
        _strip_volatile(document), sort_keys=True, separators=(",", ":"), default=str
    ).encode()


def _strip_volatile(value: object) -> object:
    """Recursively drop fields that change on every export but carry no meaning
    (the export timestamp). Keeps content digests stable."""
    if isinstance(value, dict):
        return {
            k: _strip_volatile(v)
            for k, v in value.items()
            if k not in ("last-modified", "published", "start", "collected", "expires")
        }
    if isinstance(value, list):
        return [_strip_volatile(v) for v in value]
    return value
