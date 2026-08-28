"""Resource presentation: what shows on the public trust center, and in what order."""

from __future__ import annotations

from tests.conftest import owner_headers


def add(client, vid, owner, **fields):
    body = {"type": "policy", "issued_at": "2026-01-01"}
    body.update(fields)
    return client.post(
        f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner), json=body
    ).json()


def public(client, vid):
    return client.get(f"/v1/vendors/{vid}/public").json()


def test_defaults_match_the_previous_behavior(client, populated_vendor):
    """A vendor who never touches presentation sees no change."""
    vid, _, _ = populated_vendor
    display = public(client, vid)["resources"]["display"]
    assert display["layout"] == "list"
    assert display["group_by"] == "category"
    assert display["show_dates"] is True
    assert display["show_hashes"] is False


def test_hidden_resources_are_absent_from_the_public_profile(client, populated_vendor):
    vid, owner, aid = populated_vendor
    assert any(a["id"] == aid for a in public(client, vid)["artifacts"])

    client.patch(
        f"/v1/vendors/{vid}/artifacts/{aid}", headers=owner_headers(owner), json={"hidden": True}
    )
    profile = public(client, vid)
    assert all(a["id"] != aid for a in profile["artifacts"])
    assert profile["resources"]["display"]


def test_hiding_is_not_the_same_as_making_private(client, populated_vendor):
    """`hidden` controls the listing; `access` controls entitlement. A hidden
    public artifact is still downloadable by anyone holding its id."""
    vid, owner, aid = populated_vendor
    client.patch(
        f"/v1/vendors/{vid}/artifacts/{aid}",
        headers=owner_headers(owner),
        json={"hidden": True, "access": "public"},
    )
    r = client.get(f"/v1/vendors/{vid}/artifacts/{aid}/public")
    assert r.status_code == 200


def test_position_orders_within_a_category(client, vendor):
    vid, owner = vendor
    first = add(client, vid, owner, title="Zeta", category="Policies", position=1)
    second = add(client, vid, owner, title="Alpha", category="Policies", position=0)
    client.post(f"/v1/vendors/{vid}/publish", headers=owner_headers(owner))

    groups = public(client, vid)["resources"]["groups"]
    policies = next(g for g in groups if g["title"] == "Policies")
    assert [r["id"] for r in policies["resources"]] == [second["id"], first["id"]]


def test_equal_positions_fall_back_to_newest_first(client, vendor):
    vid, owner = vendor
    older = add(client, vid, owner, title="Old", issued_at="2025-01-01")
    newer = add(client, vid, owner, title="New", issued_at="2026-01-01")
    client.post(f"/v1/vendors/{vid}/publish", headers=owner_headers(owner))
    ids = [a["id"] for a in public(client, vid)["artifacts"]]
    assert ids == [newer["id"], older["id"]]


def test_category_order_is_respected_and_new_categories_still_appear(client, vendor):
    vid, owner = vendor
    add(client, vid, owner, title="A", category="Privacy")
    add(client, vid, owner, title="B", category="Compliance")
    add(client, vid, owner, title="C", category="Zebra")
    client.post(f"/v1/vendors/{vid}/publish", headers=owner_headers(owner))

    client.put(
        f"/v1/vendors/{vid}/resource-display",
        headers=owner_headers(owner),
        json={"category_order": ["Compliance", "Privacy"]},
    )
    titles = [g["title"] for g in public(client, vid)["resources"]["groups"]]
    # Named categories first, in order; unnamed ones follow rather than vanishing.
    assert titles == ["Compliance", "Privacy", "Zebra"]


def test_grouping_by_type(client, vendor):
    vid, owner = vendor
    add(client, vid, owner, type="pentest", title="Pen test")
    add(client, vid, owner, type="policy", title="Policy")
    client.post(f"/v1/vendors/{vid}/publish", headers=owner_headers(owner))
    client.put(
        f"/v1/vendors/{vid}/resource-display",
        headers=owner_headers(owner),
        json={"group_by": "type"},
    )
    assert {g["title"] for g in public(client, vid)["resources"]["groups"]} == {
        "pentest", "policy"
    }


