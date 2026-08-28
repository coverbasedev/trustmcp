"""OSCAL plan-of-action-and-milestones.

The POA&M is where a continuous exchange earns its keep. Everything the
assessment-results flagged — an expired SOC 2, a control the vendor reports as
not operating, a framework control with no published claim — becomes a tracked
item with a milestone, so the customer's GRC tool can carry it as open work
instead of re-deriving it on every pull.

Deadlines come from facts the vendor published (an artifact's `valid_until`),
never from a policy TrustMCP invented. Items with no vendor-stated deadline are
emitted without one; the consuming organization sets its own.
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


def _origin(ctx: OscalContext) -> dict:
    return {
        "actors": [
            {
                "type": "assessment-platform",
                "actor-uuid": derive_uuid(ctx.vendor_id, "assessment-platform", "trustmcp"),
                "props": [prop("trustmcp-network", ctx.network_url)],
            }
        ]
    }


def _item(
    ctx: OscalContext,
    key: str,
    title: str,
    description: str,
    *,
    props: list[dict] | None = None,
    links: list[dict] | None = None,
    remarks: str | None = None,
) -> dict:
    item: dict = {
        "uuid": derive_uuid(ctx.vendor_id, "poam-item", key),
        "title": title,
        "description": description,
        "origins": [_origin(ctx)],
        "props": props or [],
    }
    if links:
        item["links"] = links
    if remarks:
        item["remarks"] = remarks
    return item


def _expiry_items(ctx: OscalContext) -> list[dict]:
    items = []
    for a in ctx.artifacts:
        if a.freshness == "valid":
            continue
        props = [
            prop("trustmcp-artifact-id", a.id),
            prop("trustmcp-freshness", a.freshness),
        ]
        if a.valid_until:
            # OSCAL has no first-class deadline on a POA&M item; the convention
            # is a `scheduled-completion-date` prop, so consumers can sort on it.
            props.append(prop("scheduled-completion-date", a.valid_until.isoformat(), ns=None))
        verb = "expired on" if a.freshness == "expired" else "expires on"
        items.append(
            _item(
                ctx,
                f"artifact-expiry-{a.id}",
                f"Refresh {a.title or a.type}",
                (
                    f"{a.title or a.type} ({a.id}) {verb} "
                    f"{a.valid_until.isoformat() if a.valid_until else 'an unstated date'}. "
                    "Request the current version from the vendor before relying on it."
                ),
                props=props,
                links=[link(f"#{artifact_resource_uuid(ctx.vendor_id, a.id)}", "evidence")],
                remarks=(
                    "Deadline taken from the vendor's published validity date. TrustMCP does "
                    "not set expiry policy."
                ),
            )
        )
    return items


def _coverage_items(ctx: OscalContext, frameworks: list[str]) -> list[dict]:
    items = []
    for framework in frameworks:
        mapped = map_claims(
            framework,
            [{"key": c.key, "value": c.value, "evidence": c.evidence} for c in ctx.claims],
        )
        for row in mapped["controls"]:
            if row["present"]:
                continue
            items.append(
                _item(
                    ctx,
                    f"coverage-{framework}-{row['control']}",
                    f"Obtain evidence for {row['control']} ({framework})",
                    (
                        f"No TrustMCP claim is published for {row['control']} — "
                        f"{row['title']}. Ask the vendor to publish one, or record why the "
                        "gap is acceptable."
                    ),
                    props=[
                        prop("trustmcp-framework", framework),
                        prop("trustmcp-control-id", row["control"]),
                        prop("trustmcp-gap-type", "no-claim"),
                    ],
                )
            )
    return items


def _control_items(ctx: OscalContext) -> list[dict]:
    return [
        _item(
            ctx,
            f"control-{c.category}-{c.name}",
            f"Track: {c.name}",
            (
                f"{ctx.legal_name} reports '{c.name}' ({c.category}) as {c.status}."
                + (f" {c.description}" if c.description else "")
            ),
            props=[
                prop("trustmcp-control-category", c.category),
                prop("trustmcp-control-status", c.status),
                prop("trustmcp-gap-type", "self-reported"),
            ],
        )
        for c in ctx.controls
        if c.status != "operating"
    ]


def _mark_item(ctx: OscalContext) -> list[dict]:
    if ctx.mark_status == "agent-ready":
        return []
    return [
        _item(
            ctx,
            "mark",
            "Vendor domain ownership unverified",
            (
                f"The trust center for {ctx.legal_name} holds mark status "
                f"'{ctx.mark_status}'. Until a domain is verified, the profile is not "
                "provably controlled by the organization it names."
            ),
            props=[prop("trustmcp-mark", ctx.mark_status), prop("trustmcp-gap-type", "unverified")],
            links=[link(f"{ctx.network_url}/v1/mark/{ctx.vendor_id}", "reference")],
        )
    ]


def plan_of_action_and_milestones(
    ctx: OscalContext, frameworks: list[str] | None = None
) -> dict:
    frameworks = frameworks or list(FRAMEWORKS.keys())
    provider = vendor_party(ctx.vendor_id, ctx.legal_name, ctx.domains)
    anchor = network_party(ctx.network_url)
    items = [
        *_mark_item(ctx),
        *_expiry_items(ctx),
        *_control_items(ctx),
        *_coverage_items(ctx, frameworks),
    ]
    if not items:
        # OSCAL requires at least one poam-item. An empty POA&M is a real and
        # meaningful state, so say so explicitly rather than emitting an invalid
        # document or a fake gap.
        items = [
            _item(
                ctx,
                "no-open-items",
                "No open items",
                (
                    "Every framework control TrustMCP maps carries a published claim, all "
                    "evidence is inside its validity window, and no control is reported as "
                    "not operating."
                ),
                props=[prop("trustmcp-gap-type", "none")],
            )
        ]

    return {
        "plan-of-action-and-milestones": {
            "uuid": derive_uuid(ctx.vendor_id, "poam", ",".join(sorted(frameworks))),
            "metadata": metadata(
                f"{ctx.legal_name} — TrustMCP plan of action and milestones",
                last_modified=as_iso(ctx.generated_at),
                roles=ROLES,
                parties=[provider, anchor],
                responsible_parties=[
                    responsible_party("provider", [provider["uuid"]]),
                    responsible_party("assessor", [anchor["uuid"]]),
                ],
                props=[
                    prop("trustmcp-vendor-id", ctx.vendor_id),
                    prop("trustmcp-open-items", len(items)),
                ],
            ),
            "import-ssp": {
                "href": f"{ctx.network_url}/v1/vendors/{ctx.vendor_id}/oscal/system-security-plan"
            },
            "system-id": {
                "identifier-type": "https://trustmcp.org/ns/vendor-id",
                "id": ctx.vendor_id,
            },
            "poam-items": items,
            "back-matter": back_matter(ctx),
        }
    }
