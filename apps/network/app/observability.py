"""Structured request logging + optional Sentry, kept dependency-light."""

from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware

from .config import Settings

log = logging.getLogger("trustmcp.access")


def configure_logging(settings: Settings) -> None:
    level = logging.DEBUG if settings.environment == "development" else logging.INFO
    logging.basicConfig(
        level=level,
        format='{"level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    )


def init_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.environment,
                        traces_sample_rate=0.1)
        log.info("sentry initialized")
    except Exception as e:  # pragma: no cover
        log.warning("sentry init failed: %s", e)


class AccessLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        start = time.perf_counter()
        response = await call_next(request)
        dur_ms = round((time.perf_counter() - start) * 1000, 1)
        response.headers["X-Request-Id"] = rid
        log.info(
            "rid=%s %s %s -> %s %sms",
            rid, request.method, request.url.path, response.status_code, dur_ms,
        )
        return response
