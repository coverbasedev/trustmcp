# GRC / TPRM integration guide (consumer side)

This is the customer path: read a vendor's profile and run your own assessment. TrustMCP
standardizes **access to evidence** — you keep your own framework and reach your own
verdict.

## Two ways to read

### A. Over MCP (recommended for agents)

Run the TrustMCP MCP server (`mcp/python`) and point your agent at it. Tools:
`discover_vendor`, `request_access`, `get_manifest`, `get_attestations`,
`fetch_artifact`, `check_freshness`, `verify_mark`. See `mcp/python/README.md`.

### B. Over REST (for integrations)

Use the endpoints in `docs/api-reference.md` with a bearer access key.

### C. Over OSCAL (for GRC platforms)

If your platform already ingests [NIST OSCAL](https://pages.nist.gov/OSCAL), skip the
TrustMCP-native shapes entirely. Every model is served per vendor in JSON, YAML, or XML:

```
GET /v1/vendors/{vid}/oscal/component-definition
GET /v1/vendors/{vid}/oscal/system-security-plan
GET /v1/vendors/{vid}/oscal/assessment-results
GET /v1/vendors/{vid}/oscal/plan-of-action-and-milestones
GET /v1/vendors/{vid}/oscal/bundle            all of them, with a digest each
```

Start at `GET /v1/oscal/capabilities` (public) to see what a deployment supports. Exports
are deterministic, so an unchanged document re-exports byte-identically — store the digests
and re-parse only what moves.

For continuous monitoring, poll `GET /v1/vendors/{vid}/oscal/changes?since={cursor}` or
register a webhook at `POST /v1/vendors/{vid}/oscal/subscriptions`. Each change names the
OSCAL models it invalidated, so you re-pull the POA&M when a control lapses and ignore a
branding edit entirely.

Going the other way, a vendor whose GRC platform already holds an OSCAL
component-definition or SSP can import it with `POST /v1/vendors/{vid}/oscal/import` rather
than retyping claims.

## The assessment loop

1. **Discover** — resolve the vendor from a domain you already trust
   (`/.well-known/trustmcp.json`).
2. **Verify the mark** — `GET /v1/mark/{vid}`. Don't trust a self-asserted mark.
3. **Request access** — `POST /v1/keys/request`; the vendor approves and you get a
   scoped, expiring key.
4. **Manifest** — see what evidence exists.
5. **Attestations** — map each claim key to your own controls. *Two customers can map
   the same claims differently — that's expected.*
6. **Freshness** — only pull what you still need; flag `expiring`/`expired`.
7. **Fetch + verify** — for contested/high-risk controls, download the backing artifact
   and check the bytes against the manifest `sha256`.
8. **Decide locally** — produce your assessment in your own format. The verdict never
   goes back to the network.

## Mapping claims to a control framework

A minimal example (see `mcp/python/demo_assessment.py` for a runnable version):

| Your control | TrustMCP claim | Pass when |
|--------------|-----------|-----------|
| AC-2 MFA | `mfa.enforced` | `== true` |
| SC-28 Encryption at rest | `encryption.at_rest` | contains `AES` |
| SC-8 Encryption in transit | `encryption.in_transit` | contains `TLS` |
| IR-6 Breach notice | `breach_notification_hours` | `<= 72` |
| Data residency | `data_residency` | includes your required regions |

Unmapped or missing claims → route to human review or fall back to fetching the
artifact. The model is additive: start with claims, escalate to documents only where
it matters.

## Plugging into an existing GRC/TPRM platform

Any GRC/TPRM platform can consume TrustMCP as one evidence source feeding its existing
assessment engine. TrustMCP is the open transport; your platform keeps the logic and the
verdict. If your platform already exposes its own MCP surface for assessments, controls,
or findings, TrustMCP slots in alongside it as a standardized vendor-evidence feed.
