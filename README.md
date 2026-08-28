# TrustMCP

![CI](https://github.com/coverbasedev/trustmcp/actions/workflows/ci.yml/badge.svg)
![Spec & SDK: Apache-2.0](https://img.shields.io/badge/spec%20%26%20SDK-Apache--2.0-blue)
![Apps: FSL-1.1-ALv2](https://img.shields.io/badge/apps-FSL--1.1--ALv2-4f46e5)
![TrustMCP v0.1](https://img.shields.io/badge/TrustMCP-v0.1-4f46e5)

**An agent-first, open trust-center standard — plus a reference network, trust-center
builder, and MCP server.**

TrustMCP moves third-party risk from a **request model** to a **publish model**. A vendor
publishes its assurance evidence **once**, machine-readably, and grants **scoped,
revocable** access. Each customer assesses on its own terms against its own control
framework — no questionnaire. The network standardizes **access to the evidence, never
the verdict**.

> Why it works: instead of stale, one-size verdicts, TrustMCP shares the raw, current
> data and lets each customer compute its own answer.

The standard is **Apache-2.0** and is not a product of any single company; the reference
apps are **Functional Source License** (see [Licensing](#licensing)).

## The five objects

**Assurance Profile** (everything a vendor publishes) · **Manifest** (the index) ·
**Artifact** (a document: SOC 2, pentest, ISO, COI, SBOM, DPA…) · **Attestation** (a
machine-readable claim linked to its evidence) · **Access Key** (scoped, revocable).

See [`spec/trustmcp-v0.1.md`](spec/trustmcp-v0.1.md) and [`spec/schemas`](spec/schemas).

## Governance: low-barrier *verified*

TrustMCP is open and free, with a thin trust floor. The network is a **trust anchor, not a
rating agency**: it verifies **domain ownership**, issues/validates the
**`agent-ready` mark**, mints/validates **keys**, logs reads, and tracks **freshness**.
It never scores a vendor. This is the answer to *"otherwise vendors just sign any BS"*:
TrustMCP verifies *identity and custody of the mark*; customers verify the *content*
themselves. See [`governance/`](governance).

## Monorepo layout

| Path | What |
|------|------|
| [`spec/`](spec) | The TrustMCP v0.1 spec, JSON Schemas, and the Acme example |
| [`packages/trustmcp-spec`](packages/trustmcp-spec) | Shared zod schemas + types (canonical TS mirror) |
| [`packages/trustmcp-sdk`](packages/trustmcp-sdk) | TypeScript client for the network |
| [`apps/network`](apps/network) | **Python/FastAPI** reference network (thin trust anchor) |
| [`apps/web`](apps/web) | **Next.js** app: OAuth + custom-branded Trust Center builder + public pages + directory |
| [`apps/docs`](apps/docs) | **Next.js + MDX** public documentation site (served at `docs.<domain>`) |
| [`mcp/python`](mcp/python) | **Python MCP server** + end-to-end assessment demo |
| [`render.yaml`](render.yaml) | **Render Blueprint**: one-click deploy of network + web + docs + Postgres |
| [`governance/`](governance) | Charter, mark policy, membership, neutrality (drafts) |
| [`docs/`](docs) | API reference, vendor + GRC guides, auth setup, public/private docs, CRM verification, founding one-pager, ecosystem |

## Deploying

TrustMCP deploys to **[Render](https://render.com)** from the committed
[`render.yaml`](render.yaml) Blueprint. The full guide — including the non-coding setup
(domains `trustmcp.app` / `trustmcp.org`, OAuth, email, DNS) — is in
**[DEPLOY.md](DEPLOY.md)**.

## Quick start (local)

### Everything via Docker

```bash
docker compose up --build
docker compose exec network python -m app.seed all   # seed Acme + Chime Enterprise
# web:     http://localhost:3000
# network: http://localhost:8000/docs
# public:  http://localhost:3000/trust/vnd_acme  (and /trust/vnd_chime)
```

### Or piece by piece

```bash
# 1) Network API
cd apps/network && uv venv .venv && uv pip install --python .venv -e ".[dev]"
.venv/bin/python -m app.seed
.venv/bin/uvicorn app.main:app --port 8000

# 2) MCP assessment demo (uses the seed's Globex key)
cd ../../mcp/python && uv venv .venv && uv pip install --python .venv -e ".[dev]"
TRUSTMCP_NETWORK=http://localhost:8000 TRUSTMCP_KEYS='{"vnd_acme":"tmcp_live_..."}' \
  python demo_assessment.py vnd_acme

# 3) Web (needs Postgres; see apps/web/.env.example)
pnpm install && pnpm --filter @trustmcp/web db:push && pnpm --filter @trustmcp/web dev
```

## The assessment loop (what an agent does)

`discover_vendor` → `verify_mark` → `request_access` → `get_manifest` →
`get_attestations` (map to your controls) → `check_freshness` → `fetch_artifact`
(verify sha256) → **decide locally**. The vendor published once; the customer assessed
in a handful of tool calls instead of a multi-week questionnaire cycle.

## OSCAL

TrustMCP speaks [NIST OSCAL](https://pages.nist.gov/OSCAL) end to end, so a trust center
drops straight into OSCAL-based GRC tooling.

- **Every model** — `catalog`, `profile`, `component-definition`, `system-security-plan`,
  `assessment-plan`, `assessment-results`, `plan-of-action-and-milestones` — in **JSON,
  YAML, and XML**, Ed25519-signed over the exact bytes returned.
- **Point-in-time**: `GET /v1/vendors/{vid}/oscal/{model}`, or `/oscal/bundle` for all of
  them with a content digest each.
- **Continuous**: a gapless per-vendor change cursor (`/oscal/changes`), an SSE stream, and
  HMAC-signed webhook subscriptions. Each change names the models it invalidates, so a
  consumer re-pulls only what moved.
- **Both directions**: `POST /oscal/import` populates a trust center from an OSCAL document
  a vendor's GRC platform already holds — a dry run by default.
- **Deterministic**: identifiers are derived from stable logical paths, so unchanged
  evidence re-exports byte-identically and digests are a reliable diff.

See [OSCAL](https://docs.trustmcp.app/customers/oscal) and
[Continuous OSCAL](https://docs.trustmcp.app/customers/oscal-continuous).

## Keeping evidence current

Link a **Google Drive folder** and the latest version of each document flows into the trust
center — with a review queue, glob-based classification rules, and per-resource
presentation controls, so nothing publishes without the owner's decision. See
[Google Drive sync](https://docs.trustmcp.app/vendors/google-drive).

## Tests

```bash
pnpm --filter @trustmcp/spec test          # schema/type tests
cd apps/network && .venv/bin/pytest   # network API (publish→grant→read→revoke, verification)
cd mcp/python && .venv/bin/pytest     # end-to-end assessment loop against the network
pnpm --filter @trustmcp/web build          # web typecheck + build
```

## Licensing

TrustMCP uses two licenses, chosen so the standard stays open while the project stays
sustainable:

- **Apache-2.0** — everything you need to *implement or consume the standard*: the spec
  and JSON Schemas ([`spec/`](spec)), the TypeScript schemas and SDK
  ([`packages/`](packages)), the MCP server ([`mcp/`](mcp)), and the conformance suite
  ([`conformance/`](conformance)). Any tool or company can build on these, commercially
  or otherwise, forever.
- **[FSL-1.1-ALv2](LICENSE)** (Functional Source License) — the reference applications:
  the network ([`apps/network`](apps/network)), the trust-center builder
  ([`apps/web`](apps/web)), and the docs site ([`apps/docs`](apps/docs)). You can read,
  use, self-host, modify, and contribute freely; the only thing you can't do is resell
  the apps as a competing commercial product. Each version automatically converts to
  **Apache-2.0 two years** after its release, so nothing is locked away for good.

Directories with their own `LICENSE` file are governed by that file; everything else
falls under the root [`LICENSE`](LICENSE) (FSL-1.1-ALv2).

## Status

v0.x, pre-stability. **TrustMCP** is the project name; the standard is governed openly
(see [`governance/`](governance)). Legal/governance files are non-binding drafts pending
counsel.
