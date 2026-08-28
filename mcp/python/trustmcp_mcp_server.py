"""TrustMCP — reference MCP server.

Exposes the TrustMCP operations as MCP tools so any agent can run a
third-party assessment through a single connector. The server holds the customer's
access keys and talks to the network on the agent's behalf. Signed responses
(manifest, attestations) are verified against the network's Ed25519 key.

Environment:
    TRUSTMCP_NETWORK   network base URL (default https://network.trustmcp.app)
    TRUSTMCP_KEYS      JSON map of vendor_id -> access key, e.g. {"vnd_acme": "tmcp_live_..."}

Run:
    uv run trustmcp-mcp           # stdio transport
"""

from __future__ import annotations

import os

import httpx
from mcp.server.fastmcp import FastMCP

import mcp_audit
from trustmcp_client import TrustMCPClient

mcp = FastMCP("assurance-network")
_client = TrustMCPClient()

# Base URL of the TrustMCP web app, for reading published MCP audit scorecards.
_WEB_BASE = os.environ.get("TRUSTMCP_WEB", "https://trustmcp.app").rstrip("/")


@mcp.tool()
def discover_vendor(domain: str) -> dict:
    """Resolve a vendor domain to its assurance profile location (vendor id + network)."""
    return _client.discover_vendor(domain)


@mcp.tool()
def request_access(
    vendor_id: str, requester: dict, scope: list[str], nda_accepted: bool = False
) -> dict:
    """Ask a vendor for an access key. `requester` is {name, domain, contact}; `scope` is
    any of ["manifest","attestations","artifacts"]. Set `nda_accepted` if the vendor
    requires an NDA. Returns granted (with key) if a policy/agent auto-approves, else
    pending."""
    return _client.request_access(vendor_id, requester, scope, nda_accepted)


@mcp.tool()
def get_manifest(vendor_id: str) -> dict:
    """Return the published manifest (signature-verified)."""
    return _client.get_manifest(vendor_id)


@mcp.tool()
def get_attestations(vendor_id: str, keys: list[str] | None = None) -> dict:
    """Return structured claims (signature-verified), optionally filtered to specific keys."""
    return _client.get_attestations(vendor_id, keys)


@mcp.tool()
def get_attestations_mapped(vendor_id: str, framework: str = "soc2") -> dict:
    """Map the vendor's claims onto a control framework (soc2 / nist_800_53 / iso_27001)."""
    return _client.get_mapped_attestations(vendor_id, framework)


@mcp.tool()
def get_oscal(vendor_id: str, framework: str = "soc2") -> dict:
    """Export the vendor's claims as an OSCAL component definition (the original
    single-model export). Prefer get_oscal_model for the full OSCAL surface."""
    return _client.get_oscal(vendor_id, framework)


# --- OSCAL: point-in-time ----------------------------------------------------


@mcp.tool()
def list_oscal_models() -> dict:
    """List every OSCAL model, format, and alias this network supports, plus the
    endpoints for point-in-time and continuous exchange. Call this first when you
    do not know what the deployment offers."""
    return _client.get_oscal_capabilities()


@mcp.tool()
def get_oscal_model(
    vendor_id: str,
    model: str = "component-definition",
    format: str = "json",
    frameworks: list[str] | None = None,
) -> dict | str:
    """Return one OSCAL model for a vendor, at this instant.

    `model` is an OSCAL model name — component-definition, system-security-plan,
    assessment-plan, assessment-results, plan-of-action-and-milestones — or a
    short alias (cdef, ssp, ap, ar, poam). `format` is json, yaml, or xml; JSON
    comes back parsed, the others as text ready to hand to another tool.
    `frameworks` narrows the mapping (default: all of them)."""
    return _client.get_oscal_model(vendor_id, model, fmt=format, frameworks=frameworks)


@mcp.tool()
def get_oscal_component_definition(vendor_id: str, frameworks: list[str] | None = None) -> dict:
    """The vendor's service and the controls its published claims address, with
    evidence carried by reference in back-matter (URI + SHA-256)."""
    return _client.get_oscal_model(vendor_id, "component-definition", frameworks=frameworks)


@mcp.tool()
def get_oscal_ssp(vendor_id: str, framework: str = "nist_800_53") -> dict:
    """A provider-scoped OSCAL system-security-plan: the system, its components
    (including subprocessors), and how the controls are implemented. Import it as
    the starting point for your own system's plan — the vendor-side parts are
    already filled in."""
    return _client.get_oscal_model(vendor_id, "system-security-plan", frameworks=[framework])


