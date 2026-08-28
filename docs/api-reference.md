# TrustMCP Network — API Reference (v1)

Base URL: `https://network.trustmcp.app` (or your operator / `http://localhost:8000`).

Interactive docs (FastAPI): `/docs`.

## Auth tiers

| Header | Who | Used for |
|--------|-----|----------|
| `X-TrustMCP-Service-Token: <token>` | the web backend | creating vendors on behalf of users |
| `X-TrustMCP-Owner-Token: <token>` | a vendor | managing its own trust center |
| `Authorization: Bearer tmcp_live_…` | a customer | reading a profile (scoped) |

Tokens and keys are shown **once** at creation/grant and stored only as hashes.

## Consumer (read) endpoints

All require a bearer access key with the right scope.

| Method | Path | Scope | Returns |
|--------|------|-------|---------|
| GET | `/v1/vendors/{vid}/manifest` | `manifest` | Manifest (artifact index) |
| GET | `/v1/vendors/{vid}/attestations` | `attestations` | Structured claims |
| GET | `/v1/vendors/{vid}/subprocessors` | `attestations` | Subprocessor list |
| GET | `/v1/vendors/{vid}/freshness` | `manifest` | `valid`/`expiring`/`expired` per artifact |
| GET | `/v1/vendors/{vid}/artifacts/{aid}` | `artifacts` | `{ url, sha256, version, expires_in }` (current version) |
| GET | `/v1/vendors/{vid}/artifacts/{aid}/versions` | `artifacts` | Version history (metadata) |
| GET | `/v1/vendors/{vid}/artifacts/{aid}/versions/{n}` | `artifacts` | Signed URL for a specific version |
| GET | `/v1/vendors/{vid}/attestations/mapped?framework=` | `attestations` | Claims mapped to a control framework |
| GET | `/v1/vendors/{vid}/graph` | `attestations` | nth-party subprocessor graph (linked vendors) |
| GET | `/v1/vendors/{vid}/attestations/oscal?framework=` | `attestations` | OSCAL component-definition export (original path; see the OSCAL section below) |

### OSCAL (consumer)

Every model, in `?format=json|yaml|xml`. Responses carry `X-TrustMCP-Signature` over the
exact bytes returned, plus `X-TrustMCP-OSCAL-Version` and `X-TrustMCP-OSCAL-Digest`.

| Method | Path | Scope | Returns |
|--------|------|-------|---------|
| GET | `/v1/vendors/{vid}/oscal/{model}` | `attestations` | One OSCAL model. `model` is `component-definition`, `system-security-plan`, `assessment-plan`, `assessment-results`, `plan-of-action-and-milestones`, or an alias (`cdef`, `ssp`, `ap`, `ar`, `poam`). `?framework=` accepts a comma-separated list |
| GET | `/v1/vendors/{vid}/oscal/bundle` | `attestations` | Every model, a content digest per document, and the current change cursor |
| GET | `/v1/vendors/{vid}/oscal/changes?since=&limit=&models=` | `attestations` | Changes after a cursor, each naming the models it invalidates |
| GET | `/v1/vendors/{vid}/oscal/stream?since=` | `attestations` | Server-sent events over the change log (honors `Last-Event-ID`) |
| GET | `/v1/vendors/{vid}/oscal/subscriptions` | `attestations` | Your own change subscriptions (scoped to the calling key) |
| POST | `/v1/vendors/{vid}/oscal/subscriptions` | `attestations` | Register an HTTPS webhook: `{url, secret?, models?}`. Bound to the calling key |
| DELETE | `/v1/vendors/{vid}/oscal/subscriptions/{sid}` | `attestations` | Cancel a subscription |

Exports are deterministic: unchanged evidence re-exports byte-identically, with stable
(UUIDv5) identifiers, so digests are a reliable "did anything move" check.

`manifest` and `attestations` responses are signed: `X-TrustMCP-Signature` (Ed25519) +
`X-TrustMCP-Key-Id`. Verify against `GET /v1/network/key`.

Always verify the downloaded bytes against `sha256` before trusting an artifact.

## Public endpoints (no auth)

