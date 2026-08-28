# Deploying TrustMCP

This is the end-to-end guide to take TrustMCP from the repo to a live, public deployment
on **[Render](https://render.com)** — including the **non-coding** parts (accounts,
domains, OAuth apps, DNS, email).

Everything is described by the committed [`render.yaml`](render.yaml) Blueprint, so the
core deploy is essentially: connect the repo, click **Apply**, set two secrets, attach
your domains.

> Time: ~20–40 min the first time (most of it DNS + image builds).
> Cost: roughly **$21–35/month** to start on Render — three `starter` web services
> (network, web, docs) at ~$7 each plus a `basic-256mb` Postgres. The `trustmcp.org`
> redirect is a free static site. Scale or trim plans later.

---

## 0. What you'll end up with

- `https://trustmcp.app` — the Trust Center web app (sign in, build trust centers).
- `https://network.trustmcp.app` — the TrustMCP Network API.
- `https://docs.trustmcp.app` — the public docs site.
- `https://trustmcp.org` — **301-redirects to `https://trustmcp.app`**.
- A seeded demo (Acme, and optionally Chime) you can show immediately.

The Blueprint provisions four services + one database:

| Render service     | What                         | Custom domain(s)                  |
|--------------------|------------------------------|-----------------------------------|
| `trustmcp-web`     | Next.js Trust Center app      | `trustmcp.app`, `www.trustmcp.app`|
| `trustmcp-network` | FastAPI reference network     | `network.trustmcp.app`            |
| `trustmcp-docs`    | Next.js + MDX docs            | `docs.trustmcp.app`               |
| `trustmcp-org`     | static redirect → `.app`      | `trustmcp.org`, `www.trustmcp.org`|
| `trustmcp-db`      | Managed Postgres 16           | —                                 |

---

## 1. Prerequisites

| You need | Why | Notes |
|----------|-----|-------|
| **Render account** | Hosts everything | Free to create; you pay per service/plan. |
| **GitHub repo** | Source + auto-deploy | You already have `trustmcp/trustmcp`. |
| **The two domains** | Public URLs + the `agent-ready` mark | `trustmcp.app` and `trustmcp.org` (you own these). |
| *(optional)* Google + GitHub OAuth apps | Sign-in | Or use the email sign-in link / enterprise SSO. |
| *(optional)* An email sender | Email sign-in link + notifications | Resend, Postmark, Mailgun, SES, etc. |
| *(optional)* S3 / Cloudflare R2 bucket | Artifact storage at scale | Optional — a Render disk is used by default. |
| *(optional)* HubSpot or Salesforce | CRM auto-release | Only if you want auto-approval. |

No local toolchain is required for the deploy itself (Render builds the Docker images).
For local development you still want Node ≥ 20, pnpm ≥ 10, Python ≥ 3.11 (via `uv`), and
Docker — see the repo `README.md`.

---

## 2. Deploy the Blueprint

1. Push this repo to GitHub (the `render.yaml` must be on the branch you deploy).
2. In Render: **New +  →  Blueprint**, pick `trustmcp/trustmcp`, choose the branch,
   and click **Apply**.
3. Render reads [`render.yaml`](render.yaml) and creates the database and all four
   services. The first build takes a few minutes (Docker image builds + `pnpm install`).

What gets wired automatically:

- `TRUSTMCP_DATABASE_URL` / `DATABASE_URL` ← the managed Postgres connection string.
- `TRUSTMCP_SERVICE_TOKEN` ← generated once on `trustmcp-network` and mirrored into
  `trustmcp-web` (so the two trust each other).
- `AUTH_SECRET` ← generated for the web app.
- Migrations run on boot: `alembic upgrade head` (network) and `prisma migrate deploy`
  (web), via each image's entrypoint.

> The network and web app share one Postgres database. The network's tables are
> lowercase (`vendors`, `access_keys`, …) and Prisma's are PascalCase (`User`,
> `TrustCenter`, …), so they coexist without collisions.

