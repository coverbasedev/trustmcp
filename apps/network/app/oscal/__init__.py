"""OSCAL support for TrustMCP.

TrustMCP speaks every OSCAL model, in every OSCAL format, both point-in-time and
continuously:

  catalog                        the TrustMCP claim vocabulary as controls
  profile                        the coverage baseline for a framework
  component-definition           the vendor's service and its claimed controls
  system-security-plan           the provider side of the shared boundary
  assessment-plan                what a continuous assessment looks at
  assessment-results             what was observed at this instant
  plan-of-action-and-milestones  the gaps, as tracked items

Point-in-time is a GET. Continuous is the same documents plus `app.oscal.feed`:
a cursor-based change log, an SSE stream, and webhook subscriptions that fire
whenever the underlying evidence changes.

`build` is the single entry point the router and MCP server call; everything
else here is either a model builder it dispatches to, or the import direction
(`ingest`).
"""

from __future__ import annotations

from ..frameworks import FRAMEWORKS
from .assessment import assessment_plan, assessment_results
from .catalog import CATALOG_ID, catalog, profile
from .common import DOCUMENT_VERSION, OSCAL_VERSION, digest_of
from .component import component_definition
from .context import OscalContext, from_vendor
from .ingest import apply_import, plan_import
from .poam import plan_of_action_and_milestones
from .serialize import MEDIA_TYPES, render
from .ssp import system_security_plan
from .validate import validate

# Models rendered per vendor. `catalog` and `profile` are network-level and are
# served from their own routes, since they do not vary by vendor.
VENDOR_MODELS: dict[str, str] = {
    "component-definition": "The vendor's service and the controls its claims address.",
    "system-security-plan": "Provider-scoped SSP: system, components, and control implementation.",
    "assessment-plan": "What the continuous assessment examines, and how often.",
    "assessment-results": "Observations, findings, and risks at this instant.",
    "plan-of-action-and-milestones": "Open gaps as tracked items with deadlines.",
}

NETWORK_MODELS: dict[str, str] = {
    "catalog": "The TrustMCP claim vocabulary rendered as an OSCAL catalog.",
    "profile": "Per-framework baseline of the controls TrustMCP evidence addresses.",
}

FORMATS = ("json", "yaml", "xml")

# Aliases so a consumer can ask for the model by its common short name.
ALIASES = {
    "cdef": "component-definition",
    "component": "component-definition",
    "ssp": "system-security-plan",
    "ap": "assessment-plan",
    "ar": "assessment-results",
    "results": "assessment-results",
    "poam": "plan-of-action-and-milestones",
    "poa&m": "plan-of-action-and-milestones",
}


def resolve_model(name: str) -> str:
    key = (name or "").strip().lower()
    return ALIASES.get(key, key)


def build(model: str, ctx: OscalContext, *, frameworks: list[str] | None = None) -> dict:
    """Render one OSCAL model for a vendor context."""
    model = resolve_model(model)
    if model == "component-definition":
        return component_definition(ctx, frameworks)
    if model == "system-security-plan":
        return system_security_plan(ctx, (frameworks or ["nist_800_53"])[0])
    if model == "assessment-plan":
        return assessment_plan(ctx, frameworks)
    if model == "assessment-results":
        return assessment_results(ctx, frameworks)
    if model == "plan-of-action-and-milestones":
        return plan_of_action_and_milestones(ctx, frameworks)
    raise ValueError(f"unknown OSCAL model: {model}")


def build_all(ctx: OscalContext, *, frameworks: list[str] | None = None) -> dict[str, dict]:
    """Every vendor model in one pass — the payload behind `/oscal/bundle`."""
    return {model: build(model, ctx, frameworks=frameworks) for model in VENDOR_MODELS}


def bundle(ctx: OscalContext, *, frameworks: list[str] | None = None) -> dict:
    """All vendor models plus the digests a continuous consumer diffs on."""
    documents = build_all(ctx, frameworks=frameworks)
    return {
        "vendor_id": ctx.vendor_id,
        "oscal_version": OSCAL_VERSION,
        "document_version": DOCUMENT_VERSION,
        "generated_at": ctx.generated_at.isoformat(),
        "frameworks": frameworks or list(FRAMEWORKS.keys()),
        "digests": {name: digest_of(doc) for name, doc in documents.items()},
        "documents": documents,
    }


def capabilities() -> dict:
    """What this deployment supports — served unauthenticated so a consumer can
    negotiate before it holds a key."""
    return {
        "oscal_version": OSCAL_VERSION,
        "document_version": DOCUMENT_VERSION,
        "formats": list(FORMATS),
        "media_types": MEDIA_TYPES,
        "vendor_models": [
            {"name": name, "description": desc} for name, desc in VENDOR_MODELS.items()
        ],
        "network_models": [
            {"name": name, "description": desc} for name, desc in NETWORK_MODELS.items()
        ],
        "aliases": ALIASES,
        "frameworks": [
            {"id": fid, "name": fw["name"], "controls": len(fw["controls"])}
            for fid, fw in FRAMEWORKS.items()
        ],
        "catalog_id": CATALOG_ID,
        "exchange": {
            "point_in_time": {
                "read": "GET /v1/vendors/{vendor_id}/oscal/{model}",
                "bundle": "GET /v1/vendors/{vendor_id}/oscal/bundle",
                "write": "POST /v1/vendors/{vendor_id}/oscal/import",
            },
            "continuous": {
                "poll": "GET /v1/vendors/{vendor_id}/oscal/changes?since={cursor}",
                "stream": "GET /v1/vendors/{vendor_id}/oscal/stream",
                "subscribe": "POST /v1/vendors/{vendor_id}/oscal/subscriptions",
            },
        },
        "notes": [
            "Documents are deterministic: re-exporting unchanged evidence yields identical "
            "UUIDs and an identical content digest.",
            "Evidence is carried by reference in back-matter with SHA-256 hashes. Fetching "
            "a private artifact requires a scoped access key.",
            "TrustMCP standardizes access to evidence, not the verdict. Findings state "
            "observable facts; pass/fail remains the consumer's policy decision.",
        ],
    }


def supported() -> list[str]:
    """Frameworks available for mapping. Kept for API compatibility."""
    return list(FRAMEWORKS.keys())


__all__ = [
    "ALIASES",
    "FORMATS",
    "NETWORK_MODELS",
    "OSCAL_VERSION",
    "VENDOR_MODELS",
    "OscalContext",
    "apply_import",
    "assessment_plan",
    "assessment_results",
    "build",
    "build_all",
    "bundle",
    "capabilities",
    "catalog",
    "component_definition",
    "digest_of",
    "from_vendor",
    "plan_import",
    "plan_of_action_and_milestones",
    "profile",
    "render",
    "resolve_model",
    "supported",
    "system_security_plan",
    "validate",
]
