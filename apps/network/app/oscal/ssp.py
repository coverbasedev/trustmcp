"""OSCAL system-security-plan.

A trust center is not a full SSP — the vendor, not the customer, holds the
authorization boundary — but a great deal of what an SSP needs is exactly what a
trust center already publishes: what the system is, who runs it, what data it
handles, which components (including subprocessors) make it up, and how the
controls are implemented.

So this emits a *provider-scoped* SSP: an honest, complete OSCAL document that a
customer can import as the starting point for their own system's plan, with the
inherited-from-vendor parts already filled in. `trustmcp-ssp-scope=provider`
marks it as such, and the information types carry the vendor's published data
inventory rather than a guessed FIPS-199 categorization.
"""

from __future__ import annotations

from ..frameworks import FRAMEWORKS, map_claims
from .backmatter import artifact_resource_uuid, back_matter
from .common import (
    ROLES,
    as_iso,
    derive_uuid,
    link,
    metadata,
    network_party,
    prop,
    responsible_party,
    vendor_party,
)
from .context import OscalContext
from .sources import source_href


def _information_types(ctx: OscalContext) -> list[dict]:
    """The vendor's published "data collected" list as OSCAL information types.

    Impact levels are declared `fips-199-moderate` only where the vendor's own
    claims justify it; otherwise they are omitted. Inventing a categorization
    the vendor never made would be the single most misleading thing this export
    could do.
    """
    collected = [d for d in ctx.data_types if d.get("collected")]
    if not collected:
        return [
            {
                "uuid": derive_uuid(ctx.vendor_id, "information-type", "unspecified"),
                "title": "Customer data",
                "description": (
                    "The vendor has not published a data inventory through TrustMCP. "
                    "Categorize from your own contract and DPA."
                ),
                "props": [prop("trustmcp-source", "not-published")],
            }
        ]
    return [
        {
            "uuid": derive_uuid(ctx.vendor_id, "information-type", d["label"]),
            "title": d["label"],
            "description": f"{d['label']} — declared as collected by {ctx.legal_name}.",
            "props": [prop("trustmcp-data-type", d["label"])],
        }
        for d in collected
    ]


def _system_characteristics(ctx: OscalContext) -> dict:
    return {
        "system-ids": [
            {"identifier-type": "https://trustmcp.org/ns/vendor-id", "id": ctx.vendor_id}
        ],
        "system-name": ctx.product or ctx.legal_name,
        "description": (
            f"{ctx.legal_name} as published through TrustMCP. This plan describes the "
            "provider's side of the shared-responsibility boundary; the consuming "
            "organization remains responsible for its own configuration and use."
        ),
        "props": [
            prop("trustmcp-ssp-scope", "provider"),
            prop("trustmcp-vendor-id", ctx.vendor_id),
            prop("trustmcp-mark", ctx.mark_status),
        ],
        "links": [link(f"{ctx.network_url}/v1/vendors/{ctx.vendor_id}/public", "trust-center")],
        "security-sensitivity-level": "unspecified",
        "system-information": {"information-types": _information_types(ctx)},
        "security-impact-level": {
            "security-objective-confidentiality": "unspecified",
            "security-objective-integrity": "unspecified",
            "security-objective-availability": "unspecified",
        },
        "status": {
            "state": "operational" if ctx.published_at else "under-development",
            "remarks": (
                "Derived from the vendor's TrustMCP publication state, not from an "
                "authorization decision."
            ),
        },
        "authorization-boundary": {
            "description": (
                "The vendor-operated service and the subprocessors listed as components. "
                "TrustMCP verifies domain ownership and signs the published evidence; it "
                "does not audit the boundary."
            )
        },
        "network-architecture": {
            "description": (
                "Not published through TrustMCP. Request the architecture artifact if the "
                "vendor has uploaded one."
            )
        },
        "data-flow": {
            "description": (
                "Not published through TrustMCP. The subprocessor inventory in "
                "system-implementation shows where customer data may travel."
            )
        },
    }


def _users(ctx: OscalContext) -> list[dict]:
    return [
        {
            "uuid": derive_uuid(ctx.vendor_id, "user", "customer"),
            "title": "Customer organization",
            "description": "An organization consuming the service under contract.",
            "role-ids": ["assessor"],
            "authorized-privileges": [
                {
                    "title": "Evidence access",
                    "functions-performed": [
                        "Request scoped access keys",
                        "Read manifest, attestations, and released artifacts",
                    ],
                }
            ],
        },
        {
            "uuid": derive_uuid(ctx.vendor_id, "user", "provider-admin"),
            "title": "Provider administrator",
            "description": f"Staff of {ctx.legal_name} operating the service.",
            "role-ids": ["provider"],
            "authorized-privileges": [
                {
                    "title": "Service administration",
                    "functions-performed": ["Operate and maintain the service"],
                }
            ],
        },
    ]


