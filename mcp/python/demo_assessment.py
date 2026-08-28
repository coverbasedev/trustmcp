"""End-to-end TrustMCP assessment loop (the §8 flow), runnable against any network.

This is the customer side. It reads a vendor's published profile through the TrustMCP
client and computes a verdict **locally** against the customer's own control
framework. The verdict is never sent back to the network.

Usage (against a running network with a seeded key):
    export TRUSTMCP_NETWORK=http://localhost:8000
    export TRUSTMCP_KEYS='{"vnd_acme": "tmcp_live_..."}'
    python demo_assessment.py vnd_acme
"""

from __future__ import annotations

import hashlib
import sys

from trustmcp_client import TrustMCPClient

# Globex's own control framework, mapped onto TrustMCP claim keys. Two customers can map
# the same claims differently — that is the point of TrustMCP.
CONTROLS: dict[str, tuple[str, object]] = {
    "AC-2  MFA enforced": ("mfa.enforced", lambda v: v is True),
    "SC-28 Encryption at rest": ("encryption.at_rest", lambda v: "AES" in str(v)),
    "SC-8  Encryption in transit": ("encryption.in_transit", lambda v: "TLS" in str(v)),
    "IR-6  Breach notice <= 72h": ("breach_notification_hours", lambda v: int(v) <= 72),
    "DR-1  Data residency incl. EU": ("data_residency", lambda v: "EU" in (v or [])),
}


def run_assessment(client: TrustMCPClient, vendor_id: str, requester: dict) -> dict:
    report: dict = {"vendor_id": vendor_id, "steps": [], "controls": [], "artifacts_verified": []}

    # 1. Verify the mark (trust the network, not a self-asserted field).
    mark = client.get_mark(vendor_id)
    report["mark"] = mark
    report["steps"].append(f"mark: {mark.get('mark')} (domains: {mark.get('verified_domains')})")

    # 2. Manifest.
    manifest = client.get_manifest(vendor_id)
    report["steps"].append(f"manifest: {len(manifest['artifacts'])} artifacts")

    # 3. Attestations -> map to controls.
    attestations = client.get_attestations(vendor_id)
    claims = {c["key"]: c for c in attestations["claims"]}
    for control, (claim_key, predicate) in CONTROLS.items():
        claim = claims.get(claim_key)
        if claim is None:
            result = "no-evidence"
        else:
            try:
                result = "pass" if predicate(claim["value"]) else "review"
            except Exception:
                result = "review"
        report["controls"].append(
            {
                "control": control,
                "claim": claim_key,
                "value": claim["value"] if claim else None,
                "result": result,
                "evidence": claim["evidence"] if claim else [],
            }
        )

    # 4. Freshness -> decide what to pull.
    freshness = client.check_freshness(vendor_id)
    stale = [i["id"] for i in freshness["items"] if i["status"] != "valid"]
    report["steps"].append(f"freshness: {len(stale)} not-valid -> {stale}")

    # 5. Fetch + verify the artifacts backing contested controls (here: the SOC 2).
    evidence_ids = {
        e for c in report["controls"] if c["result"] != "pass" for e in c["evidence"]
    }
    # Always pull at least the first manifest artifact to demonstrate hash verification.
    if manifest["artifacts"]:
        evidence_ids.add(manifest["artifacts"][0]["id"])
    for art_id in sorted(evidence_ids):
        link = client.fetch_artifact(vendor_id, art_id)
        verified = _verify_hash(client, link)
        report["artifacts_verified"].append({"id": art_id, "hash_ok": verified})

    # 6. Local verdict.
    results = [c["result"] for c in report["controls"]]
    if any(r in {"review", "no-evidence"} for r in results):
        verdict = "needs-review"
    else:
        verdict = "pass"
    report["verdict"] = verdict
    report["note"] = "Verdict computed locally by the customer; never sent to the network."
    return report


def _verify_hash(client: TrustMCPClient, link: dict) -> bool:
    expected = link.get("sha256")
    if not expected:
        return False
    r = client._http.get(link["url"])
    r.raise_for_status()
    return hashlib.sha256(r.content).hexdigest() == expected


def _print(report: dict) -> None:
    print(f"\n=== TrustMCP assessment: {report['vendor_id']} ===")
    for s in report["steps"]:
        print(f"  • {s}")
    print("  controls:")
    for c in report["controls"]:
        print(f"    [{c['result']:>11}] {c['control']:<32} = {c['value']}")
    print("  artifacts verified:")
    for a in report["artifacts_verified"]:
        print(f"    {a['id']}: hash {'OK' if a['hash_ok'] else 'MISMATCH'}")
    print(f"\n  VERDICT: {report['verdict']}  ({report['note']})\n")


def main() -> None:
    vendor_id = sys.argv[1] if len(sys.argv) > 1 else "vnd_acme"
    client = TrustMCPClient()
    requester = {"name": "Globex Inc", "domain": "globex.com", "contact": "trust@globex.com"}
    _print(run_assessment(client, vendor_id, requester))


if __name__ == "__main__":
    main()
