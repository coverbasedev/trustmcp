from __future__ import annotations

import sys
from pathlib import Path

from tests.conftest import owner_headers

# Import the shared conformance checks from the repo-root conformance/ package.
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "conformance"))
SCHEMA_DIR = str(ROOT / "spec" / "schemas")


def test_reference_network_is_conformant(client, vendor):
    from checks import run, summarize

    vid, owner = vendor
    h = owner_headers(owner)
    # Publish a profile with a content-bearing artifact + a claim.
    art = client.post(f"/v1/vendors/{vid}/artifacts", headers=h,
                      json={"type": "soc2_type2", "issued_at": "2026-01-15"}).json()
    client.post(f"/v1/vendors/{vid}/artifacts/{art['id']}/content", headers=h,
                files={"file": ("soc2.pdf", b"%PDF report", "application/pdf")})
    client.put(f"/v1/vendors/{vid}/attestations", headers=h,
               json={"claims": [{"key": "mfa.enforced", "value": True, "evidence": [art["id"]]}]})
    client.post(f"/v1/vendors/{vid}/publish", headers=h)

    req = client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "G", "domain": "g.com", "contact": "a@g.com"},
        "scope": ["manifest", "attestations", "artifacts"],
    }).json()
    grant = client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=h, json={}
    ).json()

    results = run(client, "", vid, SCHEMA_DIR, key=grant["key"])
    failed = [(n, d) for n, ok, d in results if not ok]
    assert not failed, f"conformance failures: {failed}"
    passed, total = summarize(results)
    assert passed == total and total >= 6
