"""Evidence as OSCAL `back-matter` resources.

TrustMCP artifacts (SOC 2 reports, pen tests, SBOMs, policies) are the evidence
behind every claim. OSCAL carries evidence by reference, in `back-matter`, so
each artifact becomes one resource with its hash and its network URI. A consumer
resolves the URI with a scoped access key and verifies the bytes against the
recorded SHA-256 before trusting them.

Private artifacts are still *listed* — that is the point of a trust center: you
can see what exists before you are entitled to read it. The `access` prop tells
a consumer whether fetching will require a key.
"""

from __future__ import annotations

from .common import derive_uuid, prop, resource, rlink, sha256_hash
from .context import ArtifactRecord, OscalContext

# Artifact type -> the OSCAL resource "type" prop, using NIST's vocabulary where
# one applies. Anything unmapped falls through as "evidence".
RESOURCE_TYPE = {
    "soc2_type1": "assessment-report",
    "soc2_type2": "assessment-report",
    "soc3": "assessment-report",
    "iso_27001": "certification",
    "pentest": "assessment-report",
    "sbom": "system-inventory",
    "policy": "policy",
    "architecture": "system-design",
    "dpa": "agreement",
    "insurance_coi": "attestation",
    "financials": "evidence",
    "subprocessor_list": "system-inventory",
    "questionnaire": "questionnaire",
}


def artifact_resource_uuid(vendor_id: str, artifact_id: str) -> str:
    return derive_uuid(vendor_id, "resource", "artifact", artifact_id)


def artifact_resource(ctx: OscalContext, artifact: ArtifactRecord) -> dict:
    """One artifact rendered as a back-matter resource."""
    props = [
        prop("type", RESOURCE_TYPE.get(artifact.type, "evidence"), ns=None),
        prop("trustmcp-artifact-id", artifact.id),
        prop("trustmcp-artifact-type", artifact.type),
        prop("trustmcp-artifact-version", artifact.version),
        prop("trustmcp-access", artifact.access),
        prop("trustmcp-freshness", artifact.freshness),
        prop("published", artifact.issued_at.isoformat(), ns=None),
    ]
    if artifact.valid_until:
        props.append(prop("expires", artifact.valid_until.isoformat(), ns=None))
    if artifact.category:
        props.append(prop("trustmcp-category", artifact.category))
    if artifact.scope:
        props.append(prop("trustmcp-scope", artifact.scope))
    for pid in artifact.product_ids:
        props.append(prop("trustmcp-product-id", pid))

    description = artifact.description or (
        f"{artifact.type} issued {artifact.issued_at.isoformat()}"
        + (f", valid until {artifact.valid_until.isoformat()}" if artifact.valid_until else "")
    )

    rlinks = []
    if artifact.has_content:
        rlinks.append(
            rlink(
                ctx.artifact_uri(artifact.id),
                media_type=_media_type(artifact),
                hashes=sha256_hash(artifact.sha256),
            )
        )

    return resource(
        artifact_resource_uuid(ctx.vendor_id, artifact.id),
        artifact.title or artifact.type,
        description=description,
        props=props,
        rlinks=rlinks or None,
    )


def _media_type(artifact: ArtifactRecord) -> str:
    fmt = (artifact.format or "").lower()
    if "cyclonedx" in fmt or "spdx" in fmt or fmt.endswith("json"):
        return "application/json"
    if fmt in ("csv",):
        return "text/csv"
    return "application/pdf"


def back_matter(ctx: OscalContext, *, extra: list[dict] | None = None) -> dict:
    """The full back-matter block: every artifact, plus the network's own
    verification endpoints so a consumer can re-check the mark and signature."""
    resources = [artifact_resource(ctx, a) for a in ctx.artifacts]
    resources.append(
        resource(
            derive_uuid(ctx.vendor_id, "resource", "signing-key"),
            "TrustMCP network signing key",
            description=(
                "Ed25519 public key the network signs manifest and attestation "
                "responses with. Verify signed pulls against it."
            ),
            props=[prop("type", "verification", ns=None)],
            rlinks=[rlink(f"{ctx.network_url}/v1/network/key", media_type="application/json")],
        )
    )
    resources.append(
        resource(
            derive_uuid(ctx.vendor_id, "resource", "mark"),
            "TrustMCP agent-ready mark",
            description=(
                f"Live mark status for {ctx.legal_name}. Current value: {ctx.mark_status}."
            ),
            props=[prop("type", "verification", ns=None), prop("trustmcp-mark", ctx.mark_status)],
            rlinks=[
                rlink(f"{ctx.network_url}/v1/mark/{ctx.vendor_id}", media_type="application/json")
            ],
        )
    )
    if extra:
        resources.extend(extra)
    return {"resources": resources}