@mcp.tool()
def get_oscal_assessment_plan(vendor_id: str) -> dict:
    """What the continuous assessment examines and how often — the tasks a
    consumer repeats on every pull."""
    return _client.get_oscal_model(vendor_id, "assessment-plan")


@mcp.tool()
def get_oscal_assessment_results(vendor_id: str, frameworks: list[str] | None = None) -> dict:
    """Observations, findings, and risks at this instant: every artifact and its
    freshness, every claim, and every self-reported control status. Findings state
    observable facts; the pass/fail judgement stays yours."""
    return _client.get_oscal_model(vendor_id, "assessment-results", frameworks=frameworks)


@mcp.tool()
def get_oscal_poam(vendor_id: str, frameworks: list[str] | None = None) -> dict:
    """Open gaps as tracked OSCAL POA&M items: expired evidence, controls the
    vendor reports as not operating, and framework controls with no published
    claim. Deadlines come from the vendor's own validity dates."""
    return _client.get_oscal_model(
        vendor_id, "plan-of-action-and-milestones", frameworks=frameworks
    )


@mcp.tool()
def get_oscal_bundle(vendor_id: str, frameworks: list[str] | None = None) -> dict:
    """Every OSCAL model for a vendor in one call, with a content digest per
    document and the current change cursor. Store the digests; on the next pull,
    re-read only the documents whose digest moved."""
    return _client.get_oscal_bundle(vendor_id, frameworks)


@mcp.tool()
def get_oscal_catalog() -> dict:
    """The TrustMCP claim vocabulary as an OSCAL catalog, so claims are
    addressable by control id."""
    return _client.get_oscal_catalog()


@mcp.tool()
def get_oscal_profile(framework: str = "soc2") -> dict:
    """The OSCAL profile naming which framework controls TrustMCP evidence can
    speak to — the coverage boundary, stated up front."""
    return _client.get_oscal_profile(framework)


@mcp.tool()
def validate_oscal(document: dict) -> dict:
    """Check an OSCAL document's structure: root model, required metadata, valid
    and unique UUIDs, and no dangling internal references."""
    return _client.validate_oscal(document)


# --- OSCAL: continuous -------------------------------------------------------


@mcp.tool()
def get_oscal_changes(
    vendor_id: str, since: int = 0, limit: int = 100, models: list[str] | None = None
) -> dict:
    """Everything that changed since a cursor, and the cursor to use next.

    This is how you monitor a vendor continuously without re-pulling documents:
    poll with your last cursor, and each change names the OSCAL models it
    invalidated. `has_more` in the response means keep paging before treating
    yourself as caught up."""
    return _client.get_oscal_changes(vendor_id, since, limit=limit, models=models)


@mcp.tool()
def subscribe_oscal_changes(
    vendor_id: str, url: str, secret: str | None = None, models: list[str] | None = None
) -> dict:
    """Register an HTTPS webhook to be pushed this vendor's OSCAL changes.

    Deliveries are HMAC-signed with `secret`. The subscription is bound to the
    access key that created it, so it stops when that key is revoked."""
    return _client.subscribe_oscal(vendor_id, url, secret=secret, models=models)


@mcp.tool()
def list_oscal_subscriptions(vendor_id: str) -> dict:
    """Your own change subscriptions for this vendor."""
    return _client.list_oscal_subscriptions(vendor_id)


@mcp.tool()
def unsubscribe_oscal_changes(vendor_id: str, subscription_id: str) -> dict:
    """Cancel one change subscription."""
    _client.unsubscribe_oscal(vendor_id, subscription_id)
    return {"vendor_id": vendor_id, "subscription_id": subscription_id, "cancelled": True}


@mcp.tool()
def poll_oscal_for_changes(
    vendor_id: str, since: int = 0, models: list[str] | None = None
) -> dict:
    """Check for changes and fetch only the models that actually moved.

    One call for the common continuous-monitoring step: give it your last cursor
    and it returns the new cursor, the changes, and the re-pulled documents —
    nothing when nothing changed."""
    batch = _client.get_oscal_changes(vendor_id, since, models=models)
    invalidated: list[str] = []
    for change in batch.get("changes", []):
        for model in change.get("models", []):
            if model not in invalidated:
                invalidated.append(model)
    documents = {
        model: _client.get_oscal_model(vendor_id, model) for model in invalidated
    }
    return {
        "vendor_id": vendor_id,
        "cursor": batch.get("cursor", since),
        "has_more": batch.get("has_more", False),
        "changes": batch.get("changes", []),
        "documents": documents,
    }


