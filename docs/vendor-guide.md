# Vendor guide — publish your trust center in an afternoon

This is the publisher path. Goal: go from nothing to an **agent-ready** trust center
that any customer (or their agent) can read, with you in full control of access.

## 1. Create your trust center

Sign in at the TrustMCP web app and click **New trust center**. Enter your legal name,
product, and primary domain. This provisions a vendor in the network and a private
owner token (held server-side for you).

## 2. Brand it

Under **Branding**, set your display name, logo, colors, headline, and description.
The public page is *your* brand — TrustMCP is invisible except for the small agent-ready
mark. Preview with **View public page ↗**.

## 3. Upload evidence

Under **Artifacts**, add your documents:

- SOC 2 Type II, SOC 2 Type I, ISO 27001
- Penetration test, SBOM (CycloneDX/SPDX)
- Certificate of insurance, DPA, architecture overview, subprocessor list, policies

For each, set the issue date and (optionally) an expiry. Upload the file — the network
records its sha256 so agents can verify exactly what they download. Files are released
**only** to customers you grant a scoped key.

## 4. Declare attestations

Under **Attestations**, add machine-readable claims so agents don't have to parse
every PDF, e.g.:

| Key | Value | Evidence |
|-----|-------|----------|
| `mfa.enforced` | `true` | `art_soc2_…` |
| `encryption.at_rest` | `AES-256` | `art_soc2_…` |
| `data_residency` | `US, EU` | `art_architecture` |
| `breach_notification_hours` | `72` | `art_dpa` |

Values are parsed as boolean / number / comma-separated list / string. Evidence is a
comma-separated list of artifact ids.

## 5. Get the agent-ready mark

Under **Domains & Mark**, add your domain and add **one** of:

- a DNS `TXT` record `_trustmcp-challenge.<domain>` with the shown value, or
- a file at `https://<domain>/.well-known/trustmcp-challenge.txt` containing the value.

Click **Verify**. You now have the `agent-ready` mark for that domain.

## 6. Add your discovery record

Host this at `https://<your-domain>/.well-known/trustmcp.json` (copy it from the app,
or proxy `/(app)/api/discovery/<vendor_id>`):

```json
{
  "schema_version": "0.1",
  "vendor_id": "vnd_yourco",
  "legal_name": "Your Co",
  "network": "https://network.trustmcp.app",
  "manifest": "https://network.trustmcp.app/v1/vendors/vnd_yourco/manifest",
  "mark": "agent-ready"
}
```

## 7. Publish

Click **Publish**. Your public trust center is live and your profile is readable by
customers you grant access to.

## 8. Handle access requests

When a customer requests access, you'll see it under **Access requests**. Approve to
mint a scoped, expiring key (shown once); revoke any key at any time. Every read shows
up in your **Audit log** — including which key read which artifact.

That's it. You answered the questionnaire once — by publishing.