---

## 3. Set the two required secrets

In the Render dashboard, open **`trustmcp-network` → Environment** and set:

- **`TRUSTMCP_SIGNING_PRIVATE_KEY`** — the stable Ed25519 signing seed. Generate it:
  ```bash
  openssl rand -base64 32
  ```
  Paste the output. **Keep a copy** — consumers pin signatures to this key, so don't
  rotate it casually. (If you leave it empty the network falls back to an *ephemeral*
  dev key that changes on every restart — fine for a smoke test, not for production.)

Everything else has a working default or is optional (Section 6). Save → Render
redeploys the service.

---

## 4. Domains + DNS

You own `trustmcp.app` and `trustmcp.org`. Attach them in Render and add the DNS records
your registrar shows you.

### 4a. App, network, docs (on `trustmcp.app`)

For each service, go to **Settings → Custom Domains → Add** and enter:

| Service            | Domain to add            |
|--------------------|--------------------------|
| `trustmcp-web`     | `trustmcp.app`           |
| `trustmcp-web`     | `www.trustmcp.app`       |
| `trustmcp-network` | `network.trustmcp.app`   |
| `trustmcp-docs`    | `docs.trustmcp.app`      |

Render then shows the DNS records to create at your registrar (where `trustmcp.app` is
managed):

- **Apex `trustmcp.app`** → an `ALIAS`/`ANAME` (or the `A` record Render gives you).
- **`www`, `network`, `docs`** → `CNAME` records pointing at the value Render shows
  (e.g. `trustmcp-web.onrender.com`).

Render issues TLS certificates automatically once DNS resolves (usually minutes).

### 4b. Redirect `trustmcp.org` → `trustmcp.app`

On the `trustmcp-org` static site: **Settings → Custom Domains → Add**
`trustmcp.org` and `www.trustmcp.org`, then add the matching DNS records at the
registrar for `trustmcp.org`. That service serves nothing but a `301` redirect of every
path to `https://trustmcp.app/...`, so the whole `.org` apex and `www` forward to the
app.

> The env vars in `render.yaml` (`AUTH_URL`, `NEXT_PUBLIC_APP_URL`,
> `TRUSTMCP_NETWORK_URL`, `TRUSTMCP_PUBLIC_BASE_URL`) already point at the
> `trustmcp.app` domains. Until DNS resolves you can smoke-test against the
> `*.onrender.com` URLs by temporarily overriding those vars in the dashboard.

---

## 5. Post-deploy

### 5a. Verify it's live

Quick manual checks:

```bash
curl -fsS https://network.trustmcp.app/health   # {"status":"ok",...}
curl -fsS https://network.trustmcp.app/readyz    # DB reachable
open https://trustmcp.app                          # sign in
open https://docs.trustmcp.app                      # docs
open https://trustmcp.org                            # → redirects to trustmcp.app
```

Or run the **deployment smoke test**, which checks health + readiness, that real
authentication is configured (and dev login is off), and reports every optional
integration (email/SMTP, Anthropic Ask, PostHog, Sentry, S3, signing key) by
reading the service-token-gated diagnostics endpoints:

```bash
WEB=https://trustmcp.app \
NETWORK=https://network.trustmcp.app \
TRUSTMCP_SERVICE_TOKEN=<the trustmcp-network service token> \
  python3 scripts/smoke.py
```

It prints a ✓/✗ checklist and exits non-zero if a hard check fails. No secret
values are printed — only configured/not-configured status. (You can also hit
`GET /api/diagnostics` on the web app, or `GET /v1/meta/diagnostics` on the
network, directly with the `X-TrustMCP-Service-Token` header.)

### 5b. Create your first trust center (the real flow)

Sign in at `https://trustmcp.app`, click **New trust center**, then follow the in-app
**Guided setup** (brand → upload evidence → attestations → verify domain → publish).

### 5c. (Optional) Seed the Acme/Chime demo

The seed script runs inside the network container. Open the `trustmcp-network` service →
**Shell** and run:

