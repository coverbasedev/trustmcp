"""OSCAL assessment-plan and assessment-results.

A trust center *is* a continuous assessment: the vendor publishes claims and
evidence, the network verifies domain ownership and signs the responses, and
freshness is recomputed every time anyone reads. Rendering that as OSCAL
assessment models is what turns a one-off document exchange into something a
GRC platform can re-ingest on a schedule and diff.

The assessment-plan says *what will be looked at and how*. The
assessment-results say *what was observed at this instant*, with one observation
per artifact and per operating control, findings where a mapped control has no
published claim or its evidence has expired, and risks carrying the resulting
exposure. Nothing here invents a verdict: TrustMCP standardizes access to
evidence, not the judgement about it, so every finding states the observable
fact and leaves the pass/fail to the consumer's own policy.
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
    now_iso,
    prop,
    responsible_party,
    vendor_party,
)
from .context import OscalContext


def _assessment_subject(ctx: OscalContext) -> dict:
    return {
        "type": "component",
        "description": f"The {ctx.legal_name} service and its published evidence.",
        "include-all": {},
    }


def _tasks(ctx: OscalContext) -> list[dict]:
    """The recurring activities that make this a *continuous* assessment."""
    return [
        {
            "uuid": derive_uuid(ctx.vendor_id, "task", "evidence-pull"),
            "type": "milestone",
            "title": "Pull published evidence",
            "description": (
                "Fetch the signed manifest and attestations, verify the Ed25519 "
                "signature, and record artifact hashes."
            ),
            "props": [prop("trustmcp-task", "evidence-pull")],
        },
        {
            "uuid": derive_uuid(ctx.vendor_id, "task", "freshness-check"),
            "type": "milestone",
            "title": "Check evidence freshness",
            "description": (
                "Recompute expiry for every artifact and flag anything expired or "
                "inside the expiry window."
            ),
            "props": [prop("trustmcp-task", "freshness-check")],
        },
        {
            "uuid": derive_uuid(ctx.vendor_id, "task", "mark-verification"),
            "type": "milestone",
            "title": "Verify the agent-ready mark",
            "description": "Re-check domain verification and the network's mark status.",
            "props": [prop("trustmcp-task", "mark-verification")],
        },
        {
            "uuid": derive_uuid(ctx.vendor_id, "task", "supply-chain-traversal"),
            "type": "milestone",
            "title": "Traverse the subprocessor graph",
            "description": (
                "Walk published subprocessors and follow any that resolve to their own "
                "TrustMCP profile, for nth-party exposure."
            ),
            "props": [prop("trustmcp-task", "supply-chain-traversal")],
        },
    ]


def assessment_plan(ctx: OscalContext, frameworks: list[str] | None = None) -> dict:
    frameworks = frameworks or list(FRAMEWORKS.keys())
    provider = vendor_party(ctx.vendor_id, ctx.legal_name, ctx.domains)
    anchor = network_party(ctx.network_url)
    return {
        "assessment-plan": {
            "uuid": derive_uuid(ctx.vendor_id, "assessment-plan", ",".join(sorted(frameworks))),
            "metadata": metadata(
                f"{ctx.legal_name} — TrustMCP continuous assessment plan",
                last_modified=as_iso(ctx.generated_at),
                roles=ROLES,
                parties=[provider, anchor],
                responsible_parties=[
                    responsible_party("provider", [provider["uuid"]]),
                    responsible_party("assessor", [anchor["uuid"]]),
                ],
                props=[prop("trustmcp-vendor-id", ctx.vendor_id)],
            ),
            "import-ssp": {
                "href": f"{ctx.network_url}/v1/vendors/{ctx.vendor_id}/oscal/system-security-plan"
            },
            "assessment-subjects": [_assessment_subject(ctx)],
            "assessment-assets": {
                "assessment-platforms": [
                    {
                        "uuid": derive_uuid(ctx.vendor_id, "assessment-platform", "trustmcp"),
                        "title": "TrustMCP network",
                        "props": [prop("trustmcp-network", ctx.network_url)],
                        "links": [link(ctx.network_url, "reference")],
                    }
                ]
            },
            "terms-and-conditions": {
                "parts": [
                    {
                        "name": "method",
                        "prose": (
                            "Evidence is vendor-published and network-signed. The network "
                            "verifies domain ownership and document integrity; it does not "
                            "audit the vendor. Treat claims as asserted, not attested."
                        ),
                    },
                    {
                        "name": "cadence",
                        "prose": (
                            "Continuous. Consumers subscribe to the OSCAL change feed or poll "
                            "with a cursor; the network emits an event whenever published "
                            "evidence, claims, or control status change."
                        ),
                    },
                ]
            },
            "tasks": _tasks(ctx),
        }
    }


# --- Results ----------------------------------------------------------------


def _artifact_observations(ctx: OscalContext) -> list[dict]:
    observations = []
    for a in ctx.artifacts:
        observations.append(
            {
                "uuid": derive_uuid(ctx.vendor_id, "observation", "artifact", a.id),
                "title": f"Published evidence: {a.title or a.type}",
                "description": (
                    f"{a.type} version {a.version}, issued {a.issued_at.isoformat()}"
                    + (
                        f", valid until {a.valid_until.isoformat()}"
                        if a.valid_until
                        else ", no stated expiry"
                    )
                    + f". Access: {a.access}. Freshness: {a.freshness}."
                ),
                "methods": ["EXAMINE"],
                "types": ["control-objective"],
                "props": [
                    prop("trustmcp-artifact-id", a.id),
                    prop("trustmcp-freshness", a.freshness),
                    prop("trustmcp-access", a.access),
                    prop("trustmcp-has-content", a.has_content),
                ],
                "links": [link(f"#{artifact_resource_uuid(ctx.vendor_id, a.id)}", "evidence")],
                "collected": as_iso(ctx.generated_at),
                "relevant-evidence": (
                    [
                        {
                            "href": ctx.artifact_uri(a.id),
                            "description": (
                                f"Signed download URI (sha256 {a.sha256})"
                                if a.sha256
                                else "Signed download URI"
                            ),
                        }
                    ]
                    if a.has_content
                    else None
                ),
            }
        )
    for obs in observations:
        if obs.get("relevant-evidence") is None:
            obs.pop("relevant-evidence")
    return observations


def _control_observations(ctx: OscalContext) -> list[dict]:
    return [
        {
            "uuid": derive_uuid(ctx.vendor_id, "observation", "control", c.category, c.name),
            "title": f"Control status: {c.name}",
            "description": (
                f"{c.category} — {c.name}. Vendor-reported status: {c.status}."
                + (f" {c.description}" if c.description else "")
            ),
            "methods": ["INTERVIEW"],
            "types": ["control-objective"],
            "props": [
                prop("trustmcp-control-category", c.category),
                prop("trustmcp-control-status", c.status),
            ],
            "collected": as_iso(ctx.generated_at),
        }
        for c in ctx.controls
    ]


def _claim_observations(ctx: OscalContext) -> list[dict]:
    return [
        {
            "uuid": derive_uuid(ctx.vendor_id, "observation", "claim", c.key),
            "title": f"Published claim: {c.key}",
            "description": f"The vendor publishes {c.key} = {c.value}.",
            "methods": ["EXAMINE"],
            "types": ["control-objective"],
            "props": [
                prop("trustmcp-claim-key", c.key),
                prop("trustmcp-claim-value", c.value),
                prop("trustmcp-evidence-count", len(c.evidence)),
            ],
            "links": [
                link(f"#{artifact_resource_uuid(ctx.vendor_id, ev)}", "evidence")
                for ev in c.evidence
                if ev in ctx.artifacts_by_id
            ],
            "collected": as_iso(ctx.generated_at),
        }
        for c in ctx.claims
    ]


def _risk(ctx: OscalContext, key: str, title: str, description: str, statement: str) -> dict:
    return {
        "uuid": derive_uuid(ctx.vendor_id, "risk", key),
        "title": title,
        "description": description,
        "statement": statement,
        "status": "open",
        "props": [prop("trustmcp-risk-source", key)],
    }


def _findings_and_risks(ctx: OscalContext, frameworks: list[str]) -> tuple[list[dict], list[dict]]:
    """Findings are observable facts, not verdicts.

    Three things are worth a finding: a mapped control with no published claim
    (a coverage gap), evidence past its stated validity (a staleness gap), and a
    control the vendor itself reports as not operating (a self-reported gap).
    """
    findings: list[dict] = []
    risks: list[dict] = []

    for framework in frameworks:
        mapped = map_claims(
            framework,
            [{"key": c.key, "value": c.value, "evidence": c.evidence} for c in ctx.claims],
        )
        uncovered = [row for row in mapped["controls"] if not row["present"]]
        if not uncovered:
            continue
        risk = _risk(
            ctx,
            f"coverage-{framework}",
            f"Incomplete claim coverage for {mapped['name']}",
            f"{len(uncovered)} of {len(mapped['controls'])} mapped controls have no "
            "published claim.",
            (
                "A control with no published claim is not evidence of a failure — it means "
                "TrustMCP carries nothing about it. Close the gap by asking the vendor "
                "directly or by accepting the residual uncertainty."
            ),
        )
        risks.append(risk)
        findings.append(
            {
                "uuid": derive_uuid(ctx.vendor_id, "finding", "coverage", framework),
                "title": f"Claim coverage gap — {mapped['name']}",
                "description": (
                    "No TrustMCP claim is published for: "
                    + ", ".join(f"{row['control']} ({row['title']})" for row in uncovered)
                    + "."
                ),
                "target": {
                    "type": "objective-id",
                    "target-id": f"{framework}-coverage",
                    "status": {"state": "not-satisfied", "reason": "uncovered"},
                    "description": (
                        f"{len(mapped['controls']) - len(uncovered)} of "
                        f"{len(mapped['controls'])} mapped controls carry a published claim."
                    ),
                },
                "props": [
                    prop("trustmcp-framework", framework),
                    prop("trustmcp-uncovered-count", len(uncovered)),
                ],
                "related-observations": [
                    {"observation-uuid": derive_uuid(ctx.vendor_id, "observation", "claim", c.key)}
                    for c in ctx.claims
                ],
                "related-risks": [{"risk-uuid": risk["uuid"]}],
            }
        )

    expired = [a for a in ctx.artifacts if a.freshness == "expired"]
    expiring = [a for a in ctx.artifacts if a.freshness == "expiring"]
    if expired or expiring:
        risk = _risk(
            ctx,
            "evidence-freshness",
            "Evidence outside its validity window",
            f"{len(expired)} artifact(s) expired and {len(expiring)} approaching expiry.",
            (
                "Expired evidence describes a period that has ended. Re-request the current "
                "version before relying on it."
            ),
        )
        risks.append(risk)
        findings.append(
            {
                "uuid": derive_uuid(ctx.vendor_id, "finding", "freshness"),
                "title": "Evidence freshness",
                "description": (
                    "Expired: "
                    + (", ".join(a.id for a in expired) or "none")
                    + ". Expiring soon: "
                    + (", ".join(a.id for a in expiring) or "none")
                    + "."
                ),
                "target": {
                    "type": "objective-id",
                    "target-id": "evidence-freshness",
                    "status": {
                        "state": "not-satisfied" if expired else "satisfied",
                        "reason": "expired" if expired else "approaching-expiry",
                    },
                },
                "props": [
                    prop("trustmcp-expired-count", len(expired)),
                    prop("trustmcp-expiring-count", len(expiring)),
                ],
                "related-observations": [
                    {
                        "observation-uuid": derive_uuid(
                            ctx.vendor_id, "observation", "artifact", a.id
                        )
                    }
                    for a in [*expired, *expiring]
                ],
                "related-risks": [{"risk-uuid": risk["uuid"]}],
            }
        )

    failing = [c for c in ctx.controls if c.status != "operating"]
    if failing:
        risk = _risk(
            ctx,
            "control-not-operating",
            "Vendor reports controls not operating",
            f"{len(failing)} published control(s) are self-reported as not operating.",
            "The vendor has disclosed these itself. Weigh them against your own requirements.",
        )
        risks.append(risk)
        findings.append(
            {
                "uuid": derive_uuid(ctx.vendor_id, "finding", "controls"),
                "title": "Self-reported control gaps",
                "description": "Not operating: "
                + ", ".join(f"{c.category} / {c.name}" for c in failing)
                + ".",
                "target": {
                    "type": "objective-id",
                    "target-id": "published-controls",
                    "status": {"state": "not-satisfied", "reason": "not-operating"},
                },
                "props": [prop("trustmcp-not-operating-count", len(failing))],
                "related-observations": [
                    {
                        "observation-uuid": derive_uuid(
                            ctx.vendor_id, "observation", "control", c.category, c.name
                        )
                    }
                    for c in failing
                ],
                "related-risks": [{"risk-uuid": risk["uuid"]}],
            }
        )

    if ctx.mark_status != "agent-ready":
        risk = _risk(
            ctx,
            "mark",
            "Agent-ready mark not held",
            f"The vendor's mark status is '{ctx.mark_status}'.",
            (
                "Without the mark, domain ownership is unverified — the profile may not be "
                "controlled by the organization it names."
            ),
        )
        risks.append(risk)
        findings.append(
            {
                "uuid": derive_uuid(ctx.vendor_id, "finding", "mark"),
                "title": "Agent-ready mark",
                "description": f"Mark status at collection time: {ctx.mark_status}.",
                "target": {
                    "type": "objective-id",
                    "target-id": "domain-verification",
                    "status": {"state": "not-satisfied", "reason": "unverified"},
                },
                "related-risks": [{"risk-uuid": risk["uuid"]}],
            }
        )

    return findings, risks


def assessment_results(ctx: OscalContext, frameworks: list[str] | None = None) -> dict:
    """Point-in-time results. Re-pull on a schedule (or subscribe to the change
    feed) and the sequence becomes a continuous assessment record."""
    frameworks = frameworks or list(FRAMEWORKS.keys())
    provider = vendor_party(ctx.vendor_id, ctx.legal_name, ctx.domains)
    anchor = network_party(ctx.network_url)
    observations = [
        *_artifact_observations(ctx),
        *_control_observations(ctx),
        *_claim_observations(ctx),
    ]
    findings, risks = _findings_and_risks(ctx, frameworks)
    collected = as_iso(ctx.generated_at) or now_iso()

    result: dict = {
        "uuid": derive_uuid(ctx.vendor_id, "result", collected),
        "title": f"TrustMCP evidence collection — {collected}",
        "description": (
            "Automated collection of the vendor's published TrustMCP evidence: artifacts "
            "and their freshness, claims, and self-reported control status."
        ),
        "start": collected,
        "end": collected,
        "props": [
            prop("trustmcp-collection-mode", "automated"),
            prop("trustmcp-artifact-count", len(ctx.artifacts)),
            prop("trustmcp-claim-count", len(ctx.claims)),
        ],
        "reviewed-controls": {
            "control-selections": [
                {
                    "description": f"Controls mapped by TrustMCP for {fw}.",
                    "include-controls": [
                        {"control-id": c["id"]} for c in FRAMEWORKS[fw]["controls"]
                    ],
                }
                for fw in frameworks
            ]
        },
    }
    if observations:
        result["observations"] = observations
    if risks:
        result["risks"] = risks
    if findings:
        result["findings"] = findings

    return {
        "assessment-results": {
            "uuid": derive_uuid(ctx.vendor_id, "assessment-results", ",".join(sorted(frameworks))),
            "metadata": metadata(
                f"{ctx.legal_name} — TrustMCP assessment results",
                last_modified=as_iso(ctx.generated_at),
                roles=ROLES,
                parties=[provider, anchor],
                responsible_parties=[
                    responsible_party("provider", [provider["uuid"]]),
                    responsible_party("assessor", [anchor["uuid"]]),
                ],
                props=[prop("trustmcp-vendor-id", ctx.vendor_id)],
            ),
            "import-ap": {
                "href": f"{ctx.network_url}/v1/vendors/{ctx.vendor_id}/oscal/assessment-plan"
            },
            "results": [result],
            "back-matter": back_matter(ctx),
        }
    }
