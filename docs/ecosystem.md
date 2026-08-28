# Ecosystem & adjacent work

Where TrustMCP sits relative to existing trust-center and GRC tooling.

## Trust centers (Vanta, Drata, SafeBase, …)

These let a vendor host documents and gate them behind a request/NDA flow — usually
human-to-human, product-specific, and not machine-readable. TrustMCP is the **open,
agent-readable layer** over the same idea: publish once, grant scoped/revocable access,
and let any tool read it. A vendor that already runs one of these can publish to TrustMCP
incrementally and gain the agent-ready story without abandoning its current portal.

## Why this approach is different

Older pooled-assessment networks shipped **one-size verdicts** that went stale. TrustMCP
deliberately ships **raw, current evidence** and keeps the verdict with the customer.
That's the bet on why a consortium can work this time.

## GRC engineering (Corsair / grcengineering)

Corsair and the "GRC engineering" movement bring infra-as-code discipline to controls
and evidence — powerful, but oriented to engineers more than to the average GRC/TPRM
practitioner. It's **complementary**: a Corsair-style control/evidence feed could be
published as an TrustMCP artifact type (e.g. `policy`, `architecture`, or a future
`controls_export`) and consumed by an assessment agent alongside SOC 2 and pentests.
TrustMCP doesn't compete with how evidence is *produced*; it standardizes how it's
*accessed*.

## Model Context Protocol (MCP)

TrustMCP ships a reference MCP server so any agent platform (Claude and others) gets
a single connector for third-party assessment. MCP is the agent transport; TrustMCP is the
domain standard it carries.

## SBOM / VEX, OSCAL

- **SBOM** (CycloneDX/SPDX) is a first-class artifact type.
- **OSCAL** (NIST's control/assessment XML/JSON) is a candidate future mapping target
  for attestations → controls; TrustMCP's claim keys are intentionally simpler for v0 but
  could carry OSCAL references in evidence.