```bash
python -m app.seed all   # Acme + Chime Enterprise
```

It prints a consumer key (`tmcp_live_...`) you can use with the conformance suite below.

### 5d. Run the conformance suite against your live network

```bash
pip install httpx jsonschema cryptography
NETWORK=https://network.trustmcp.app VENDOR=vnd_acme KEY=tmcp_live_... \
  python conformance/run.py
```

### 5e. Finalize OAuth callback URLs

If you set up OAuth/SSO (Section 6), make sure each app's callback URL uses
`https://trustmcp.app/...` (not localhost).

---

## 6. Optional configuration

All of these are `sync: false` env vars in `render.yaml` — set them in the Render
dashboard on the relevant service.

### 6a. Sign-in providers (`trustmcp-web`)
Pick at least one. The dev login is disabled in production builds, so configure the
email sign-in link or OAuth before inviting people. GitHub/Google use verified-email
account linking, so a user can sign in with any provider and land on one account.

- **GitHub OAuth** — GitHub → Settings → Developer settings → **OAuth Apps → New**:
  - Homepage: `https://trustmcp.app`
  - Callback: `https://trustmcp.app/api/auth/callback/github`
  - Set `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`.
- **Google OAuth** — Google Cloud Console → Credentials → **OAuth client ID → Web**:
  - Redirect URI: `https://trustmcp.app/api/auth/callback/google`
  - Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
- **Enterprise SSO (OIDC)** — any OIDC IdP (Okta, Entra ID, Auth0). Redirect URI
  `https://trustmcp.app/api/auth/callback/sso`. Set `SSO_ISSUER`, `SSO_NAME`,
  `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`. (SAML-only IdPs: front with a SAML→OIDC bridge
  such as BoxyHQ Jackson — see `docs/auth-setup.md`.)

### 6b. Email (sign-in link + notifications)
- On **`trustmcp-web`**: set `EMAIL_SERVER` to an SMTP URL
  (`smtp://user:pass@smtp.host:587`). `EMAIL_FROM` defaults to
  `TrustMCP <no-reply@trustmcp.org>`.
- On **`trustmcp-network`**: set `TRUSTMCP_SMTP_HOST`, `TRUSTMCP_SMTP_USERNAME`,
  `TRUSTMCP_SMTP_PASSWORD` for owner notifications + freshness nudges.
- **Freshness nudges run daily** via the `trustmcp-freshness-nudge` Render cron
  (`python -m app.notify_expiring`, 13:00 UTC; change `schedule` in `render.yaml`).
  Emails are idempotent per expiry window. Run manually any time with
  `python -m app.notify_expiring`. The cron's `TRUSTMCP_SMTP_*` vars are `sync:false`
  (Render Blueprints can't copy another service's secrets via `fromService`) — set
  them to the **same values** as `trustmcp-network`.
- **Google Drive sync (optional):** trust-center owners link a Drive folder from
  **Trust center → Evidence → Google Drive sync**. Set
  `TRUSTMCP_GOOGLE_CLIENT_ID` + `TRUSTMCP_GOOGLE_CLIENT_SECRET` on
  `trustmcp-network` and owners get a one-click **Connect Google Drive** button —
  they approve at Google and pick a folder, never handling a credential. Create the
  client in Google Cloud Console (enable the Drive API, add the
  `.../auth/drive.readonly` scope, Web application client) and register
  `https://trustmcp.app/api/integrations/drive/callback` as an authorized redirect
  URI — it must match verbatim or Google returns `redirect_uri_mismatch`. Override
  the callback with `TRUSTMCP_GOOGLE_OAUTH_REDIRECT_URL` if your web host differs.
  Leave both unset and nothing breaks: owners paste their own service-account key
  or OAuth credentials instead. Folders set to sync *automatically* are
  picked up by the `trustmcp-drive-sync` Render cron (`python -m app.sync_drive`,
  every 30 minutes; change `schedule` in `render.yaml`). Its `TRUSTMCP_S3_*` and
  `TRUSTMCP_SERVICE_TOKEN` vars are `sync:false` — set them to the **same values** as
  `trustmcp-network`, since synced documents are written to the same bucket. The job
  only discovers and publishes what an owner has already approved, so running it
  often is safe. Folders set to sync on demand are skipped entirely.
