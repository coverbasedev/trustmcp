from __future__ import annotations

import app.webhooks as webhooks


class _Resp:
    def __init__(self, status_code: int):
        self.status_code = status_code


def test_deliver_retries_on_5xx_then_gives_up(monkeypatch):
    calls = {"n": 0}

    def fake_post(url, content, headers, timeout):
        calls["n"] += 1
        return _Resp(503)

    monkeypatch.setattr(webhooks.httpx, "post", fake_post)
    monkeypatch.setattr(webhooks.time, "sleep", lambda s: None)  # no real backoff
    ok = webhooks.deliver("https://x", "secret", "key.requested", {"a": 1}, attempts=3)
    assert ok is False
    assert calls["n"] == 3


def test_deliver_does_not_retry_on_4xx(monkeypatch):
    calls = {"n": 0}

    def fake_post(url, content, headers, timeout):
        calls["n"] += 1
        return _Resp(400)

    monkeypatch.setattr(webhooks.httpx, "post", fake_post)
    monkeypatch.setattr(webhooks.time, "sleep", lambda s: None)
    ok = webhooks.deliver("https://x", None, "key.requested", {}, attempts=4)
    assert ok is False
    assert calls["n"] == 1  # permanent client error — no retry


def test_deliver_succeeds_first_try(monkeypatch):
    monkeypatch.setattr(webhooks.httpx, "post", lambda url, **kw: _Resp(200))
    assert webhooks.deliver("https://x", "s", "e", {}) is True


def test_deliver_retries_on_429(monkeypatch):
    seq = iter([_Resp(429), _Resp(200)])

    def fake_post(url, content, headers, timeout):
        return next(seq)

    monkeypatch.setattr(webhooks.httpx, "post", fake_post)
    monkeypatch.setattr(webhooks.time, "sleep", lambda s: None)
    assert webhooks.deliver("https://x", "s", "e", {}, attempts=3) is True
