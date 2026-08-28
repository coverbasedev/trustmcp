"""Minimal in-process fixed-window rate limiter for public endpoints.

Good enough as a first line of defense for a single instance; put a real limiter
(API gateway / WAF) in front for multi-instance production. Disabled when
TRUSTMCP_RATE_LIMIT_PER_MINUTE <= 0."""

from __future__ import annotations

import threading
import time

from fastapi import Depends, HTTPException, Request, status

from .config import Settings, get_settings

_lock = threading.Lock()
_buckets: dict[str, tuple[int, int]] = {}  # key -> (window_start_epoch_min, count)


def _hit(key: str, limit: int) -> bool:
    now_min = int(time.time() // 60)
    with _lock:
        start, count = _buckets.get(key, (now_min, 0))
        if start != now_min:
            start, count = now_min, 0
        count += 1
        _buckets[key] = (start, count)
        return count <= limit


def rate_limit(bucket: str):
    """Dependency factory: limit by client IP within a named bucket."""

    def _dep(request: Request, settings: Settings = Depends(get_settings)) -> None:
        limit = settings.rate_limit_per_minute
        if limit <= 0:
            return
        ip = request.client.host if request.client else "unknown"
        if not _hit(f"{bucket}:{ip}", limit):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS, "rate limit exceeded, try again shortly"
            )

    return _dep
