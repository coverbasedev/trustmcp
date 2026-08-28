# TrustMCP MCP server

Exposes the six (here, seven) TrustMCP operations as MCP tools so any agent can run a
third-party assessment through a single connector. The server holds the customer's
access keys and talks to the network on the agent's behalf.

## Tools

| Tool | Purpose |
|------|---------|
| `discover_vendor(domain)` | Resolve a domain to a vendor id + network endpoint via the discovery record. |
| `request_access(vendor_id, requester, scope, nda_accepted?)` | Ask the vendor for a key (NDA-aware). |
| `get_manifest(vendor_id)` | Return the manifest (Ed25519 signature-verified). |
| `get_attestations(vendor_id, keys?)` | Return structured claims (signature-verified), optionally filtered. |
| `get_attestations_mapped(vendor_id, framework)` | Map claims to a control framework. |
| `get_oscal(vendor_id, framework)` | Export claims as an OSCAL component definition. |
| `list_frameworks()` | List frameworks for mapping / OSCAL. |
| `fetch_artifact(vendor_id, artifact_id)` | Signed download link + hash (current version). |
| `get_artifact_versions(vendor_id, artifact_id)` | Version history. |
| `fetch_artifact_version(vendor_id, artifact_id, version)` | Signed link for a specific version. |
| `check_freshness(vendor_id)` | Return valid / expiring / expired artifacts. |
| `get_subprocessor_graph(vendor_id)` | nth-party graph (linked TrustMCP vendors). |
| `verify_mark(vendor_id)` | Verify the agent-ready mark and verified domains. |
| `get_network_key()` | The network's Ed25519 public key. |

Manifest and attestations are **signature-verified** against `get_network_key()` before
being returned; a tampered response raises `SignatureError`.

## Run

```bash
uv venv .venv && uv pip install --python .venv -e ".[dev]"
export TRUSTMCP_NETWORK=http://localhost:8000
export TRUSTMCP_KEYS='{"vnd_acme": "tmcp_live_..."}'   # from `python -m app.seed`
uv run trustmcp-mcp
```

Register with an MCP client (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "assurance-network": {
      "command": "uv",
      "args": ["run", "trustmcp-mcp"],
      "env": {
        "TRUSTMCP_NETWORK": "https://network.trustmcp.app",
        "TRUSTMCP_KEYS": "{\"vnd_acme\": \"tmcp_live_...\"}"
      }
    }
  }
}
```

## The assessment loop (demo)

`demo_assessment.py` runs the full §8 loop and computes a verdict **locally** against
a sample control framework (the verdict never goes back to the network):

```bash
python demo_assessment.py vnd_acme
```

## Tests

```bash
pytest   # drives the loop against the network app in-process
```