- **AI "Ask a question" widget (optional):** set `TRUSTMCP_ANTHROPIC_API_KEY` on
  `trustmcp-network` to enable it (model via `TRUSTMCP_ASK_MODEL`, default
  `claude-opus-4-8`). Unset → the widget degrades gracefully to FAQ/resources.
- **Trust Center AI Migration (optional):** imports an existing/external trust
  center into one of yours. In the app: **Trust center → Evidence → AI migration**,
  give the source URL + requester details, and it starts a Browserbase session
  (driven by Stagehand/Claude) to request the documents and sign an NDA if needed.
  It then pauses ("awaiting release") so the source owner can release the docs to
  the requester; press **Resume** and it pulls every document + all profile content
  in, AI-labels the files, and copies everything over. Set `BROWSERBASE_API_KEY`,
  `BROWSERBASE_PROJECT_ID`, and `TRUSTMCP_ANTHROPIC_API_KEY` on `trustmcp-web`
  (model via `TRUSTMCP_MIGRATION_MODEL`, default `claude-opus-4-8`). Unset → the
  feature is disabled in the UI with a friendly notice.
- **Production fail-fast:** with `TRUSTMCP_ENVIRONMENT=production`, the network refuses
  to boot unless `TRUSTMCP_SERVICE_TOKEN`, `TRUSTMCP_SIGNING_PRIVATE_KEY`, and a
  Postgres `TRUSTMCP_DATABASE_URL` are set — surfacing misconfig at deploy time.
- **Self-service DPA e-signature (optional):** Docusign is configured **per trust
  center** in the app — **Trust center → Settings → Docusign** (account id, integration
  key, impersonated user id, RSA private key, base URI/auth host, and a Connect HMAC
  key; the DPA template id lives under *Self-service DPA*). Each customer signs from
  their own Docusign account. Point a **Docusign Connect** webhook at
  `https://network.trustmcp.app/v1/esign/webhook` (the HMAC key entered per trust center
  verifies it) so signed/declined status syncs back. The `TRUSTMCP_DOCUSIGN_*` env vars
  remain as an optional network-wide fallback default. Unset everywhere → DPAs are
  captured and the owner is notified to route them manually.
- Subscriber update emails and DPA links use `TRUSTMCP_WEB_BASE_URL`
  (e.g. `https://trustmcp.app`).

### 6c. Artifact storage at scale (S3 / Cloudflare R2)
By default artifacts live on the network's Render **disk** (`/app/.data/artifacts`),
which is simple but pins the service to a single instance. To scale out, set the
`TRUSTMCP_S3_*` vars on `trustmcp-network` (bucket, region, and for R2 the
`TRUSTMCP_S3_ENDPOINT_URL` + access keys). When `TRUSTMCP_S3_BUCKET` is set, the disk is
no longer needed.

### 6d. CRM auto-release
CRM is connected **per trust center** in the app — **Trust center → Settings → CRM
connection**. Each customer picks a provider (HubSpot/Salesforce) and a connection
method: a direct **API token**, or their **own MCP server** (a Streamable-HTTP MCP
endpoint we query for a company by domain). When the requester is a verified customer,
matching requests auto-release. The `TRUSTMCP_HUBSPOT_TOKEN` / `TRUSTMCP_SALESFORCE_*`
env vars on `trustmcp-network` remain only as an optional network-wide fallback default.