def _components(ctx: OscalContext) -> list[dict]:
    service_uuid = derive_uuid(ctx.vendor_id, "component", "service")
    components = [
        {
            "uuid": service_uuid,
            "type": "service",
            "title": ctx.product or ctx.legal_name,
            "description": f"The {ctx.legal_name} service.",
            "status": {"state": "operational"},
            "props": [prop("trustmcp-vendor-id", ctx.vendor_id)],
            "responsible-roles": [
                {"role-id": "provider", "party-uuids": [ctx.provider_uuid]}
            ],
        }
    ]
    for sub in ctx.subprocessors:
        props = [prop("trustmcp-subprocessor", "true")]
        if sub.location:
            props.append(prop("trustmcp-location", sub.location))
        if sub.domain:
            props.append(prop("trustmcp-domain", sub.domain))
        components.append(
            {
                "uuid": derive_uuid(ctx.vendor_id, "component", "subprocessor", sub.name),
                "type": "service",
                "title": sub.name,
                "description": sub.purpose or f"Subprocessor engaged by {ctx.legal_name}.",
                "status": {"state": "operational"},
                "props": props,
            }
        )
    return components


def _implemented_requirements(ctx: OscalContext, framework: str) -> list[dict]:
    service_uuid = derive_uuid(ctx.vendor_id, "component", "service")
    mapped = map_claims(
        framework,
        [{"key": c.key, "value": c.value, "evidence": c.evidence} for c in ctx.claims],
    )
    claims_by_key = ctx.claims_by_key
    out = []
    for row in mapped["controls"]:
        matched = [claims_by_key[c["key"]] for c in row["claims"] if c["key"] in claims_by_key]
        statements = [
            {
                "statement-id": f"{row['control']}_smt",
                "uuid": derive_uuid(ctx.vendor_id, "ssp-statement", framework, row["control"]),
                "by-components": [
                    {
                        "component-uuid": service_uuid,
                        "uuid": derive_uuid(
                            ctx.vendor_id, "ssp-by-component", framework, row["control"]
                        ),
                        "description": (
                            "Implemented by the provider. Published claims: "
                            + "; ".join(f"{c.key}={c.value}" for c in matched)
                            if matched
                            else "The provider has not published a TrustMCP claim for this control."
                        ),
                        "props": [
                            prop(
                                "implementation-status",
                                "implemented" if matched else "planned",
                                ns=None,
                            )
                        ],
                        "links": [
                            link(
                                f"#{artifact_resource_uuid(ctx.vendor_id, ev)}",
                                "evidence",
                            )
                            for c in matched
                            for ev in c.evidence
                            if ev in ctx.artifacts_by_id
                        ],
                    }
                ],
            }
        ]
        out.append(
            {
                "uuid": derive_uuid(ctx.vendor_id, "ssp-requirement", framework, row["control"]),
                "control-id": row["control"],
                "props": [
                    prop("trustmcp-framework", framework),
                    prop("trustmcp-coverage", "claimed" if matched else "not-claimed"),
                    # Carrying the claim key and value here is what makes an SSP
                    # round trip exactly: re-importing reads these back rather
                    # than re-inferring claims from control coverage.
                    *[
                        p
                        for c in matched
                        for p in (
                            prop("trustmcp-claim-key", c.key),
                            prop("trustmcp-claim-value", c.value),
                        )
                    ],
                ],
                "statements": statements,
                "by-components": [
                    {
                        "component-uuid": service_uuid,
                        "uuid": derive_uuid(
                            ctx.vendor_id, "ssp-req-by-component", framework, row["control"]
                        ),
                        "description": row["title"],
                        "implementation-status": {
                            "state": "implemented" if matched else "planned",
                            "remarks": (
                                "Vendor-asserted through TrustMCP; not independently verified "
                                "by the network."
                            ),
                        },
                    }
                ],
            }
        )
    return out


def system_security_plan(ctx: OscalContext, framework: str = "nist_800_53") -> dict:
    """A provider-scoped SSP for one framework baseline."""
    if framework not in FRAMEWORKS:
        raise ValueError(f"unknown framework: {framework}")
    provider = vendor_party(ctx.vendor_id, ctx.legal_name, ctx.domains)
    anchor = network_party(ctx.network_url)
    return {
        "system-security-plan": {
            "uuid": derive_uuid(ctx.vendor_id, "ssp", framework),
            "metadata": metadata(
                f"{ctx.legal_name} — provider system security plan "
                f"({FRAMEWORKS[framework]['name']})",
                last_modified=as_iso(ctx.generated_at),
                roles=ROLES,
                parties=[provider, anchor],
                responsible_parties=[
                    responsible_party("provider", [provider["uuid"]]),
                    responsible_party("trust-anchor", [anchor["uuid"]]),
                ],
                props=[
                    prop("trustmcp-vendor-id", ctx.vendor_id),
                    prop("trustmcp-ssp-scope", "provider"),
                    prop("trustmcp-framework", framework),
                ],
            ),
            "import-profile": {"href": f"{ctx.network_url}/v1/oscal/profile/{framework}"},
            "system-characteristics": _system_characteristics(ctx),
            "system-implementation": {
                "users": _users(ctx),
                "components": _components(ctx),
                "props": [prop("trustmcp-subprocessor-count", len(ctx.subprocessors))],
            },
            "control-implementation": {
                "description": (
                    f"Control implementation derived from TrustMCP claims mapped onto "
                    f"{FRAMEWORKS[framework]['name']}. Source catalog: {source_href(framework)}."
                ),
                "implemented-requirements": _implemented_requirements(ctx, framework),
            },
            "back-matter": back_matter(ctx),
        }
    }
