#!/usr/bin/env python3
"""TrustMCP conformance runner — verify any network implements the TrustMCP v0.1 contract.

    pip install httpx jsonschema cryptography
    NETWORK=https://network.trustmcp.app VENDOR=vnd_acme KEY=tmcp_live_... \
        python conformance/run.py

Exits non-zero if any check fails. Use it to self-certify a network or agent and to
back an "TrustMCP-compliant" badge (see README).
"""

from __future__ import annotations

import os
import sys

import httpx

from checks import run, summarize

SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "..", "spec", "schemas")


def main() -> int:
    network = os.environ.get("NETWORK", "http://localhost:8000")
    vendor = os.environ.get("VENDOR", "vnd_acme")
    key = os.environ.get("KEY")
    with httpx.Client(timeout=30, follow_redirects=True) as session:
        results = run(session, network, vendor, os.path.abspath(SCHEMA_DIR), key)

    print(f"\nTrustMCP conformance — {network} / {vendor}\n" + "-" * 48)
    for name, ok, detail in results:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}" + (f" — {detail}" if detail and not ok else ""))
    passed, total = summarize(results)
    print("-" * 48)
    print(f"  {passed}/{total} checks passed\n")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