@mcp.tool()
def list_frameworks() -> dict:
    """List control frameworks available for claim mapping / OSCAL export."""
    return _client.get_frameworks()


@mcp.tool()
def fetch_artifact(vendor_id: str, artifact_id: str) -> dict:
    """Return a short-lived signed download URL and expected sha256 for the current
    version of an artifact. Verify the bytes against the hash before trusting them."""
    return _client.fetch_artifact(vendor_id, artifact_id)


@mcp.tool()
def get_artifact_versions(vendor_id: str, artifact_id: str) -> dict:
    """Return the version history (metadata) for an artifact."""
    return _client.get_artifact_versions(vendor_id, artifact_id)


@mcp.tool()
def fetch_artifact_version(vendor_id: str, artifact_id: str, version: int) -> dict:
    """Return a signed download URL + hash for a specific (current or archived) version."""
    return _client.fetch_artifact_version(vendor_id, artifact_id, version)


@mcp.tool()
def check_freshness(vendor_id: str) -> dict:
    """Return valid, expiring, and expired artifacts for a vendor."""
    return _client.check_freshness(vendor_id)


@mcp.tool()
def get_subprocessor_graph(vendor_id: str) -> dict:
    """Return the nth-party graph: subprocessors linked to TrustMCP vendors when their domain
    matches a published profile. Traverse linked_vendor.vendor_id for nth-party risk."""
    return _client.get_subprocessor_graph(vendor_id)


@mcp.tool()
def verify_mark(vendor_id: str) -> dict:
    """Verify the vendor's agent-ready mark and verified domains via the network."""
    return _client.get_mark(vendor_id)


@mcp.tool()
def get_network_key() -> dict:
    """Return the network's Ed25519 public key used to sign manifest/attestations."""
    return _client.get_network_key()


# --- MCP Audit: inspect, probe, and interact with audit results --------------


@mcp.tool()
def list_risk_dimensions() -> dict:
    """List the TrustMCP MCP-audit risk taxonomy: the risk dimensions every audit
    scores a server against (data, privacy, autonomy, financial, compliance,
    reputational, liability, and more). Use this to understand the nomenclature
    before reading or requesting an audit."""
    return {"dimensions": mcp_audit.RISK_DIMENSIONS}


@mcp.tool()
def inspect_mcp_server(url: str, bearer: str | None = None, intended_use: str = "") -> dict:
    """Directly inspect a target MCP server, read-only, and return its classified
    tool inventory, aggregated risk signals, and dynamically generated probes.

    This is the deterministic core of a TrustMCP audit: it performs the MCP
    handshake and enumerates every tool (classifying each as read/write/destructive/
    outward/execute, the data classes it touches, and whether its description looks
    like tool poisoning), then generates probes tailored to THIS server. It never
    calls a tool — write/destructive/outward probes are recommendations only. Pass
    `intended_use` to tailor probes to how you plan to integrate the server. For a
    fully scored scorecard, run a scan in the TrustMCP MCP Audit workspace."""
    return mcp_audit.inspect_and_probe(url, bearer, intended_use)


@mcp.tool()
def generate_audit_probes(url: str, bearer: str | None = None, intended_use: str = "") -> dict:
    """Generate dynamic, server-specific audit probes for an MCP server without
    scoring it. Enumerates the tools read-only and returns probe hypotheses and
    prompts (each marked read_only or review_only) you can run to discover what the
    server allows. Every server differs, so these are built from its actual tool
    surface, not a static checklist."""
    result = mcp_audit.inspect_server(url, bearer)
    if not result.get("ok"):
        return result
    return {
        "ok": True,
        "target": url,
        "dynamic_probes": mcp_audit.generate_probes(result["tools"], intended_use),
    }


@mcp.tool()
def get_mcp_audit(vendor_id: str, slug: str) -> dict:
    """Read a published TrustMCP MCP-audit scorecard for a vendor's own MCP server.

    Returns the standardized scorecard (overall grade, per-dimension risk, findings,
    integration analysis) plus the evidence content hash. `slug` is the audit's
    publish slug from its public trust-center page (/trust/<vendor_id>/audit/<slug>)."""
    try:
        r = httpx.get(f"{_WEB_BASE}/api/audit/{vendor_id}/{slug}", timeout=30)
        if r.status_code == 404:
            return {"error": "not_found", "detail": "No published audit at that vendor/slug."}
        r.raise_for_status()
        return r.json()
    except Exception as e:  # pragma: no cover - network dependent
        return {"error": "fetch_failed", "detail": str(e)[:200]}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
