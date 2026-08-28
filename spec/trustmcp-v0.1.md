# TrustMCP — Specification v0.1

> Status: Draft. This is a living document for the founding consortium.
> The standard is open (Apache-2.0) and is not a product of any single company.

## 0. Summary

TrustMCP moves third-party risk from a **request model** to a **publish model**. A vendor
publishes its assurance data **once**, in a machine-readable form an agent can read,
and grants access with a scoped, revocable key. Each customer assesses on its own
terms against its own control framework — no questionnaire.

TrustMCP standardizes **access to the evidence**, not the verdict. Two customers can read
the same profile and reach different conclusions. That is the point.

### What the network does and does not do

The TrustMCP Network is a **thin trust anchor**, not a rating agency.

It **does**:

- verify that a publisher controls the domain it claims (DNS or `.well-known`),
- issue and validate the `agent-ready` **mark**,
- mint, scope, and validate **access keys**, and revoke them on demand,
- record an **audit log** of every read,
- track artifact **freshness** and nudge vendors before expiry.

It **does not**:

- score, rate, or rank vendors,
- transform or interpret the underlying evidence,
- decide who is "safe."

The verdict never lives in the network. Unlike pooled-assessment approaches that shipped stale, one-size verdicts,
**TrustMCP shares the raw, current data and lets each customer compute its own answer.**

## 1. The five objects

| Object | What it is |
|--------|------------|
| **Assurance Profile** | Everything a vendor publishes, reached via a discovery record on the vendor's own domain. |
| **Manifest** | The index of a profile: which artifacts and attestations exist, plus freshness metadata. |
| **Artifact** | A document: SOC 2, pentest, ISO cert, insurance COI, financials, DPA, architecture, subprocessor list, SBOM, policy. |
| **Attestation** | A structured machine-readable claim (`mfa.enforced: true`) linked to the artifact(s) that back it. |
| **Access Key** | A scoped, revocable token a customer presents to read a profile. The vendor controls issuance and revocation. |

## 2. Discovery

A vendor posts one small file at a known path on its primary domain:

```
GET https://acme.com/.well-known/trustmcp.json
```

```json
{
  "schema_version": "0.1",
  "vendor_id": "vnd_acme",
  "legal_name": "Acme Corp",
  "network": "https://network.trustmcp.app",
  "manifest": "https://network.trustmcp.app/v1/vendors/vnd_acme/manifest",
  "mark": "agent-ready"
}
```

The `mark` field is only valid if the network's mark-verification endpoint confirms it
(see §9). A self-asserted `mark` with no network record is not a valid TrustMCP mark.

An agent that knows only a domain can resolve from here to the network, then request
access.

## 3. The manifest

See `schemas/manifest.schema.json`. Required artifact fields: `id`, `type`,
`issued_at`, `sha256`, `access`, `uri`. A null `valid_until` means the artifact does
not expire. The `sha256` lets an agent confirm the file it fetched matches the
manifest.

Suggested `type` values for v0: `soc2_type2`, `soc2_type1`, `iso_27001`, `pentest`,
`insurance_coi`, `financials`, `dpa`, `architecture`, `subprocessor_list`, `sbom`,
`policy`. The set is open and extensible.

## 4. Attestations

Structured claims, each pointing at its evidence. See
`schemas/attestations.schema.json`. A claim is `key`, `value`, and `evidence` (a list
of artifact ids). Customers map claim keys to their own control framework.

Reserved key namespaces for v0 (open/extensible):
`mfa.*`, `encryption.*`, `data_residency`, `breach_notification_hours`,
`subprocessors.*`, `availability.*`, `bcp_dr.*`, `access_control.*`, `compliance.*`.

## 5. Access keys

The vendor controls access. A customer requests, the vendor approves, a scoped key is
issued. Keys are revocable and every read is logged. See `schemas/access-key.schema.json`.

Scopes for v0: `manifest`, `attestations`, `artifacts`. A key carries an
`expires_at`; the network rejects expired or revoked keys.

```
POST /v1/keys/request        -> { status: "pending", request_id }
# vendor approves in dashboard / via POST /v1/keys/requests/{id}/approve
# -> { status: "granted", key, scope, expires_at }
POST /v1/keys/{id}/revoke    -> { status: "revoked" }
```

## 6. Reading a profile (REST)

All reads send the key as a bearer token. See `docs/api-reference.md` for the full
surface.

```
GET /v1/vendors/{vendor_id}/manifest
GET /v1/vendors/{vendor_id}/attestations
GET /v1/vendors/{vendor_id}/artifacts/{artifact_id}   # -> short-lived signed URL + sha256
GET /v1/vendors/{vendor_id}/freshness
```

`freshness.status` is one of `valid`, `expiring` (inside a configurable window), or
`expired`. The network nudges the vendor before expiry; the vendor refreshes once; every
customer sees the new artifact at the same time. See `schemas/freshness.schema.json`.

## 7. The MCP server

The same operations exposed as MCP tools so any agent can run an assessment through a
single connector. The server holds the customer's keys and talks to the network on the
agent's behalf.

| Tool | Purpose |
|------|---------|
| `discover_vendor(domain)` | Resolve a domain to a vendor id and network endpoint. |
| `request_access(vendor_id, requester, scope)` | Ask the vendor for a key. |
| `get_manifest(vendor_id)` | Return the manifest, using the stored key. |
| `get_attestations(vendor_id, keys)` | Return structured claims, optionally filtered. |
| `fetch_artifact(vendor_id, artifact_id)` | Return a document link and its expected hash. |
| `check_freshness(vendor_id)` | Return valid, expiring, and expired artifacts. |

Reference implementation: `mcp/python/trustmcp_mcp_server.py`.

## 8. The assessment loop

1. `discover_vendor("acme.com")`
2. `request_access(...)` if there is no key yet, then wait for the grant.
3. `get_manifest(...)`
4. `get_attestations(...)` and map each claim key to the customer's own controls.
5. `check_freshness(...)` and only fetch artifacts the customer still needs.
6. `fetch_artifact(...)` for the handful of documents that back contested or high-risk
   controls, verifying each against the manifest hash.
7. Produce the assessment in the customer's own format. The verdict is computed locally
   and never sent back to the network.

## 9. The mark and domain verification (governance)

TrustMCP is **open and free**, with a **low-barrier verified** trust floor:

1. A vendor signs up (OAuth) and claims a domain.
2. The network issues a verification challenge: a DNS `TXT` record
   (`_trustmcp-challenge.<domain>`) **or** a file at
   `https://<domain>/.well-known/trustmcp-challenge.txt`.
3. Once verified, the vendor may publish a profile and is granted the `agent-ready`
   mark for that domain.
4. The mark is **verifiable**: `GET /v1/mark/{vendor_id}` returns the mark status,
   verified domains, and issuance time. Consumers should check this rather than trust a
   self-asserted `mark` field.

This keeps entry cheap (no manual vetting, no fee) while ensuring a publisher actually
controls the domain it publishes under — the answer to "otherwise vendors just sign any
BS." The **content** of the evidence remains self-asserted; TrustMCP verifies *identity and
custody of the mark*, not the truth of every claim. Customers verify claims themselves
by reading the underlying artifacts — exactly the model TrustMCP is built for.

## 10. Versioning

`schema_version` is present on every top-level object. v0.x is pre-stability; breaking
changes may occur. The first stable release is v1.0.
