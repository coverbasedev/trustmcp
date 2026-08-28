from __future__ import annotations

from tests.conftest import owner_headers


def _artifact(client, vid, owner, type_="soc2_type2"):
    return client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=owner_headers(owner),
        json={"type": type_, "issued_at": "2026-01-15", "access": "key_required"},
    ).json()


def test_badge_links_to_evidence_artifact(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    art = _artifact(client, vid, owner)

    r = client.put(
        f"/v1/vendors/{vid}/badges",
        headers=h,
        json={"badges": [{"name": "SOC 2 Type II", "standard": "soc2_type2",
                          "evidence_artifact_id": art["id"]}]},
    )
    assert r.status_code == 200, r.text

    badges = client.get(f"/v1/vendors/{vid}/manage/badges", headers=h).json()["badges"]
    assert badges[0]["evidence_artifact_id"] == art["id"]
    assert badges[0]["evidence"]["id"] == art["id"]
    assert badges[0]["evidence"]["access"] == "key_required"


def test_badge_rejects_foreign_evidence_id(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    r = client.put(
        f"/v1/vendors/{vid}/badges",
        headers=h,
        json={"badges": [{"name": "ISO 27001", "evidence_artifact_id": "art_does_not_exist"}]},
    )
    assert r.status_code == 200
    badges = client.get(f"/v1/vendors/{vid}/manage/badges", headers=h).json()["badges"]
    assert badges[0]["evidence_artifact_id"] is None
    assert badges[0]["evidence"] is None


def test_public_profile_exposes_badge_evidence(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    art = _artifact(client, vid, owner, type_="iso_27001")
    client.put(
        f"/v1/vendors/{vid}/badges",
        headers=h,
        json={"badges": [{"name": "ISO 27001", "standard": "iso27001",
                          "evidence_artifact_id": art["id"]}]},
    )
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    pub = client.get(f"/v1/vendors/{vid}/public").json()
    assert pub["badges"][0]["evidence"]["id"] == art["id"]
    assert pub["badges"][0]["evidence"]["access"] == "key_required"


def test_badge_validity_dates_round_trip(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(
        f"/v1/vendors/{vid}/badges",
        headers=h,
        json={"badges": [{"name": "SOC 2 Type II", "standard": "soc2_type2",
                          "issued_on": "2026-01-01", "valid_until": "2026-12-31"}]},
    )
    badges = client.get(f"/v1/vendors/{vid}/manage/badges", headers=h).json()["badges"]
    assert badges[0]["issued_on"] == "2026-01-01"
    assert badges[0]["valid_until"] == "2026-12-31"

    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    pub = client.get(f"/v1/vendors/{vid}/public").json()
    assert pub["badges"][0]["valid_until"] == "2026-12-31"


def test_logo_upload_and_serve(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32  # minimal PNG-ish bytes

    r = client.post(
        f"/v1/vendors/{vid}/branding/logo",
        headers=h,
        files={"file": ("logo.png", png, "image/png")},
    )
    assert r.status_code == 200, r.text
    logo_url = r.json()["logo_url"]
    # Path is stable; a per-upload `?v=` cache-buster is appended so re-uploads
    # don't keep serving the previous logo from browser/CDN cache.
    assert f"/v1/vendors/{vid}/branding/logo?v=" in logo_url

    # The branding now carries the stable public URL.
    v = client.get(f"/v1/vendors/{vid}", headers=h).json()
    assert v["branding"]["logo_url"] == logo_url

    # The public serve route streams the bytes back.
    served = client.get(f"/v1/vendors/{vid}/branding/logo")
    assert served.status_code == 200
    assert served.content == png
    assert served.headers["content-type"].startswith("image/png")


def test_logo_upload_rejects_non_image(client, vendor):
    vid, owner = vendor
    r = client.post(
        f"/v1/vendors/{vid}/branding/logo",
        headers=owner_headers(owner),
        files={"file": ("evil.txt", b"not an image", "text/plain")},
    )
    assert r.status_code == 400
