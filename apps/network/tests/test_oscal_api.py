"""The OSCAL HTTP surface: point-in-time reads, the change feed, and import."""

from __future__ import annotations

from tests.conftest import grant_key, owner_headers


def bearer(key: str) -> dict:
    return {"Authorization": f"Bearer {key}"}


# --- Network-level, unauthenticated ------------------------------------------


def test_capabilities_is_public(client):
    r = client.get("/v1/oscal/capabilities")
    assert r.status_code == 200
    body = r.json()
    assert "component-definition" in {m["name"] for m in body["vendor_models"]}
    assert set(body["formats"]) == {"json", "yaml", "xml"}


def test_catalog_and_profile_are_public(client):
    assert client.get("/v1/oscal/catalog").status_code == 200
    assert client.get("/v1/oscal/profile/soc2").status_code == 200
    assert client.get("/v1/oscal/profile/nope").status_code == 404


def test_public_validate_endpoint(client):
    r = client.post("/v1/oscal/validate", json={"catalog": {"uuid": "not-a-uuid"}})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    assert any("uuid" in issue["message"] for issue in body["issues"])


# --- Point-in-time -----------------------------------------------------------


def test_every_model_is_reachable(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    for model in (
        "component-definition",
        "system-security-plan",
        "assessment-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ):
        r = client.get(f"/v1/vendors/{vid}/oscal/{model}", headers=bearer(key))
        assert r.status_code == 200, f"{model}: {r.text}"
        assert model in r.json()
        assert r.headers["X-TrustMCP-OSCAL-Version"]
        assert r.headers["X-TrustMCP-OSCAL-Digest"]
        assert r.headers["X-TrustMCP-Signature"]


def test_aliases_work_over_http(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    r = client.get(f"/v1/vendors/{vid}/oscal/poam", headers=bearer(key))
    assert r.status_code == 200
    assert "plan-of-action-and-milestones" in r.json()


def test_format_negotiation(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    yaml_response = client.get(
        f"/v1/vendors/{vid}/oscal/cdef?format=yaml", headers=bearer(key)
    )
    assert yaml_response.status_code == 200
    assert yaml_response.headers["content-type"].startswith("application/yaml")
    assert "component-definition:" in yaml_response.text

    xml_response = client.get(
        f"/v1/vendors/{vid}/oscal/cdef?format=xml", headers=bearer(key)
    )
    assert xml_response.status_code == 200
    assert xml_response.text.startswith("<?xml")


def test_signature_covers_the_bytes_actually_returned(client, populated_vendor):
    """A consumer that pulled XML must be able to verify the XML it holds."""
    import base64

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    public_key = client.get("/v1/network/key").json()["public_key"]
    verifier = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key))

    for fmt in ("json", "yaml", "xml"):
        r = client.get(f"/v1/vendors/{vid}/oscal/cdef?format={fmt}", headers=bearer(key))
        signature = base64.b64decode(r.headers["X-TrustMCP-Signature"])
        verifier.verify(signature, r.content)  # raises if it does not match


def test_bad_format_is_rejected(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    r = client.get(f"/v1/vendors/{vid}/oscal/cdef?format=toml", headers=bearer(key))
    assert r.status_code == 400


def test_unknown_model_is_404(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    r = client.get(f"/v1/vendors/{vid}/oscal/nonsense", headers=bearer(key))
    assert r.status_code == 404


def test_framework_selection(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    r = client.get(
        f"/v1/vendors/{vid}/oscal/cdef?framework=soc2,iso_27001", headers=bearer(key)
    )
    assert r.status_code == 200
    caps = r.json()["component-definition"]["capabilities"]
    assert len(caps) == 2
    assert client.get(
        f"/v1/vendors/{vid}/oscal/cdef?framework=bogus", headers=bearer(key)
    ).status_code == 404


def test_oscal_requires_the_attestations_scope(client, populated_vendor):
    vid, owner, _ = populated_vendor
    manifest_only = grant_key(client, vid, owner, scope=["manifest"])
    r = client.get(f"/v1/vendors/{vid}/oscal/cdef", headers=bearer(manifest_only))
    assert r.status_code == 403
    assert client.get(f"/v1/vendors/{vid}/oscal/cdef").status_code == 401


def test_bundle_carries_digests_and_a_cursor(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    r = client.get(f"/v1/vendors/{vid}/oscal/bundle", headers=bearer(key))
    assert r.status_code == 200
    body = r.json()
    assert set(body["documents"]) == set(body["digests"])
    assert body["cursor"] >= 1  # publishing already logged a change
    assert body["oscal_version"]


def test_legacy_oscal_endpoint_still_works(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    r = client.get(
        f"/v1/vendors/{vid}/attestations/oscal?framework=soc2", headers=bearer(key)
    )
    assert r.status_code == 200
    assert "component-definition" in r.json()


# --- Continuous --------------------------------------------------------------


def test_changes_advance_as_evidence_changes(client, populated_vendor):
    vid, owner, aid = populated_vendor
    key = grant_key(client, vid, owner)

    first = client.get(f"/v1/vendors/{vid}/oscal/changes", headers=bearer(key)).json()
    assert first["changes"], "publishing should have logged a change"
    cursor = first["cursor"]

    client.patch(
        f"/v1/vendors/{vid}/artifacts/{aid}",
        headers=owner_headers(owner),
        json={"title": "SOC 2 Type II (2026)"},
    )
    second = client.get(
        f"/v1/vendors/{vid}/oscal/changes?since={cursor}", headers=bearer(key)
    ).json()
    assert [c["event"] for c in second["changes"]] == ["artifact.updated"]
    assert second["changes"][0]["subject"] == aid
    assert "component-definition" in second["changes"][0]["models"]

    # Nothing new since the latest cursor.
    third = client.get(
        f"/v1/vendors/{vid}/oscal/changes?since={second['cursor']}", headers=bearer(key)
    ).json()
    assert third["changes"] == []


def test_changes_can_be_filtered_by_model(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    client.put(
        f"/v1/vendors/{vid}/controls",
        headers=owner_headers(owner),
        json={"controls": [{"category": "X", "name": "Y", "status": "operating"}]},
    )
    r = client.get(
        f"/v1/vendors/{vid}/oscal/changes?models=assessment-plan", headers=bearer(key)
    )
    # A controls change does not invalidate the assessment plan, so it is filtered out.
    assert all(c["event"] != "controls.replaced" for c in r.json()["changes"])


def test_cursor_is_per_vendor(client, service_token, populated_vendor):
    """One vendor's activity must not advance another vendor's cursor."""
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    before = client.get(f"/v1/vendors/{vid}/oscal/changes", headers=bearer(key)).json()

    other = client.post(
        "/v1/vendors",
        headers={"X-TrustMCP-Service-Token": service_token},
        json={"legal_name": "Globex"},
    ).json()
    client.post(f"/v1/vendors/{other['id']}/publish", headers=owner_headers(other["owner_token"]))

    after = client.get(f"/v1/vendors/{vid}/oscal/changes", headers=bearer(key)).json()
    assert after["latest"] == before["latest"]
    # Sequences are gapless within a vendor, so a cursor is unambiguous.
    assert [c["sequence"] for c in after["changes"]] == list(
        range(1, len(after["changes"]) + 1)
    )


def test_subscription_lifecycle(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)

    r = client.post(
        f"/v1/vendors/{vid}/oscal/subscriptions",
        headers=bearer(key),
        json={
            "url": "https://grc.globex.com/hooks/trustmcp",
            "secret": "s3cret",
            "models": ["plan-of-action-and-milestones"],
        },
    )
    assert r.status_code == 201, r.text
    subscription_id = r.json()["id"]
    assert r.json()["status"] == "active"

    listed = client.get(f"/v1/vendors/{vid}/oscal/subscriptions", headers=bearer(key)).json()
    assert [s["id"] for s in listed["subscriptions"]] == [subscription_id]

    assert client.delete(
        f"/v1/vendors/{vid}/oscal/subscriptions/{subscription_id}", headers=bearer(key)
    ).status_code == 204
    after = client.get(f"/v1/vendors/{vid}/oscal/subscriptions", headers=bearer(key)).json()
    assert after["subscriptions"] == []


def test_subscription_rejects_plaintext_and_unknown_models(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    assert client.post(
        f"/v1/vendors/{vid}/oscal/subscriptions",
        headers=bearer(key),
        json={"url": "http://grc.globex.com/hook"},
    ).status_code == 400
    assert client.post(
        f"/v1/vendors/{vid}/oscal/subscriptions",
        headers=bearer(key),
        json={"url": "https://grc.globex.com/hook", "models": ["not-a-model"]},
    ).status_code == 400


def test_one_customer_cannot_see_anothers_subscription(client, populated_vendor):
    vid, owner, _ = populated_vendor
    first = grant_key(client, vid, owner)
    client.post(
        f"/v1/vendors/{vid}/oscal/subscriptions",
        headers=bearer(first),
        json={"url": "https://a.example/hook"},
    )
    second = grant_key(client, vid, owner)
    listed = client.get(f"/v1/vendors/{vid}/oscal/subscriptions", headers=bearer(second)).json()
    assert listed["subscriptions"] == []


# --- Import ------------------------------------------------------------------


def test_import_is_a_dry_run_by_default(client, populated_vendor):
    vid, owner, _ = populated_vendor
    key = grant_key(client, vid, owner)
    document = client.get(f"/v1/vendors/{vid}/oscal/cdef", headers=bearer(key)).json()

    r = client.post(
        f"/v1/vendors/{vid}/oscal/import",
        headers=owner_headers(owner),
        json={"document": document},
    )
    assert r.status_code == 200
    assert r.json()["applied"] is False
    assert r.json()["plan"]["counts"]["claims"] >= 1


def test_import_applies_claims_and_subprocessors(client, vendor, populated_vendor):
    """Import a document exported from one vendor into a second, empty one."""
    source_id, source_owner, _ = populated_vendor
    key = grant_key(client, source_id, source_owner)
    document = client.get(f"/v1/vendors/{source_id}/oscal/cdef", headers=bearer(key)).json()

    target_id, target_owner = vendor
    r = client.post(
        f"/v1/vendors/{target_id}/oscal/import",
        headers=owner_headers(target_owner),
        json={"document": document, "apply": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True

    claims = client.get(
        f"/v1/vendors/{target_id}/manage/attestations", headers=owner_headers(target_owner)
    ).json()["claims"]
    assert {c["key"] for c in claims} >= {"mfa.enforced", "breach_notification_hours"}

    subprocessors = client.get(
        f"/v1/vendors/{target_id}/manage/subprocessors", headers=owner_headers(target_owner)
    ).json()["subprocessors"]
    assert [s["name"] for s in subprocessors] == ["AWS"]


def test_import_requires_the_owner_token(client, populated_vendor):
    vid, owner, _ = populated_vendor
    r = client.post(f"/v1/vendors/{vid}/oscal/import", json={"document": {"catalog": {}}})
    assert r.status_code == 401


def test_import_rejects_a_missing_document(client, populated_vendor):
    vid, owner, _ = populated_vendor
    r = client.post(
        f"/v1/vendors/{vid}/oscal/import", headers=owner_headers(owner), json={"apply": True}
    )
    assert r.status_code == 400


def test_import_records_a_change(client, vendor, populated_vendor):
    source_id, source_owner, _ = populated_vendor
    key = grant_key(client, source_id, source_owner)
    document = client.get(f"/v1/vendors/{source_id}/oscal/cdef", headers=bearer(key)).json()

    target_id, target_owner = vendor
    client.post(f"/v1/vendors/{target_id}/publish", headers=owner_headers(target_owner))
    target_key = grant_key(client, target_id, target_owner)
    before = client.get(
        f"/v1/vendors/{target_id}/oscal/changes", headers=bearer(target_key)
    ).json()["cursor"]

    client.post(
        f"/v1/vendors/{target_id}/oscal/import",
        headers=owner_headers(target_owner),
        json={"document": document, "apply": True},
    )
    after = client.get(
        f"/v1/vendors/{target_id}/oscal/changes?since={before}", headers=bearer(target_key)
    ).json()
    assert any(c["event"] == "oscal.imported" for c in after["changes"])