| Method | Path | Returns |
|--------|------|---------|
| GET | `/v1/mark/{vid}` | Mark status + verified domains |
| GET | `/v1/network/key` | Network Ed25519 public key (verify signed responses) |
| GET | `/v1/frameworks` | Control frameworks available for claim mapping |
| GET | `/v1/oscal/capabilities` | Every OSCAL model, format, alias, framework, and endpoint this deployment supports |
| GET | `/v1/oscal/catalog` | The TrustMCP claim vocabulary as an OSCAL catalog |
| GET | `/v1/oscal/profile/{framework}` | The baseline of framework controls TrustMCP evidence addresses |
| POST | `/v1/oscal/validate` | Validate an OSCAL document's structure (root model, metadata, UUIDs, internal references) |
| GET | `/v1/directory` | Public list of published, opt-in agent-ready vendors |
| GET | `/v1/vendors/{vid}/public` | Trust-center summary (branding, artifacts w/ category, badges, controls, data types, subprocessors, FAQ, updates, claim keys, `ask_enabled`, `dpa_self_serve`) — only after publish, no content/URLs |
| GET | `/v1/vendors/{vid}/artifacts/{aid}/public` | Download a **public** artifact (signed URL + content type), no key |
| POST | `/v1/keys/request` | Create an access request (optional `artifact_ids` for limited access, `company`, `reason`; may be auto-granted) |
| POST | `/v1/keys/request-with-contract` | Multipart request with a contract; auto-granted if the vendor enabled contract release |
| POST | `/v1/vendors/{vid}/subscribe` | Subscribe an email to trust-center updates (idempotent) |
| POST | `/v1/vendors/{vid}/ask` | Ask the AI assistant a question grounded in the published profile |
| POST | `/v1/vendors/{vid}/reclaim` | Reclaim access by email — re-issues a scoped key to a previously-granted address |
| POST | `/v1/vendors/{vid}/agreements` | Submit a self-service DPA/agreement (requires `dpa_self_serve`); auto-sent to Docusign when configured |
| POST | `/v1/esign/webhook` | Docusign Connect status callback (syncs envelope → agreement status; optional HMAC) |

### Auto-release

`POST /v1/keys/request` returns `{status:"granted", key, ...}` immediately when the
request matches any vendor policy: a preconfigured **domain allowlist**, a **CRM** match
(HubSpot/Salesforce), or an uploaded **contract** (contract endpoint). Otherwise it
returns `{status:"pending"}` and the owner approves manually.

`POST /v1/keys/request`:
```json
{ "vendor_id": "vnd_acme",
  "requester": { "name": "Globex Inc", "domain": "globex.com", "contact": "trust@globex.com" },
  "scope": ["manifest", "attestations", "artifacts"] }
```

## Owner endpoints (vendor management)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/vendors/{vid}` | Vendor + branding + mark + publish state |
| PUT | `/v1/vendors/{vid}/profile` | Update legal name, product, domains, branding |
| POST | `/v1/vendors/{vid}/publish` | Publish the profile |
| GET/POST | `/v1/vendors/{vid}/artifacts` | List / create artifact metadata |
| POST | `/v1/vendors/{vid}/artifacts/{aid}/content` | Upload file (multipart, optional `note`) → archives prior version, records sha256, bumps version |
| GET | `/v1/vendors/{vid}/manage/artifacts/{aid}/versions` | Owner version history |
| DELETE | `/v1/vendors/{vid}/artifacts/{aid}` | Delete artifact |
| GET/PUT | `/v1/vendors/{vid}/manage/attestations`, `…/attestations` | Read / replace claims |
| GET/PUT | `/v1/vendors/{vid}/manage/subprocessors`, `…/subprocessors` | Read / replace subprocessors |
| PATCH | `/v1/vendors/{vid}/artifacts/{aid}` | Update artifact metadata (title/type/format/dates/scope/category/access) and public presentation (description/position/featured/hidden) |
| DELETE | `/v1/vendors/{vid}` | Delete the vendor and all dependent records (offboarding) |
| GET/PUT | `…/manage/badges`, `…/badges` | Read / replace compliance badges |
| GET/PUT | `…/manage/controls`, `…/controls` | Read / replace controls |
| GET/PUT | `…/manage/data-types`, `…/data-types` | Read / replace "data collected" list |
| GET/PUT | `…/manage/faqs`, `…/faqs` | Read / replace FAQ entries |
| GET/PUT | `…/manage/updates`, `…/updates` | Read / replace the updates feed |
| GET | `/v1/vendors/{vid}/subscribers` | List update subscribers |
| GET | `/v1/vendors/{vid}/agreements` | List submitted DPA/agreement requests |
| POST | `/v1/vendors/{vid}/agreements/{aid}/send` | (Re)send a DPA to Docusign for signature |
| GET/POST | `/v1/vendors/{vid}/domains` | List / add domain (returns challenge) |
| POST | `/v1/vendors/{vid}/domains/{domain}/verify` | Verify domain → grant mark (unless revoked) |
| DELETE | `/v1/vendors/{vid}/domains/{domain}` | Remove a domain; recomputes the mark |
| GET | `/v1/vendors/{vid}/keys/requests` | List access requests |
| POST | `/v1/vendors/{vid}/keys/requests/{rid}/approve` | Mint a scoped key (returned once) |
| POST | `/v1/vendors/{vid}/keys/requests/{rid}/deny` | Deny a request |
| GET | `/v1/vendors/{vid}/keys` | List issued keys |
| POST | `/v1/vendors/{vid}/keys/{kid}/revoke` | Revoke a key |
| POST | `…/keys/requests/{rid}/approve` | Approve; body may set `scope`, `ttl_days`, `artifact_ids` (per-artifact restriction) |
| GET | `…/keys/requests/{rid}/contract` | Download a requester-uploaded contract |
| GET | `/v1/vendors/{vid}/audit` | Audit log (JSON) |
| GET | `/v1/vendors/{vid}/audit.csv` | Audit log (CSV export) |
| GET | `/v1/vendors/{vid}/insights` | Usage analytics (funnel, keys, reads) |
| GET | `/v1/vendors/{vid}/manage/resource-display` | Public resource layout settings + the categories in use |
| PUT | `/v1/vendors/{vid}/resource-display` | Set layout, grouping, category order, and which fields show |
| PUT | `/v1/vendors/{vid}/artifacts/presentation` | Reorder / re-label several resources in one request |
| POST | `/v1/vendors/{vid}/oscal/import` | Populate the trust center from an OSCAL document. Dry run unless `"apply": true`; `"mode": "merge"\|"replace"` |

