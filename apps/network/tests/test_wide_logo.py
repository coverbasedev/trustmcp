from __future__ import annotations

from tests.conftest import owner_headers

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32  # minimal PNG-ish bytes


def test_wide_logo_upload_and_serve(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)

    r = client.post(
        f"/v1/vendors/{vid}/branding/logo/wide",
        headers=h,
        files={"file": ("wide.png", PNG, "image/png")},
    )
    assert r.status_code == 200, r.text
    wide_url = r.json()["wide_logo_url"]
    # Path is stable; a per-upload `?v=` cache-buster is appended (see square-logo
    # test) so re-uploads don't keep serving the previous logo from cache.
    assert f"/v1/vendors/{vid}/branding/logo/wide?v=" in wide_url

    # The branding carries the stable public URL.
    v = client.get(f"/v1/vendors/{vid}", headers=h).json()
    assert v["branding"]["wide_logo_url"] == wide_url

    # The public serve route streams the bytes back.
    served = client.get(f"/v1/vendors/{vid}/branding/logo/wide")
    assert served.status_code == 200
    assert served.content == PNG
    assert served.headers["content-type"].startswith("image/png")


def test_wide_logo_rejects_non_image(client, vendor):
    vid, owner = vendor
    r = client.post(
        f"/v1/vendors/{vid}/branding/logo/wide",
        headers=owner_headers(owner),
        files={"file": ("evil.txt", b"not an image", "text/plain")},
    )
    assert r.status_code == 400
    assert "wide logo" in r.json()["detail"]


def test_wide_logo_serve_404_when_absent(client, vendor):
    vid, _ = vendor
    assert client.get(f"/v1/vendors/{vid}/branding/logo/wide").status_code == 404


def test_wide_logo_survives_profile_save(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    wide_url = client.post(
        f"/v1/vendors/{vid}/branding/logo/wide",
        headers=h,
        files={"file": ("wide.png", PNG, "image/png")},
    ).json()["wide_logo_url"]

    # A routine profile save that echoes the same wide_logo_url must not orphan it.
    client.put(
        f"/v1/vendors/{vid}/profile",
        headers=h,
        json={"branding": {"display_name": "Acme", "wide_logo_url": wide_url}},
    )
    served = client.get(f"/v1/vendors/{vid}/branding/logo/wide")
    assert served.status_code == 200
    assert served.content == PNG


def test_wide_logo_in_public_profile(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    wide_url = client.post(
        f"/v1/vendors/{vid}/branding/logo/wide",
        headers=h,
        files={"file": ("wide.png", PNG, "image/png")},
    ).json()["wide_logo_url"]
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    pub = client.get(f"/v1/vendors/{vid}/public").json()
    assert pub["vendor"]["branding"]["wide_logo_url"] == wide_url
