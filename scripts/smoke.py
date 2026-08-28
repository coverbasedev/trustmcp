#!/usr/bin/env python3
"""TrustMCP deployment smoke test.

Verifies a live deployment end-to-end: the network is up and reachable, the web
app serves, real authentication is configured, and each optional integration
(email/SMTP, Anthropic "Ask", PostHog, Sentry, S3, signing key) is wired.

It reads the web app's service-token-gated diagnostics endpoint, which in turn
reports the network's diagnostics — so one run covers the whole system. No
secret values are printed; only configured/not-configured status.

Usage:
    WEB=https://trustmcp.app \\
    NETWORK=https://network.trustmcp.app \\
    TRUSTMCP_SERVICE_TOKEN=... \\
    python3 scripts/smoke.py

All three are optional; WEB/NETWORK default to the production URLs. Without the
service token the public health checks still run (integration detail is skipped).
Exit code is non-zero if any hard check fails.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

WEB = os.environ.get("WEB", "https://trustmcp.app").rstrip("/")
NETWORK = os.environ.get("NETWORK", "https://network.trustmcp.app").rstrip("/")
TOKEN = os.environ.get("TRUSTMCP_SERVICE_TOKEN", "")

OK, BAD, WARN, SKIP = "\033[32m✓\033[0m", "\033[31m✗\033[0m", "\033[33m!\033[0m", "·"
failures = 0


def mark(passed: bool, label: str, detail: str = "") -> None:
    global failures
    if not passed:
        failures += 1
    print(f"  {OK if passed else BAD} {label}" + (f"  ({detail})" if detail else ""))


def feature(configured: bool, label: str) -> None:
    # Optional features: report status but never fail the run on them.
    print(f"  {OK if configured else WARN} {label}: {'configured' if configured else 'not configured'}")


def get(url: str, headers: dict | None = None, timeout: float = 15.0):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # connection refused, DNS, TLS, timeout…
        return None, str(e)


def main() -> int:
    print(f"\nTrustMCP smoke test\n  web={WEB}\n  network={NETWORK}\n")

    print("Network")
    status, body = get(f"{NETWORK}/health")
    healthy = status == 200 and '"status":"ok"' in body.replace(" ", "")
    mark(healthy, "GET /health", detail=str(status) if status else body)
    status, _ = get(f"{NETWORK}/readyz")
    mark(status == 200, "GET /readyz (database reachable)", detail=str(status))

    print("\nWeb")
    status, _ = get(f"{WEB}/")
    mark(status == 200, "GET / (home)", detail=str(status))
    status, body = get(f"{WEB}/login")
    mark(status == 200, "GET /login", detail=str(status))

    if not TOKEN:
        print(
            "\n· TRUSTMCP_SERVICE_TOKEN not set — skipping integration diagnostics.\n"
            "  Set it to verify auth/email/Anthropic/PostHog/Sentry/S3 wiring.\n"
        )
        return 1 if failures else 0

    print("\nDiagnostics (web → network)")
    status, body = get(
        f"{WEB}/api/diagnostics", headers={"X-TrustMCP-Service-Token": TOKEN}
    )
    if status != 200:
        mark(False, "GET /api/diagnostics", detail=f"HTTP {status}: {body[:120]}")
        return 1
    data = json.loads(body)
    w, n = data.get("web", {}), data.get("network", {})
    auth = w.get("auth", {})

    print("\nAuthentication (web)")
    mark(w.get("auth_secret_set", False), "AUTH_SECRET set")
    mark(w.get("real_auth_configured", False), "at least one real sign-in method")
    feature(auth.get("github"), "GitHub OAuth")
    feature(auth.get("google"), "Google OAuth")
    feature(auth.get("sso"), "Enterprise SSO (OIDC)")
    feature(auth.get("email"), "Email sign-in link")
    # Dev login is a no-password bypass; it must never be on in production.
    mark(not auth.get("dev_login"), "dev login disabled")

    print("\nProduct analytics & error tracking (web)")
    feature(w.get("analytics", {}).get("posthog"), "PostHog")
    feature(w.get("sentry", {}).get("browser"), "Sentry (browser)")
    feature(w.get("sentry", {}).get("server"), "Sentry (server)")

    print("\nNetwork integrations")
    mark(bool(n.get("reachable")), "web → network reachable", detail=str(n.get("status") or n.get("error") or ""))
    if n.get("reachable"):
        mark(n.get("environment") == "production", "TRUSTMCP_ENVIRONMENT", detail=str(n.get("environment")))
        mark(n.get("database") == "postgresql", "database", detail=str(n.get("database")))
        mark(bool(n.get("signing_key_stable")), "stable signing key")
        feature(n.get("smtp_configured"), "SMTP (notifications + nudges)")
        feature(n.get("ask_enabled"), f"Anthropic Ask widget [{n.get('ask_model', '?')}]")
        feature(n.get("sentry_configured"), "Sentry (network)")
        feature(n.get("s3_configured"), "S3/R2 artifact storage")
        feature(n.get("web_base_url_set"), "web base URL (email links)")
        for blocker in n.get("production_blockers", []):
            mark(False, "production blocker", detail=blocker)
        for warning in n.get("production_warnings", []):
            print(f"  {WARN} {warning}")

    print()
    if failures:
        print(f"{BAD} {failures} hard check(s) failed.\n")
        return 1
    print(f"{OK} All hard checks passed.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
