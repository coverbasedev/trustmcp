# Security Policy

## Reporting a vulnerability

Please report security issues privately to **security@trustmcp.org** (placeholder —
update before launch). Do not open a public issue for vulnerabilities.

We aim to acknowledge within 3 business days and to provide a remediation timeline after
triage. Coordinated disclosure is appreciated.

## Scope

- The TrustMCP Network API (`apps/network`)
- The web app / Trust Center builder (`apps/web`)
- The MCP server (`mcp/python`)
- The specification and schemas (`spec/`)

## Security model (what TrustMCP guarantees)

- **Identity & custody, not content.** The network verifies that a publisher controls
  the domain it publishes under (the `agent-ready` mark) and mints/validates scoped,
  revocable access keys. It does **not** attest that the underlying evidence is true —
  customers verify that themselves.
- **Tamper-evidence.** Manifest and attestations responses are Ed25519-signed
  (`X-TrustMCP-Signature`); artifacts carry a `sha256` for download verification.
- **Least privilege.** Access keys are scoped (`manifest`/`attestations`/`artifacts`),
  can be restricted to specific artifacts, expire, and are revocable. Every read is
  logged.
- **Secrets.** Owner tokens, access keys, CRM tokens, and webhook secrets are stored
  hashed or write-only and never echoed back by the API.

## Hardening notes for operators

- Configure a stable `TRUSTMCP_SIGNING_PRIVATE_KEY` (don't rely on the ephemeral dev key).
- Put the API behind TLS and a rate limiter (a basic limiter ships in-process).
- Store secrets in your platform's secret store (e.g. Render environment variables /
  secret files) rather than baking them into images.