def test_featured_resources_get_their_own_band(client, vendor):
    vid, owner = vendor
    featured = add(client, vid, owner, title="Star", featured=True)
    add(client, vid, owner, title="Ordinary")
    client.post(f"/v1/vendors/{vid}/publish", headers=owner_headers(owner))

    resources = public(client, vid)["resources"]
    assert [r["id"] for r in resources["featured"]] == [featured["id"]]

    client.put(
        f"/v1/vendors/{vid}/resource-display",
        headers=owner_headers(owner),
        json={"feature_band": False},
    )
    assert public(client, vid)["resources"]["featured"] == []


def test_hashes_are_shown_only_when_asked_for(client, populated_vendor):
    vid, owner, _ = populated_vendor
    assert "sha256" not in public(client, vid)["artifacts"][0]
    client.put(
        f"/v1/vendors/{vid}/resource-display",
        headers=owner_headers(owner),
        json={"show_hashes": True},
    )
    assert public(client, vid)["artifacts"][0]["sha256"]


def test_bulk_presentation_update(client, vendor):
    vid, owner = vendor
    a = add(client, vid, owner, title="A")
    b = add(client, vid, owner, title="B")
    r = client.put(
        f"/v1/vendors/{vid}/artifacts/presentation",
        headers=owner_headers(owner),
        json={"items": [
            {"id": a["id"], "position": 2, "description": "second"},
            {"id": b["id"], "position": 1, "featured": True},
        ]},
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 2
    by_id = {x["id"]: x for x in r.json()["artifacts"]}
    assert by_id[a["id"]]["position"] == 2
    assert by_id[a["id"]]["description"] == "second"
    assert by_id[b["id"]]["featured"] is True


def test_bulk_presentation_rejects_an_unknown_artifact(client, vendor):
    vid, owner = vendor
    r = client.put(
        f"/v1/vendors/{vid}/artifacts/presentation",
        headers=owner_headers(owner),
        json={"items": [{"id": "art_nope", "position": 1}]},
    )
    assert r.status_code == 404


def test_display_settings_survive_partial_updates(client, vendor):
    vid, owner = vendor
    client.put(
        f"/v1/vendors/{vid}/resource-display",
        headers=owner_headers(owner),
        json={"layout": "grid"},
    )
    client.put(
        f"/v1/vendors/{vid}/resource-display",
        headers=owner_headers(owner),
        json={"show_dates": False},
    )
    display = client.get(
        f"/v1/vendors/{vid}/manage/resource-display", headers=owner_headers(owner)
    ).json()["display"]
    assert display["layout"] == "grid"
    assert display["show_dates"] is False
    assert display["group_by"] == "category"  # untouched default still applies


def test_manage_view_lists_the_categories_actually_in_use(client, vendor):
    vid, owner = vendor
    add(client, vid, owner, category="Compliance")
    add(client, vid, owner, category="Privacy")
    body = client.get(
        f"/v1/vendors/{vid}/manage/resource-display", headers=owner_headers(owner)
    ).json()
    assert body["categories_in_use"] == ["Compliance", "Privacy"]


def test_presentation_reaches_oscal_back_matter(client, populated_vendor):
    """A description set for the public page is the same description OSCAL carries."""
    from tests.conftest import grant_key

    vid, owner, aid = populated_vendor
    client.patch(
        f"/v1/vendors/{vid}/artifacts/{aid}",
        headers=owner_headers(owner),
        json={"description": "Independently audited annual report."},
    )
    key = grant_key(client, vid, owner)
    document = client.get(
        f"/v1/vendors/{vid}/oscal/cdef", headers={"Authorization": f"Bearer {key}"}
    ).json()
    resources = document["component-definition"]["back-matter"]["resources"]
    assert any(
        r.get("description") == "Independently audited annual report." for r in resources
    )