### Google Drive sync (owner)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/vendors/{vid}/integrations/drive` | Connection status, sync summary, and queue counts |
| POST | `/v1/vendors/{vid}/integrations/drive` | Link a folder (OAuth refresh token or service-account key). Credentials are write-only |
| PATCH | `/v1/vendors/{vid}/integrations/drive` | Sync mode, recursion, auto-publish, defaults, classification rules |
| DELETE | `/v1/vendors/{vid}/integrations/drive?purge=` | Unlink. Published documents stay unless `purge=true` |
| POST | `/v1/vendors/{vid}/integrations/drive/sync` | Sync now; returns what was discovered, queued, published, and versioned |
| GET | `/v1/vendors/{vid}/integrations/drive/files?decision=` | The review queue (`pending`/`included`/`excluded`) |
| POST | `…/drive/files/{id}/decision` | Include (publishes) or exclude one file, with its classification and presentation |
| POST | `…/drive/files/decisions` | Bulk **exclusion** only — inclusion stays a per-file decision |
| POST | `…/drive/rules/preview` | What a rule set would do to the files already discovered |
| GET | `…/drive/rules/reference` | The vocabulary available when writing rules |
| GET | `…/drive/oauth/start` | Google consent URL built from the network's own OAuth client, with a signed `state` |
| POST | `…/drive/oauth/exchange` | Trade the code for tokens and store them; connection lands at `pending_folder` |
| GET | `…/drive/folders?parent=` | Browse folders and shared drives, for the picker |
| POST | `…/drive/folder` | Choose the folder to sync, completing the connection |

A sync never publishes a file the owner has not approved, unless the connection has
`auto_publish` **and** the file matched an explicit `include` rule. Excluded files stay
excluded across syncs, and a file deleted from Drive is marked missing rather than
unpublished.

Pending requests in `GET …/keys/requests` carry a `recommendation` (`approve`/`review`/`caution` + reasons).

Profile (`PUT …/profile`) also accepts: `notify_email`, `notify_on_request`, `listed`,
`auto_approve_domains`, `auto_approve_crm`, `auto_approve_on_contract`, `nda_required`,
`nda_text`, `dpa_self_serve`, `dpa_intro`, `webhook_url`, `webhook_secret`.

Webhooks fire on `key.requested|granted|denied|revoked` with `X-TrustMCP-Signature:
sha256=<HMAC>` over the body. Delivery retries with bounded backoff on 5xx/408/429.

## Service (operator) endpoints

The service token is the network operating as a trust anchor.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/vendors` | Create a vendor; returns `owner_token` once |
| POST | `/v1/vendors/{vid}/mark/revoke` | Suppress the mark for abuse (sticky `revoked`); optional `{reason}` |
| POST | `/v1/vendors/{vid}/mark/reinstate` | Lift a revocation; recomputes from verified domains |

## Errors

Standard HTTP codes. `401` (bad/missing credential), `403` (wrong vendor, missing
scope, expired/revoked key), `404` (not found / not published), `409` (e.g. fetching
an artifact with no uploaded content).
