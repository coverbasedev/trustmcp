# Changelog

All notable changes to TrustMCP are documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/) loosely; the spec uses its own
`schema_version` (currently `0.1`).

## [Unreleased]

### Changed
- **Licensing.** The spec, JSON Schemas, SDK, MCP server, and conformance suite are
  Apache-2.0; the reference apps (`apps/network`, `apps/web`, `apps/docs`) are now
  FSL-1.1-ALv2, with each release converting to Apache-2.0 after two years. See the
  Licensing section of the README.
- **Neutral branding.** Company-specific names and example domains were removed from
  code, tests, and docs; the project is community-governed (see `governance/`).

### Added
- **One-click Google Drive connect.** With a network-level Google OAuth client
  (`TRUSTMCP_GOOGLE_CLIENT_ID` / `_SECRET`), a trust-center owner presses **Connect Google
  Drive**, approves read-only access at Google, and picks a folder from a browsable list —
  no service-account JSON, client secret, or folder id to paste. The refresh token is
  exchanged and stored server-side and never reaches the browser; the `state` carried
  through consent is HMAC-signed and expiring, so a code obtained for one trust center
  cannot be attached to another. A connection between consent and folder selection sits at
  `pending_folder`, holding credentials and syncing nothing; re-authorizing later keeps the
  folder already chosen. Networks without a configured client keep the existing
  paste-your-own-credentials path and say why the button is absent.
