# Domain Connect — one-click custom-domain setup

[Domain Connect](https://www.domainconnect.org) is the open standard that powers the
"connect your domain in one click" flow in the trust-center builder (the same idea as
commercial aggregators like Entri, but free and standards-based). The customer's DNS
provider hosts the consent UI; we send the user there with this template pre-filled,
they approve, and the provider writes the records directly. **No API keys touch us and
nothing is stored.**

## How the pieces fit

- `app/domain_connect.py` — client for the **synchronous** flow: TXT-record discovery
  of the zone's Domain Connect API host, a `/v2/{zone}/settings` fetch, and the
  `/apply` URL builder.
- `POST /v1/vendors/{id}/custom-domain/dns/domain-connect/discover` — returns
  `{ supported, provider_name, apply_url }`. The web app opens `apply_url` in a popup.
- `apps/web/src/app/domain-connect/callback/page.tsx` — the redirect target the
  provider returns the popup to; it relays the outcome back to the panel.
- `templates/trustmcp.app.trust-center.json` — the template below.

## The template

The `%cname%` and `%token%` placeholders are filled at apply time from the values we
already issue for the domain. The provider appends the `host` parameter (the sub-zone,
e.g. `trust` for `trust.example.com`) to each record's `host`:

- `CNAME @` → `trust.example.com` → `%cname%` (our `cname.trustmcp.app`)
- `TXT _trustmcp` → `_trustmcp.trust.example.com` → `trustmcp-verify=%token%`

The fixed `trustmcp-verify=` prefix is embedded in the template (rather than passing
the whole TXT value as a bare variable) per the contribution guidelines. The discover
endpoint strips that prefix and passes only the bare token as `%token%`.

## Going live (one-time registration — needs DNS + a maintainer account)

The synchronous flow only applies templates a provider **recognizes** and can
**cryptographically verify**. This requires actions that can't be automated from CI —
they touch our DNS and a third-party repo:

1. **Publish a sync-signature key.** Run `./gen-sync-key.sh` to generate an RSA keypair
   and print the public-key TXT record to publish at `syncPubKeyDomain`
   (`_dconf.trustmcp.app`). Keep the private key out of git and load it into the network
   service; providers fetch the public key to verify our signed `/apply` requests. (See
   the Domain Connect spec, "Signing the query string".)
2. **Submit the template.** Open a PR adding `trustmcp.app.trust-center.json` to the
   Domain Connect [templates repository](https://github.com/Domain-Connect/Templates).
   Their process requires validating the template in their Online Editor and pasting the
   shareable result into their PR template. Major providers (GoDaddy, IONOS, 1&1, …)
   ingest templates from there.
3. **Provider onboarding.** Some providers also require registering the
   `providerId`/`serviceId` in their partner console — follow each provider's Domain
   Connect onboarding.

Until a provider has the template, `discover` still reports support but the apply will
be rejected by that provider; the per-provider API-key path and manual records remain
as fallbacks, so nothing breaks. Override the identifiers with
`TRUSTMCP_DOMAIN_CONNECT_PROVIDER_ID` / `TRUSTMCP_DOMAIN_CONNECT_SERVICE_ID` if needed.

## The other two paths (no template onboarding required)

One-click via Domain Connect is the ideal, but it's gated on the registration above.
The custom-domain panel auto-detects the customer's DNS provider on load (no dropdown)
and picks the best available path, all driven by `app/dns_providers.py`:

- **API-key auto-configure** — for providers with a clean write API we drive directly
  (Cloudflare, GoDaddy, Vercel, DigitalOcean, Linode/Akamai, Hetzner, Porkbun, Gandi,
  Name.com). The panel renders the right credential fields from the server-provided
  catalog and creates the records in one call. Credentials are used once, never stored.
- **Guided manual** — for providers we can *name* but not write to (Route 53, Azure,
  IONOS, OVH, NS1, DNSimple, Squarespace, …), we deep-link straight to their DNS panel
  and show the two records to add.

To support a new provider, add a `ProviderInfo` to `REGISTRY` in `dns_providers.py`:
its nameserver suffix(es) drive detection, a `panel_url` gives the deep-link, and an
`adapter` + `fields` (when the API is safe to drive) unlock API-key auto-configure.
