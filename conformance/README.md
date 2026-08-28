# TrustMCP conformance suite

Verify that a network (or your own implementation) honors the TrustMCP v0.1 contract:
the network key endpoint, the mark endpoint, schema-valid **and signature-verified**
manifest/attestations, freshness, and hash-verifiable artifact downloads.

```bash
pip install httpx jsonschema cryptography
NETWORK=https://network.trustmcp.app VENDOR=vnd_acme KEY=tmcp_live_... \
  python conformance/run.py
```

Exit code is `0` only when every check passes.

## "TrustMCP-compliant" badge

Once a network passes, you can display a badge. A static example:

```md
![TrustMCP compliant](https://img.shields.io/badge/TrustMCP-v0.1%20compliant-4f46e5)
```

For a live badge, run `run.py` in CI on a schedule and publish a
[Shields endpoint](https://shields.io/endpoint) JSON like:

```json
{ "schemaVersion": 1, "label": "TrustMCP", "message": "v0.1 compliant", "color": "4f46e5" }
```

The same checks run in the reference network's own test-suite
(`apps/network/tests/test_conformance.py`) against the in-process app.
