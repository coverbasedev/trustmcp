# CRM relationship verification

When a customer requests access to private documents, a vendor often wants to confirm the
requester is actually a customer before approving. TrustMCP checks your CRM by the
requester's **email domain** and uses the result for the request badge, auto-release, and
the approval agent's recommendation:

- **✓ {provider} customer** — a matching company/account was found
- **not in {provider}** — no match (treat with extra scrutiny)
- **CRM: n/a** — no CRM configured

There are two ways to connect a CRM: **per trust center, in the dashboard** (recommended)
or **network-global, via env vars** (for self-hosters). Per-vendor credentials always take
precedence; the network-global config is the fallback.

## Per trust center (dashboard)

Each trust center connects its own CRM under **Settings → CRM connection**. Pick a
provider and a connection method (API token or your own CRM MCP server). Credentials are
stored server-side, scoped to that trust center, and never echoed back. Then enable
**Auto-release policies → "Auto-release if the requester is a customer in our CRM"**.

Full step-by-step instructions, matching the dashboard journey, live in the docs site:
**For vendors → Connect HubSpot & Salesforce** (`apps/docs/src/app/vendors/crm-and-agent`).

## Network-global (env vars)

For a single CRM shared across the whole node (or local dev), configure one provider on
the **network** service. This is the fallback used when a vendor hasn't connected its own.

**HubSpot** — a private-app token with `crm.objects.companies.read`:

```
HUBSPOT_TOKEN=pat-na1-...
```

Looks up companies by the `domain` property (exact match).

**Salesforce** — an instance URL + a valid OAuth access token:

```
SALESFORCE_INSTANCE_URL=https://yourorg.my.salesforce.com
SALESFORCE_ACCESS_TOKEN=00D...
```

Runs `SELECT Id, Name FROM Account WHERE Website LIKE '%domain%'`.

The shared implementation is `apps/network/app/crm.py` (`verify_relationship`).

## Doing it over MCP

The same check is agent-drivable. Both HubSpot and Salesforce ship MCP servers, and a
trust center can point TrustMCP at its own CRM MCP endpoint (Streamable-HTTP, authed with a
bearer token or OAuth client-credentials) instead of a static API token — the network
queries it for a company/account by domain. An approval agent can call the same servers
directly to decide whether to approve a request; the dashboard connector mirrors that
logic. Verification is advisory: the human (or agent) still makes the call, and the network
only mints the key once the vendor approves or an enabled auto-release policy matches.
