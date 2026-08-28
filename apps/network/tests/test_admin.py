from __future__ import annotations

from tests.conftest import owner_headers


def test_update_artifact_metadata(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    a = client.post(
        f"/v1/vendors/{vid}/artifacts", headers=h,
        json={"type": "sbom", "issued_at": "2026-01-01"},
    ).json()
    r = client.patch(
        f"/v1/vendors/{vid}/artifacts/{a['id']}", headers=h,
        json={"title": "Core SBOM", "format": "cyclonedx-1.5", "valid_until": "2027-01-01"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Core SBOM"
    assert body["format"] == "cyclonedx-1.5"
    assert body["valid_until"] == "2027-01-01"


def test_delete_vendor(client, vendor, service_token):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(f"/v1/vendors/{vid}/artifacts", headers=h,
                json={"type": "soc2_type2", "issued_at": "2026-01-01"})
    assert client.delete(f"/v1/vendors/{vid}", headers=h).status_code == 204
    # Vendor is gone: owner-authed read now 404s.
    assert client.get(f"/v1/vendors/{vid}", headers=h).status_code == 404


def test_rate_limiter_trips():
    import app.ratelimit as rl

    rl._buckets.clear()
    assert all(rl._hit("k", 3) for _ in range(3))
    assert rl._hit("k", 3) is False  # 4th in the same window
