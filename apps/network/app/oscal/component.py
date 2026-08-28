"""OSCAL component-definition.

The vendor's service, described as a component whose control implementations are
driven by published claims mapped onto a framework. This is the model most GRC
tools ingest first: it answers "what does this vendor claim to do, against which
controls, and what evidence backs it".

Where the old export stopped at a flat list of implemented-requirements, this
one carries the full shape:

  * one component per product line (plus the vendor-level service component),
  * `capabilities` grouping the components by framework coverage,
  * `responsible-roles` naming the vendor as provider,
  * per-requirement `statements` with prose drawn from the claim catalog,
  * `set-parameters` for claims that carry a value (a notification window, an
    SLA) rather than a yes/no,
  * `links` from each requirement to the back-matter evidence resources.
"""

from __future__ import annotations

from ..frameworks import FRAMEWORKS, map_claims
from .backmatter import artifact_resource_uuid, back_matter
from .catalog import control_id, definition_for
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
from .sources import is_resolvable, source_href, source_title


def _claim_props(claim) -> list[dict]:
    props = [
        prop("trustmcp-claim-key", claim.key),
        prop("trustmcp-claim-value", claim.value),
    ]
    for ev in claim.evidence:
        props.append(prop("trustmcp-evidence", ev))
    return props


def _evidence_links(ctx: OscalContext, claim) -> list[dict]:
    """Links from a claim to the back-matter resources that evidence it.

    Claim evidence is stored as artifact ids. Unknown ids are dropped rather
    than emitted as dangling references — a broken OSCAL link is worse than a
    missing one.
    """
    links = []
    for artifact_id in claim.evidence:
        if artifact_id in ctx.artifacts_by_id:
            links.append(
                link(
                    f"#{artifact_resource_uuid(ctx.vendor_id, artifact_id)}",
                    "evidence",
                    text=ctx.artifacts_by_id[artifact_id].title or artifact_id,
                )
            )
    return links


def _implemented_requirement(ctx: OscalContext, component_uuid: str, row: dict) -> dict:
    """One control's implementation, built from the claims mapped onto it."""
    claims_by_key = ctx.claims_by_key
    matched = [claims_by_key[c["key"]] for c in row["claims"] if c["key"] in claims_by_key]

    described = "; ".join(f"{c.key}={_render(c.value)}" for c in matched)
    req: dict = {
        "uuid": derive_uuid(ctx.vendor_id, "requirement", component_uuid, row["control"]),
        "control-id": row["control"],
        "description": (
            f"{row['title']}. Addressed by TrustMCP claims: {described}."
            if matched
            else f"{row['title']}. No TrustMCP claim published for this control."
        ),
        "props": [
            prop("trustmcp-coverage", "claimed" if matched else "not-claimed"),
            prop("trustmcp-claim-count", len(matched)),
        ],
    }

    statements = []
    links: list[dict] = []
    set_parameters = []
    for claim in matched:
        req["props"].extend(_claim_props(claim))
        links.extend(_evidence_links(ctx, claim))
        definition = definition_for(claim.key)
        statements.append(
            {
                "statement-id": f"{row['control']}_smt",
                "uuid": derive_uuid(
                    ctx.vendor_id, "statement", component_uuid, row["control"], claim.key
                ),
                "description": (
                    f"{definition['statement']} "
                    f"Published value: {_render(claim.value)}."
                ),
                "props": [prop("trustmcp-claim-key", claim.key)],
                "links": [
                    link(
                        f"{ctx.network_url}/v1/oscal/catalog#{control_id(claim.key)}",
                        "related",
                        text=definition["title"],
                    )
                ],
            }
        )
        # A claim whose value is not a plain boolean carries a magnitude the
        # consumer needs (hours, percent, a region list). OSCAL models that as a
        # set-parameter rather than burying it in prose.
        if not isinstance(claim.value, bool):
            set_parameters.append(
                {
                    "param-id": control_id(claim.key),
                    "values": [_render(claim.value)],
                }
            )

    if statements:
        # OSCAL keys statements by statement-id; collapse duplicates from
        # multiple claims onto one control into a single statement.
        req["statements"] = _merge_statements(statements)
    if links:
        req["links"] = links
    if set_parameters:
        req["set-parameters"] = set_parameters
    req["responsible-roles"] = [{"role-id": "provider", "party-uuids": [ctx.provider_uuid]}]
    return req


