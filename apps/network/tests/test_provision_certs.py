from __future__ import annotations

import app.routers.manage as manage
from app import provision_certs
from tests.conftest import owner_headers


def _verified_provisioning_domain(client, vendor, monkeypatch):
    """Add + verify a custom domain, leaving it in the verified/provisioning state
    (ownership proven, edge reachable, but no cert serving yet)."""
    vid, owner = vendor
    h = owner_headers(owner)
    add = client.post(
        f"/v1/vendors/{vid}/custom-domain", headers=h, json={"domain": "trust.example.com"}
    ).json()
    monkeypatch.setattr(
        manage, "doh_resolve", lambda name, rtype: [add["txt_value"]] if rtype == "TXT" else []
    )
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: True)
    body = client.post(f"/v1/vendors/{vid}/custom-domain/verify", headers=h).json()
    assert body["status"] == "verified" and body["tls"] == "provisioning"
    return vid, h


def test_sweep_flips_to_active_when_serving(client, vendor, monkeypatch):
    vid, h = _verified_provisioning_domain(client, vendor, monkeypatch)
    # The cert is now live; the sweep should mark the domain active.
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: True)
    assert provision_certs.run() == 1
    cd = client.get(f"/v1/vendors/{vid}/custom-domain", headers=h).json()
    assert cd["status"] == "active"
    assert cd["tls"] == "active"
    assert cd["last_error"] is None


def test_sweep_is_idempotent_once_active(client, vendor, monkeypatch):
    _verified_provisioning_domain(client, vendor, monkeypatch)
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: True)
    assert provision_certs.run() == 1
    # Already active -> nothing to do on the next sweep.
    assert provision_certs.run() == 0


def test_sweep_keeps_blocked_when_edge_unreachable(client, vendor, monkeypatch):
    vid, h = _verified_provisioning_domain(client, vendor, monkeypatch)
    # Edge target still doesn't resolve and nothing serves -> stays blocked, not active.
    monkeypatch.setattr(manage, "probe_https", lambda d, **k: False)
    monkeypatch.setattr(manage, "host_resolves", lambda n: False)
    assert provision_certs.run() == 0
    cd = client.get(f"/v1/vendors/{vid}/custom-domain", headers=h).json()
    assert cd["status"] == "verified"
    assert cd["tls"] == "blocked"
