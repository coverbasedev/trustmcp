# MCP Audit

TrustMCP's MCP Audit scans an MCP server for **integration risk** and produces a
standardized **risk scorecard**. It exists because an API is self-describing — you
know the fields, formats, and schemas you exchange before wiring it in — while an
MCP server is not, and agents lean on exactly that open-endedness. The audit turns
an opaque tool surface into something you can reason about before you trust it.

- Public entry: **`/audit`** (explainer + start a scan).
- Authenticated console: **`/audit/scans`**, `/audit/new`, `/audit/settings`.
- Vendors publish their own server's scorecard to a trust center:
  `/tc/<vendorId>/mcp-audits` → public page at `/trust/<vendorId>/audit/<slug>`.

## What a scan does

The engine ([`apps/web/src/lib/mcp-audit/engine.ts`](../apps/web/src/lib/mcp-audit/engine.ts))
runs a pipeline, persisting progress after each phase so the UI can poll:

1. **Inspect** — read-only MCP handshake; enumerate tools, resources, and prompts.
2. **Classify** — deterministic classification of every tool as
   read / write / destructive / outward / execute, plus the data classes it can
   touch and whether its description looks like *tool poisoning*.
3. **Research** — the model researches the vendor behind the server, using your
   intended-use context.
4. **Probe** — the model generates **dynamic**, server-specific probes (every
   server differs, so probes are fuzzed for this one). **Read-only probes are run
   live; anything that could change state is a recommendation only and is never
   auto-executed** — a double gate requires both the model and the heuristic to
   agree a tool is read-only before it is ever called.
5. **Controls** — evaluate the built-in static controls plus your org's custom
   clauses.
6. **Score** — synthesize the scorecard across the risk taxonomy, tailored to each
   integration point you described.
7. **Evidence** — package a content-hashed evidence bundle and, if configured,
   attest it with [Corsair](#corsair-evidence).

## The risk taxonomy

Every scan scores twelve dimensions
([`taxonomy.ts`](../apps/web/src/lib/mcp-audit/taxonomy.ts)), each 0–100 (higher =
more risk) with a rationale, so scorecards are comparable across servers even
though the findings are always server-specific:

| Dimension | What it measures |
|-----------|------------------|
| Data exposure | Data classes and sensitivity flowing through the server |
| Privacy & personal data | Personal-data processing and end-user exposure |
| Agency & autonomy | How much the server can *do* — write, send, pay, delete |
| Operational reliability | Availability, maturity, failure behavior |
| Business criticality | How central the workflow is; cost of misbehavior |
| Financial exposure | Payments, spend, fraud, runaway cost |
| Compliance & regulatory | Regulated data and triggered obligations |
| Security posture | Auth, transport, tenancy, injection resistance |
| Supply chain & nth-party | Downstream services and inherited risk |
| Reputational impact | Brand cost of a public failure |
| Liability & end-user impact | Legal exposure when actions reach end users |
| Governance & transparency | Docs, provenance, revocability, audit trail |

The scorecard structure is fixed; the contents are always server-specific. It
includes an executive summary, a **security model** and **threat model** written
for your intended use, per-dimension safe/unsafe factors, findings, per-integration
analysis, and what to audit / watch for.

## Bring your own model

Scans run on **your** LLM credentials, added under `/audit/settings` and stored
encrypted at rest. OpenAI and Anthropic are supported; pick from each provider's
model catalog (or supply a model id directly). Keys are used only server-side and
are never returned to the browser.

## Custom clauses

Beyond the built-in controls, encode reusable policy checks as **clauses** (e.g.
"no production-data deletion without confirmation"). Clauses are merged into every
scan in your workspace and evaluated the same way as the static controls.

## The MCP interaction layer

A completed audit can be interrogated — from the report UI, or through the TrustMCP
MCP server ([`mcp/python`](../mcp/python)):

- `list_risk_dimensions` — the risk taxonomy nomenclature.
- `inspect_mcp_server(url, bearer?, intended_use?)` — live read-only inspection:
  classified tool inventory, aggregated risk signals, and dynamic probes. Never
  calls a tool.
- `generate_audit_probes(url, ...)` — dynamic probes for a server without scoring.
- `get_mcp_audit(vendor_id, slug)` — read a published scorecard.

The heavier LLM synthesis lives in the web app (which holds your model
credentials); the MCP server exposes the deterministic core an agent can drive
directly. Both share one classifier
([`classify.ts`](../apps/web/src/lib/mcp-audit/classify.ts) ↔
[`mcp_audit.py`](../mcp/python/mcp_audit.py)).

## Corsair evidence

Each scan builds a content-addressed **evidence bundle** (the handshake, the tool
contract, and the transcript of every read-only probe actually run) and hashes it
with SHA-256. If `CORSAIR_URL` is set, the bundle is submitted to
[Corsair](https://github.com/) for an authentication proof so the scorecard is
independently verifiable; otherwise the bundle is hashed and stored locally,
un-attested.

## Configuration

| Env var | Purpose |
|---------|---------|
| `AUDIT_ENCRYPTION_KEY` | Encrypts stored LLM credentials (falls back to `AUTH_SECRET`). |
| `CORSAIR_URL` / `CORSAIR_TOKEN` | Optional Corsair endpoint for evidence attestation. |
| `TRUSTMCP_WEB` | Base URL the MCP server reads published scorecards from (default `https://trustmcp.app`). |

## Authorized use

Only scan MCP servers you are authorized to assess (your own, or one you are
integrating with the operator's consent). TrustMCP never invokes write or
destructive tools automatically — it inspects read-only and turns everything else
into recommendations for a human to run under their own authorization.
