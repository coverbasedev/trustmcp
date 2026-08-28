"""OSCAL catalog and profile for the TrustMCP claim model.

TrustMCP's own vocabulary — the claim keys a vendor publishes (`mfa.enforced`,
`encryption.at_rest`, …) — is itself a small control catalog. Emitting it as an
OSCAL `catalog` makes every claim addressable by an OSCAL control id, which is
what lets the other models (component-definition, SSP, assessment-results) point
at claims using ordinary OSCAL references instead of TrustMCP-specific ones.

The `profile` complements it: for a given framework it emits an OSCAL profile
that imports the framework's source catalog and selects exactly the controls
TrustMCP has a mapping for. A GRC tool can resolve that profile to get the
baseline TrustMCP evidence actually speaks to.
"""

from __future__ import annotations

from ..frameworks import FRAMEWORKS
from .common import (
    NS,
    derive_uuid,
    link,
    metadata,
    prop,
)

CATALOG_ID = "trustmcp-claims"

# Human-readable definitions for the claim keys TrustMCP standardizes. Claims a
# vendor publishes outside this list still export — they land in the "extended"
# group with a generated title — so the catalog never silently drops evidence.
CLAIM_DEFINITIONS: dict[str, dict] = {
    "mfa.enforced": {
        "group": "access-control",
        "title": "Multi-factor authentication enforced",
        "statement": (
            "The vendor enforces multi-factor authentication for access to systems "
            "that process customer data."
        ),
    },
    "access_control.rbac": {
        "group": "access-control",
        "title": "Role-based access control",
        "statement": (
            "Access to customer data is granted through defined roles rather than "
            "per-user grants."
        ),
    },
    "encryption.at_rest": {
        "group": "cryptography",
        "title": "Encryption at rest",
        "statement": "Customer data is encrypted while stored.",
    },
    "encryption.in_transit": {
        "group": "cryptography",
        "title": "Encryption in transit",
        "statement": "Customer data is encrypted while transmitted over untrusted networks.",
    },
    "breach_notification_hours": {
        "group": "incident-response",
        "title": "Breach notification window",
        "statement": (
            "The vendor commits to notifying affected customers within the stated "
            "number of hours of confirming a breach."
        ),
    },
    "bcp_dr.tested": {
        "group": "resilience",
        "title": "Business continuity and disaster recovery tested",
        "statement": (
            "Continuity and recovery plans are exercised on a defined schedule."
        ),
    },
    "availability.sla": {
        "group": "resilience",
        "title": "Availability commitment",
        "statement": "The vendor publishes a contractual availability target.",
    },
    "subprocessors.count": {
        "group": "supply-chain",
        "title": "Subprocessor inventory",
        "statement": (
            "The vendor maintains and publishes an inventory of subprocessors that "
            "handle customer data."
        ),
    },
    "data_residency": {
        "group": "data-handling",
        "title": "Data residency",
        "statement": (
            "The vendor states the regions in which customer data is stored and processed."
        ),
    },
    "pentest.frequency": {
        "group": "assurance",
        "title": "Penetration testing cadence",
        "statement": (
            "The vendor commissions independent penetration testing on a stated cadence."
        ),
    },
}

GROUPS: dict[str, str] = {
    "access-control": "Access Control",
    "cryptography": "Cryptography",
    "incident-response": "Incident Response",
    "resilience": "Resilience and Continuity",
    "supply-chain": "Supply Chain",
    "data-handling": "Data Handling",
    "assurance": "Independent Assurance",
    "extended": "Vendor-Defined Claims",
}


def control_id(claim_key: str) -> str:
    """The OSCAL control id for a claim key. OSCAL ids are NCNames, so dots and
    underscores become hyphens: `mfa.enforced` -> `tmcp-mfa-enforced`."""
    slug = claim_key.replace(".", "-").replace("_", "-").lower()
    return f"tmcp-{slug}"


def definition_for(claim_key: str) -> dict:
    known = CLAIM_DEFINITIONS.get(claim_key)
    if known:
        return known
    pretty = claim_key.replace(".", " ").replace("_", " ").strip().capitalize()
    return {
        "group": "extended",
        "title": pretty,
        "statement": f"Vendor-defined claim `{claim_key}` published through TrustMCP.",
    }


def catalog(claim_keys: list[str] | None = None) -> dict:
    """The TrustMCP claim catalog.

    Pass `claim_keys` to include a vendor's own extended claims alongside the
    standard vocabulary; omit it for the canonical network-wide catalog.
    """
    keys = sorted(set(CLAIM_DEFINITIONS) | set(claim_keys or []))
    by_group: dict[str, list[dict]] = {}
    for key in keys:
        d = definition_for(key)
        by_group.setdefault(d["group"], []).append(
            {
                "id": control_id(key),
                "title": d["title"],
                "props": [prop("trustmcp-claim-key", key)],
                "parts": [
                    {
                        "id": f"{control_id(key)}_smt",
                        "name": "statement",
                        "prose": d["statement"],
                    }
                ],
            }
        )

    groups = [
        {
            "id": gid,
            "title": GROUPS.get(gid, gid.title()),
            "controls": sorted(by_group[gid], key=lambda c: c["id"]),
        }
        for gid in sorted(by_group)
    ]

    return {
        "catalog": {
            "uuid": derive_uuid(CATALOG_ID, "catalog", ",".join(keys)),
            "metadata": metadata(
                "TrustMCP Claim Catalog",
                props=[prop("trustmcp-catalog-id", CATALOG_ID)],
                links=[link("https://trustmcp.org/spec", "canonical")],
            ),
            "groups": groups,
        }
    }


def profile(framework: str) -> dict:
    """An OSCAL profile selecting the controls TrustMCP maps for `framework`.

    Resolving this profile against the framework's source catalog yields the
    baseline that TrustMCP-published evidence actually addresses — so a consumer
    knows the coverage boundary up front rather than inferring it from gaps.
    """
    fw = FRAMEWORKS[framework]
    from .sources import source_href

    return {
        "profile": {
            "uuid": derive_uuid("profile", framework),
            "metadata": metadata(
                f"TrustMCP coverage baseline — {fw['name']}",
                props=[prop("trustmcp-framework", framework)],
            ),
            "imports": [
                {
                    "href": source_href(framework),
                    "include-controls": [
                        {"with-ids": [c["id"] for c in fw["controls"]]}
                    ],
                }
            ],
            "merge": {"as-is": True},
            "modify": {
                "alters": [
                    {
                        "control-id": c["id"],
                        "adds": [
                            {
                                "position": "ending",
                                "props": [
                                    {
                                        "name": "trustmcp-claim-key",
                                        "ns": NS,
                                        "value": claim,
                                    }
                                    for claim in c["claims"]
                                ],
                            }
                        ],
                    }
                    for c in fw["controls"]
                    if c["claims"]
                ]
            },
        }
    }
