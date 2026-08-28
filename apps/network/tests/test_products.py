from __future__ import annotations

from tests.conftest import owner_headers


def _create_with_products(client, service_token, names):
    r = client.post(
        "/v1/vendors",
        headers={"X-TrustMCP-Service-Token": service_token},
        json={"legal_name": "Multi Corp", "products": names, "domains": ["multi.com"]},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_create_vendor_with_multiple_products(client, service_token):
    body = _create_with_products(client, service_token, ["Platform", "Mobile", "API"])
    products = body["products"]
    assert [p["name"] for p in products] == ["Platform", "Mobile", "API"]
    assert all(p["id"].startswith("prd_") for p in products)
    # Legacy single product mirrors the first line for old consumers.
    assert body["product"] == "Platform"


def test_profile_update_adds_renames_and_removes_products(client, service_token):
    body = _create_with_products(client, service_token, ["Platform", "Mobile"])
    vid, owner = body["id"], body["owner_token"]
    h = owner_headers(owner)
    platform_id = body["products"][0]["id"]

    # Rename Platform (keep id), drop Mobile, add a new Analytics line.
    r = client.put(
        f"/v1/vendors/{vid}/profile",
        headers=h,
        json={"products": [{"id": platform_id, "name": "Core Platform"}, {"name": "Analytics"}]},
    )
    assert r.status_code == 200, r.text
    products = r.json()["products"]
    assert [p["name"] for p in products] == ["Core Platform", "Analytics"]
    assert products[0]["id"] == platform_id  # id preserved on rename
    assert products[1]["id"] != platform_id and products[1]["id"].startswith("prd_")


def test_artifact_product_association_and_pruning(client, service_token):
    body = _create_with_products(client, service_token, ["Platform", "Mobile"])
    vid, owner = body["id"], body["owner_token"]
    h = owner_headers(owner)
    platform_id = body["products"][0]["id"]
    mobile_id = body["products"][1]["id"]

    # Associate an artifact with both products + an unknown id (which is dropped).
    art = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "soc2_type2", "issued_at": "2026-01-15",
              "product_ids": [platform_id, mobile_id, "prd_bogus"]},
    ).json()
    assert sorted(art["product_ids"]) == sorted([platform_id, mobile_id])

    # Removing the Mobile product line prunes it from the artifact association.
    client.put(
        f"/v1/vendors/{vid}/profile",
        headers=h,
        json={"products": [{"id": platform_id, "name": "Platform"}]},
    )
    arts = client.get(f"/v1/vendors/{vid}/artifacts", headers=h).json()
    assert arts[0]["product_ids"] == [platform_id]


def test_public_profile_exposes_products(client, service_token):
    body = _create_with_products(client, service_token, ["Platform"])
    vid, owner = body["id"], body["owner_token"]
    h = owner_headers(owner)
    pid = body["products"][0]["id"]
    art = client.post(
        f"/v1/vendors/{vid}/artifacts",
        headers=h,
        json={"type": "policy", "issued_at": "2026-01-15", "access": "public",
              "product_ids": [pid]},
    ).json()
    client.post(f"/v1/vendors/{vid}/artifacts/{art['id']}/content", headers=h,
                files={"file": ("p.pdf", b"%PDF x", "application/pdf")})
    client.post(f"/v1/vendors/{vid}/publish", headers=h)

    pub = client.get(f"/v1/vendors/{vid}/public").json()
    assert [p["name"] for p in pub["vendor"]["products"]] == ["Platform"]
    assert pub["artifacts"][0]["product_ids"] == [pid]