def _merge_statements(statements: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for s in statements:
        existing = merged.get(s["statement-id"])
        if existing is None:
            merged[s["statement-id"]] = dict(s)
            continue
        existing["description"] = f"{existing['description']} {s['description']}"
        existing["props"] = [*existing.get("props", []), *s.get("props", [])]
        existing["links"] = [*existing.get("links", []), *s.get("links", [])]
    return list(merged.values())


def _render(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _control_implementation(ctx: OscalContext, component_uuid: str, framework: str) -> dict:
    mapped = map_claims(
        framework,
        [{"key": c.key, "value": c.value, "evidence": c.evidence} for c in ctx.claims],
    )
    covered = sum(1 for row in mapped["controls"] if row["present"])
    return {
        "uuid": derive_uuid(ctx.vendor_id, "control-implementation", component_uuid, framework),
        "source": source_href(framework),
        "description": (
            f"{mapped['name']} — {covered} of {len(mapped['controls'])} mapped controls have "
            f"a published TrustMCP claim. Source catalog: {source_title(framework)}"
            + (
                ""
                if is_resolvable(framework)
                else " (informative reference; no public OSCAL catalog)"
            )
            + "."
        ),
        "props": [
            prop("trustmcp-framework", framework),
            prop("trustmcp-controls-covered", covered),
            prop("trustmcp-controls-total", len(mapped["controls"])),
            prop("trustmcp-source-resolvable", is_resolvable(framework)),
        ],
        "implemented-requirements": [
            _implemented_requirement(ctx, component_uuid, row) for row in mapped["controls"]
        ],
    }


def _service_component(ctx: OscalContext, frameworks: list[str]) -> dict:
    component_uuid = derive_uuid(ctx.vendor_id, "component", "service")
    props = [
        prop("trustmcp-vendor-id", ctx.vendor_id),
        prop("trustmcp-mark", ctx.mark_status),
    ]
    for domain in ctx.domains:
        props.append(prop("trustmcp-verified-domain", domain))
    return {
        "uuid": component_uuid,
        "type": "service",
        "title": ctx.product or ctx.legal_name,
        "description": (
            f"{ctx.legal_name} service as published through TrustMCP. Evidence is released "
            "under scoped access keys; see back-matter for artifact URIs and hashes."
        ),
        "purpose": (
            f"Third-party service assessed via the TrustMCP trust center "
            f"for {ctx.legal_name}."
        ),
        "props": props,
        "links": [
            link(f"{ctx.network_url}/v1/vendors/{ctx.vendor_id}/public", "trust-center"),
            link(f"{ctx.network_url}/v1/vendors/{ctx.vendor_id}/manifest", "manifest"),
        ],
        "responsible-roles": [
            {"role-id": "provider", "party-uuids": [ctx.provider_uuid]},
            {"role-id": "trust-anchor", "party-uuids": [ctx.anchor_uuid]},
        ],
        "control-implementations": [
            _control_implementation(ctx, component_uuid, fw) for fw in frameworks
        ],
    }


def _product_component(ctx: OscalContext, product: dict) -> dict:
    """A component per published product line, carrying the artifacts scoped to it.

    Product components have no control-implementations of their own — the claims
    are vendor-level — but they let a consumer see which evidence applies to the
    product they are actually buying.
    """
    component_uuid = derive_uuid(ctx.vendor_id, "component", "product", product["id"])
    scoped = [a for a in ctx.artifacts if product["id"] in a.product_ids]
    return {
        "uuid": component_uuid,
        "type": "service",
        "title": product["name"],
        "description": f"Product line '{product['name']}' of {ctx.legal_name}.",
        "purpose": f"Scopes TrustMCP evidence to the {product['name']} product line.",
        "props": [
            prop("trustmcp-product-id", product["id"]),
            prop("trustmcp-artifact-count", len(scoped)),
        ],
        "links": [
            link(
                f"#{artifact_resource_uuid(ctx.vendor_id, a.id)}",
                "evidence",
                text=a.title or a.id,
            )
            for a in scoped
        ],
        "responsible-roles": [{"role-id": "provider", "party-uuids": [ctx.provider_uuid]}],
    }


def _subprocessor_component(ctx: OscalContext, sub) -> dict:
    """Each subprocessor as its own component, so nth-party exposure survives the
    export instead of collapsing into a claim count."""
    props = [prop("trustmcp-subprocessor", "true")]
    if sub.domain:
        props.append(prop("trustmcp-domain", sub.domain))
    if sub.location:
        props.append(prop("trustmcp-location", sub.location))
    if sub.category:
        props.append(prop("trustmcp-category", sub.category))
    return {
        "uuid": derive_uuid(ctx.vendor_id, "component", "subprocessor", sub.name),
        "type": "service",
        "title": sub.name,
        "description": sub.purpose or f"Subprocessor engaged by {ctx.legal_name}.",
        "purpose": sub.purpose or "Subprocessor",
        "props": props,
    }


def _capability(ctx: OscalContext, framework: str, component_uuids: list[str]) -> dict:
    fw = FRAMEWORKS[framework]
    return {
        "uuid": derive_uuid(ctx.vendor_id, "capability", framework),
        "name": f"{ctx.legal_name} — {fw['name']}",
        "description": (
            f"The set of components whose published TrustMCP evidence is mapped onto "
            f"{fw['name']}."
        ),
        "props": [prop("trustmcp-framework", framework)],
        "incorporates-components": [
            {"component-uuid": uid, "description": "Included in this coverage capability."}
            for uid in component_uuids
        ],
    }


def component_definition(
    ctx: OscalContext,
    frameworks: list[str] | None = None,
    *,
    include_subprocessors: bool = True,
) -> dict:
    """The full component-definition for a vendor.

    `frameworks` defaults to every framework TrustMCP can map, so a single pull
    gives a consumer the vendor's coverage against all of them at once.
    """
    frameworks = frameworks or list(FRAMEWORKS.keys())
    unknown = [f for f in frameworks if f not in FRAMEWORKS]
    if unknown:
        raise ValueError(f"unknown framework(s): {', '.join(unknown)}")

    provider = vendor_party(ctx.vendor_id, ctx.legal_name, ctx.domains)
    anchor = network_party(ctx.network_url)

    service = _service_component(ctx, frameworks)
    components = [service]
    components.extend(_product_component(ctx, p) for p in ctx.products)
    if include_subprocessors:
        components.extend(_subprocessor_component(ctx, s) for s in ctx.subprocessors)

    return {
        "component-definition": {
            "uuid": derive_uuid(
                ctx.vendor_id, "component-definition", ",".join(sorted(frameworks))
            ),
            "metadata": metadata(
                f"{ctx.legal_name} — TrustMCP component definition",
                last_modified=as_iso(ctx.generated_at),
                roles=ROLES,
                parties=[provider, anchor],
                responsible_parties=[
                    responsible_party("provider", [provider["uuid"]]),
                    responsible_party("trust-anchor", [anchor["uuid"]]),
                ],
                props=[
                    prop("trustmcp-vendor-id", ctx.vendor_id),
                    prop("trustmcp-mark", ctx.mark_status),
                    prop("trustmcp-published-at", as_iso(ctx.published_at) or ""),
                ],
                links=[
                    link(
                        f"{ctx.network_url}/v1/vendors/{ctx.vendor_id}/public", "trust-center"
                    )
                ],
            ),
            "components": components,
            "capabilities": [
                _capability(ctx, fw, [service["uuid"]]) for fw in frameworks
            ],
            "back-matter": back_matter(ctx),
        }
    }
