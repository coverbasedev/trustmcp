"""Outbound vendor webhooks for access events (request / grant / revoke / deny).

Best-effort POST with an HMAC-SHA256 signature header so the receiver can verify
authenticity. No-ops when the vendor has no webhook configured.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time

import httpx

log = logging.getLogger("trustmcp.webhooks")


def sign_payload(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def deliver(url: str, secret: str | None, event: str, data: dict, *, attempts: int = 4) -> bool:
    """Deliver a signed webhook with bounded exponential backoff (1s, 2s, 4s).

    Runs off the request path in a BackgroundTask, so a few seconds of sleep is
    acceptable for low webhook volume. Retries on network errors and 5xx/408/429;
    other 4xx are treated as permanent (the receiver rejected the payload). A
    durable outbox + delivery worker is the correct long-term design; this is a
    pragmatic stopgap with no queue.
    """
    payload = {"event": event, "data": data}
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    headers = {"content-type": "application/json", "user-agent": "trustmcp-network/0.1"}
    if secret:
        headers["X-TrustMCP-Signature"] = sign_payload(secret, body)
    for i in range(attempts):
        try:
            r = httpx.post(url, content=body, headers=headers, timeout=10)
            if r.status_code < 400:
                return True
            # Permanent client errors are not worth retrying.
            if 400 <= r.status_code < 500 and r.status_code not in (408, 429):
                log.warning(
                    "[webhook:rejected] url=%s event=%s status=%s", url, event, r.status_code
                )
                return False
            log.warning(
                "[webhook:retryable] url=%s event=%s status=%s attempt=%s",
                url, event, r.status_code, i + 1,
            )
        except Exception as e:  # pragma: no cover - network dependent
            log.warning("[webhook:error] url=%s event=%s err=%s attempt=%s", url, event, e, i + 1)
        if i < attempts - 1:
            time.sleep(2**i)
    return False