### 6e. Error tracking (Sentry)
- **Network:** set `TRUSTMCP_SENTRY_DSN` on `trustmcp-network`.
- **Web:** set `NEXT_PUBLIC_SENTRY_DSN` (browser) and optionally `SENTRY_DSN` (server)
  on `trustmcp-web`. For source-map upload at build time, also set `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (omit them to skip upload). All no-op if unset.

### 6f. Product analytics (PostHog)
Set `NEXT_PUBLIC_POSTHOG_KEY` (and `NEXT_PUBLIC_POSTHOG_HOST`, default
`https://us.i.posthog.com`) on `trustmcp-web`. These are public client-side keys; the
app captures pageviews automatically and no-ops entirely when the key is unset.

> **Build-time, not just runtime.** `NEXT_PUBLIC_*` values (PostHog key/host,
> browser Sentry DSN, app URL) and the `SENTRY_*` source-map inputs are baked
> into the client bundle when `next build` runs — setting them only at runtime
> leaves the browser with `undefined` and you'll see **no PostHog/Sentry data**.
> `apps/web/Dockerfile` declares them as `ARG`s, and Render forwards the
> matching service env vars as Docker build args, so they're picked up at build.
> **You must redeploy (rebuild the image) after first setting or changing any of
> these** — a runtime-only restart won't pick up new values.

---

## 7. Continuous deployment

`autoDeploy: true` is set on each service, so **every push to the connected branch
redeploys automatically** — no GitHub Actions wiring needed. CI (`ci.yml`) and the
browser E2E (`e2e.yml`) still run on every push/PR.

To deploy a different branch, change it in each service's **Settings → Branch** (or
re-apply the Blueprint from that branch).

---

## 8. Publishing the client packages (optional)

To publish `@trustmcp/spec` + `@trustmcp/sdk` to npm and the MCP client to PyPI on a tag:

1. Add repo secrets `NPM_TOKEN` and `PYPI_API_TOKEN` (GitHub → repo → Settings →
   Secrets and variables → Actions).
2. `git tag v0.1.0 && git push --tags` → `release.yml` publishes (skips if tokens
   absent).

---

## 9. Operations

- **Scaling:** the web and docs services are stateless — raise instance count/plan in
  Render. The network is single-instance while it uses the local disk; move to S3/R2
  (6c) to scale it horizontally.
- **Backups:** Render Postgres has automated backups; review the retention on your plan.
- **Monitoring:** set `TRUSTMCP_SENTRY_DSN`; watch Render service metrics and logs.
  `/readyz` on the network is the readiness target.
- **Signing-key rotation:** publish a new key, dual-sign during overlap, retire the old
  one (consumers pin via `X-TrustMCP-Key-Id` / `/v1/network/key`).
- **Secrets rotation:** update the env var in the Render dashboard → the service
  redeploys.

---

## 10. Local development

The Blueprint is for production. For local work, use Docker Compose (Postgres + MinIO +
network + web):

```bash
docker compose up --build
docker compose exec network python -m app.seed all
# web: http://localhost:3000   network: http://localhost:8000/docs
```

See `README.md` for the piece-by-piece (non-Docker) flow.

---

## Troubleshooting

- **Service won't go healthy:** check **Logs** in Render. The entrypoints log migration
  and startup; a failed migration exits non-zero (look for `migrate deploy failed` /
  `migration failed`).
- **Web 500 on sign-in:** confirm `AUTH_SECRET` and `AUTH_URL` are set and the OAuth
  callback URL matches exactly.
- **`/readyz` 503:** the network can't reach Postgres — confirm `TRUSTMCP_DATABASE_URL`
  is the database's connection string (the Blueprint wires this automatically).
- **Network 401 from web:** `TRUSTMCP_SERVICE_TOKEN` mismatch — the Blueprint mirrors it
  via `fromService`; if you changed it on one service, change it on both.
- **Custom domain stuck "verifying":** confirm the DNS records at your registrar match
  exactly what Render shows, then wait for propagation (`dig trustmcp.app +short`).
- **Artifacts disappear after deploy:** you're on local-disk storage with the disk
  unmounted or replaced — confirm the `trustmcp-artifacts` disk is attached, or move to
  S3/R2 (6c).