- **Full OSCAL exchange, point-in-time and continuous.** TrustMCP now speaks every
  [NIST OSCAL](https://pages.nist.gov/OSCAL) model — `catalog`, `profile`,
  `component-definition`, `system-security-plan`, `assessment-plan`, `assessment-results`,
  and `plan-of-action-and-milestones` — in JSON, YAML, and XML, under
  `/v1/vendors/{vid}/oscal/{model}` plus a `/bundle` that returns them all with a content
  digest each. Exports are **deterministic**: identifiers are derived (UUIDv5) from stable
  logical paths, so unchanged evidence re-exports byte-identically and consumers can diff
  digests instead of re-parsing documents. Responses are Ed25519-signed over the exact
  bytes returned, in whichever format was requested.
- **Continuous OSCAL** via a per-vendor, gapless change log: cursor polling
  (`/oscal/changes`), a server-sent-event stream (`/oscal/stream`, honoring
  `Last-Event-ID`), and HMAC-signed webhook subscriptions (`/oscal/subscriptions`, bound to
  the access key that created them so revoking the key stops delivery). Every change names
  the OSCAL models it invalidates, so a subscriber re-pulls only what moved.
- **OSCAL import**: `POST /v1/vendors/{vid}/oscal/import` populates a trust center from an
  OSCAL document — a dry run by default, with `merge`/`replace` modes. Documents TrustMCP
  produced round-trip exactly; documents from other tools have claims inferred from
  implemented control coverage and labeled as such. Evidence references are recorded,
  never fetched.
- **OSCAL validation** (`POST /v1/oscal/validate`, public) and a capability descriptor
  (`GET /v1/oscal/capabilities`) so consumers negotiate rather than guess.
- **Google Drive folder sync**: link a Drive folder (service account or OAuth, read-only)
  and the latest version of each document flows into the trust center. Discovery and
  publication are separate — new files land in a review queue, and nothing publishes
  without the owner's decision unless it matched an explicit auto-publish rule. Glob-based
  classification rules propose type, category, visibility, and title (first match wins);
  a preview endpoint shows their effect before saving. A new Drive revision becomes a new
  artifact *version*, an excluded file stays excluded across syncs, and a file deleted from
  Drive is marked missing rather than silently unpublished.
- **Resource presentation controls**: per-resource description, position, featured, and
  hidden, plus page-level layout (list/grid/table), grouping (category/type/product/none),
  category order, and which fields are shown. Hiding a resource is distinct from making it
  private — it changes the listing, not the entitlement. Descriptions flow through to the
  OSCAL back-matter.
- **New MCP tools** for the whole OSCAL surface, including `poll_oscal_for_changes`, which
  checks the feed and re-pulls only the models that actually moved.
- **Full-featured public Trust Center** (Vanta-parity): tabbed public page (Overview /
  Resources / Controls / Subprocessors / FAQ / Updates) with a compliance-badge wall,
  controls grid grouped by category, "data collected" list, categorized resources with
  lock icons, FAQ accordion, and an updates feed. Builder pages to manage each section.
- **Public engagement flows**: "Ask a question" AI assistant grounded in the published
  profile (Anthropic API, configurable model, graceful no-op when unconfigured),
  Subscribe-to-updates, richer Request-access (first/last name, company, reason, and
  full vs. limited per-resource access selection), Reclaim-access (email re-issues a
  scoped key), and a self-service DPA / agreement form with an inline document viewer.
- **Live e-signature for DPAs**: submitted agreements are sent to **Docusign** (JWT-grant
  impersonation, template-based envelopes prefilled with the signer's details); status
  syncs back via a Docusign Connect webhook (`/v1/esign/webhook`). Owners can (re)send
  from the dashboard. Falls back to capture-and-notify when Docusign isn't configured.
- **Subscriber notifications**: publishing a new update emails every active subscriber
  (idempotent — editing an existing update doesn't re-notify).
- **Mark revocation**: operator (service-token) `mark/revoke` + `mark/reinstate`, owner
  `DELETE /domains/{domain}` with mark recomputation, and sticky `revoked` state that
  survives re-verification. The mark endpoint now returns `revoked`.
- **Scheduled freshness nudges**: a Render cron runs `app.notify_expiring` daily;
  emails are idempotent per expiry window via `Artifact.expiry_notified_at`.
- **Subprocessor logos + category** (e.g. "Core Product") on the public page — logos use
  an explicit URL or fall back to the domain favicon; and a **"Updated X ago"** signal on
  the Controls section (tracked via `controls_updated_at`). Subscribe modal links the
  privacy policy.
- Spec v0.1, JSON Schemas, `@trustmcp/spec` (zod) and `@trustmcp/sdk` (TypeScript) packages.
- TrustMCP Network (FastAPI): domain verification + `agent-ready` mark, scoped/revocable
  access keys, per-artifact scopes, audit log + CSV/JSON export, freshness + expiry
  nudges, public/private documents, auto-release (domain allowlist / CRM / contract),
  NDA gate, Ed25519-signed manifest/attestations, vendor webhooks, framework mapping,
  OSCAL export, nth-party subprocessor graph, usage insights, approval recommendations,
  public directory, per-vendor CRM credentials, and an in-app approval agent.
- Trust Center web app (Next.js + Auth.js): OAuth + email magic-link + enterprise SSO
  (OIDC), custom-branded builder, teams & roles, artifact versioning, guided setup,
  Home/Requests/Insights/Connections IA.
- MCP server (Python) with the full read/assess tool surface + signature verification.
- Render Blueprint (`render.yaml`) deployment, GitHub Actions CI/CD, docker-compose,
  public docs site.
- Alembic migrations for the network; conformance test suite; per-download PDF
  watermarking; repo hygiene + publish workflows.

### Hardened
- **Fail-fast production config**: the network refuses to boot in `production` without a
  strong service token, a stable Ed25519 signing key, and a Postgres database; logs
  warnings for soft degradations (local storage, no SMTP, in-memory rate limiting).
- **Webhook delivery** now retries with bounded exponential backoff (5xx/408/429),
  treating other 4xx as permanent.
- **Rate limiting** extended to the public read endpoints (directory, public profile,
  public artifact, mark, files) plus the new engagement endpoints.
- `init_db()` only creates tables on sqlite; Postgres schema is owned by Alembic
  (avoids `create_all` desyncing `alembic_version`).
- Watermark blobs use a deterministic per-requester/day key (bounded storage growth).
- Domain-control `.well-known` checks no longer follow redirects; CRM domain inputs are
  sanitized before query interpolation.
- Friendlier UX: copyable team-invite links when SMTP is unset; a clear error banner when
  creating a trust center without the network service token configured.

### Removed
- Dead `apps/web/src/lib/crm.ts` (CRM checks run server-side in the network).

[Unreleased]: https://github.com/coverbasedev/trustmcp
