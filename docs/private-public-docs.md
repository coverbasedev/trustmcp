# Public vs. private documents

Each artifact has a **visibility** set when you add it in the builder:

- **Public** (`access: "public"`) — anyone can download it from your trust page, no key
  required. Good for marketing-safe collateral: ISO certificate, whitepapers, a public
  pentest summary.
- **Private** (`access: "key_required"`, the default) — listed on your trust page but
  the file is released only after you **approve an access request** and the customer
  presents a scoped, expiring, revocable key.

## How it works

- Public download: `GET /v1/vendors/{vid}/artifacts/{aid}/public` returns a short-lived
  signed URL (the web app proxies this at `/api/public-artifact/...`). The network
  refuses this endpoint for private artifacts.
- Private download: the customer requests access → you approve → they read with the key
  via `GET /v1/vendors/{vid}/artifacts/{aid}` (scope `artifacts`). Every read is logged.

## The approval workflow (with notifications)

1. A customer submits a request from your public trust page (or via MCP `request_access`).
2. The trust-center **owner is emailed** (when SMTP is configured) and sees it under
   **Access requests**, alongside a **CRM relationship check** (see
   `crm-verification.md`).
3. On **approve**, the network mints a scoped key and the **requester is emailed** the
   key + expiry. On **deny**, the requester is emailed a notice.
4. You can **revoke** any key at any time; reads stop immediately and show in the audit
   log.

Email is best-effort: if SMTP isn't configured, the dashboard queue is the source of
truth and decisions still work. Owner notifications fire for **every** request channel
(web, API, MCP) when `notify_on_request` is on and a `notify_email` is set.

## Auto-release policies

In **Settings**, a vendor can have requests granted automatically (no manual step) when
they match any enabled policy:

- **Preconfigured customer domains** — an allowlist of requester domains.
- **CRM match** — the requester's domain is an existing customer in HubSpot/Salesforce
  (see `crm-verification.md`).
- **Contract upload** — the requester uploads a contract proving an agreement
  (`/v1/keys/request-with-contract`); the vendor can later download it for audit.

Auto-granted keys are still **scoped, expiring, and revocable**, and the auto-grant is
recorded in the audit log with the matching reason.

## Per-artifact access scopes

When approving, an owner can restrict a key to **specific artifacts** (checkboxes in the
Access requests page → `artifact_ids` on approve). The key then reads only those
documents within its scope; other artifact fetches return `403`.
