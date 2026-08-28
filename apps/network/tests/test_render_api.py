from __future__ import annotations

import json

import pytest

import app.render_api as render_api
from app.config import Settings


def _settings() -> Settings:
    return Settings(render_api_key="rnd_test", render_service_id="srv-123")


class FakeResp:
    def __init__(self, status_code: int, json_data=None):
        self.status_code = status_code
        self._json = json_data
        self.text = json.dumps(json_data) if json_data is not None else ""
        self.content = self.text.encode()

    def json(self):
        if self._json is None:
            raise ValueError("no json body")
        return self._json


def _domain(name: str, status: str, did: str = "cd-1") -> dict:
    return {"id": did, "name": name, "verificationStatus": status}


def test_unconfigured_raises():
    # No api key / service id -> never silently hits the network.
    with pytest.raises(render_api.RenderError):
        render_api.add_custom_domain(Settings(), "trust.acme.com")


def test_add_custom_domain_created(monkeypatch):
    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["auth"] = headers["Authorization"]
        return FakeResp(201, _domain(json["name"], "unverified"))

    monkeypatch.setattr(render_api.httpx, "post", fake_post)
    out = render_api.add_custom_domain(_settings(), "trust.acme.com")
    assert out == {"id": "cd-1", "name": "trust.acme.com", "verification_status": "unverified"}
    assert captured["url"].endswith("/v1/services/srv-123/custom-domains")
    assert captured["json"] == {"name": "trust.acme.com"}
    assert captured["auth"] == "Bearer rnd_test"


def test_add_custom_domain_handles_list_response(monkeypatch):
    # Regression: Render's create endpoint returns a LIST, not a dict. _normalize must
    # not choke on it (previously raised AttributeError and crashed the cron).
    payload = [
        _domain("other.acme.com", "unverified", "cd-0"),
        {"customDomain": _domain("trust.acme.com", "unverified", "cd-7")},
    ]
    monkeypatch.setattr(render_api.httpx, "post", lambda *a, **k: FakeResp(201, payload))
    out = render_api.add_custom_domain(_settings(), "trust.acme.com")
    # Picks the entry matching the requested name, across flat + wrapped shapes.
    assert out["id"] == "cd-7"
    assert out["name"] == "trust.acme.com"


def test_add_custom_domain_idempotent_on_conflict(monkeypatch):
    # Render returns 409 when the domain already exists; we fall back to GET.
    monkeypatch.setattr(
        render_api.httpx, "post", lambda *a, **k: FakeResp(409, {"message": "exists"})
    )
    existing = {"customDomain": _domain("trust.acme.com", "verified", "cd-9")}
    monkeypatch.setattr(render_api.httpx, "get", lambda *a, **k: FakeResp(200, existing))
    out = render_api.add_custom_domain(_settings(), "trust.acme.com")
    assert out["id"] == "cd-9"
    assert out["verification_status"] == "verified"


def test_get_custom_domain_404_returns_none(monkeypatch):
    monkeypatch.setattr(render_api.httpx, "get", lambda *a, **k: FakeResp(404))
    assert render_api.get_custom_domain(_settings(), "trust.acme.com") is None


def test_add_custom_domain_error_raises(monkeypatch):
    monkeypatch.setattr(
        render_api.httpx, "post", lambda *a, **k: FakeResp(500, {"message": "boom"})
    )
    with pytest.raises(render_api.RenderError):
        render_api.add_custom_domain(_settings(), "trust.acme.com")


def test_ensure_custom_domain_registers_then_verifies(monkeypatch):
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(url)
        status = "verified" if url.endswith("/verify") else "unverified"
        code = 200 if url.endswith("/verify") else 201
        return FakeResp(code, _domain("trust.acme.com", status))

    monkeypatch.setattr(render_api.httpx, "post", fake_post)
    out = render_api.ensure_custom_domain(_settings(), "trust.acme.com")
    assert out["verification_status"] == "verified"
    assert any(u.endswith("/custom-domains") for u in calls)  # created
    assert any(u.endswith("/verify") for u in calls)  # then verified
