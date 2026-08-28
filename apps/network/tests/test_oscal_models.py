"""OSCAL model coverage: every model, every format, and the round trip."""

from __future__ import annotations

import datetime as dt
import json
from xml.etree import ElementTree as ET

import pytest

from app.oscal import (
    VENDOR_MODELS,
    build,
    build_all,
    bundle,
    capabilities,
    digest_of,
    plan_import,
    render,
    resolve_model,
    validate,
)
from app.oscal.catalog import catalog, control_id, profile
from app.oscal.context import (
    ArtifactRecord,
    BadgeRecord,
    ClaimRecord,
    ControlRecord,
    OscalContext,
    SubprocessorRecord,
)


def make_context(**overrides) -> OscalContext:
    base = dict(
        vendor_id="vnd_acme",
        legal_name="Acme Corp",
        product="Acme Platform",
        products=[{"id": "prd_core", "name": "Core"}],
        domains=["acme.com"],
        mark_status="agent-ready",
        published_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC),
        generated_at=dt.datetime(2026, 6, 1, tzinfo=dt.UTC),
        network_url="https://network.trustmcp.app",
        claims=[
            ClaimRecord("mfa.enforced", True, ["art_soc2"]),
            ClaimRecord("encryption.at_rest", True),
            ClaimRecord("breach_notification_hours", 72),
            ClaimRecord("data_residency", ["us", "eu"]),
        ],
        artifacts=[
            ArtifactRecord(
                id="art_soc2",
                type="soc2_type2",
                title="SOC 2 Type II",
                format="pdf",
                issued_at=dt.date(2026, 1, 15),
                valid_until=dt.date(2027, 1, 15),
                sha256="a" * 64,
                access="key_required",
                version=2,
                category="Compliance",
                scope="US",
                description="Annual SOC 2 report",
                product_ids=["prd_core"],
                has_content=True,
                freshness="valid",
            )
        ],
        controls=[ControlRecord("Infrastructure Security", "Backups tested", None, "operating")],
        subprocessors=[SubprocessorRecord("AWS", "Hosting", "us-east-1", "aws.amazon.com", "Core")],
        badges=[BadgeRecord("SOC 2 Type II", "soc2", None, None, "art_soc2")],
        data_types=[{"label": "Email", "collected": True}],
    )
    base.update(overrides)
    return OscalContext(**base)


@pytest.mark.parametrize("model", sorted(VENDOR_MODELS))
def test_every_model_is_structurally_valid(model):
    document = build(model, make_context())
    report = validate(document)
    assert report["valid"], report["issues"]
    assert report["model"] == model


def test_network_models_are_valid():
    assert validate(catalog())["valid"]
    for framework in ("soc2", "nist_800_53", "iso_27001"):
        assert validate(profile(framework))["valid"], framework


def test_catalog_covers_vendor_specific_claims():
    document = catalog(["custom.thing"])
    ids = {
        control["id"]
        for group in document["catalog"]["groups"]
        for control in group["controls"]
    }
    assert control_id("custom.thing") in ids
    assert control_id("mfa.enforced") in ids


@pytest.mark.parametrize("fmt", ["json", "yaml", "xml"])
def test_all_three_formats_render(fmt):
    document = build("component-definition", make_context())
    body, media_type = render(document, fmt)
    assert body
    assert media_type
    if fmt == "json":
        assert json.loads(body) == json.loads(json.dumps(document, default=str))
    if fmt == "xml":
        root = ET.fromstring(body)
        # The root is namespace-qualified, which is what OSCAL's XML binding
        # requires — a consumer's schema validation depends on it.
        assert root.tag == "{http://csrc.nist.gov/ns/oscal/1.0}component-definition"
        # uuid is an XML attribute in OSCAL's XML binding, not a child element.
        assert root.get("uuid") == document["component-definition"]["uuid"]


def test_unsupported_format_is_rejected():
    with pytest.raises(ValueError):
        render(build("component-definition", make_context()), "toml")


def test_export_is_deterministic():
    """Re-exporting unchanged evidence must produce identical documents.

    This is what makes the continuous feed usable: a consumer diffs digests
    rather than re-parsing every document on every pull.
    """
    first = bundle(make_context())
    second = bundle(make_context())
    assert first["digests"] == second["digests"]
    assert (
        first["documents"]["component-definition"]["component-definition"]["uuid"]
        == second["documents"]["component-definition"]["component-definition"]["uuid"]
    )


def test_digest_ignores_the_export_timestamp():
    early = make_context(generated_at=dt.datetime(2026, 6, 1, tzinfo=dt.UTC))
    later = make_context(generated_at=dt.datetime(2026, 9, 1, tzinfo=dt.UTC))
    assert digest_of(build("component-definition", early)) == digest_of(
        build("component-definition", later)
    )


def test_digest_moves_when_evidence_moves():
    before = make_context()
    after = make_context(claims=[*before.claims, ClaimRecord("bcp_dr.tested", True)])
    assert digest_of(build("component-definition", before)) != digest_of(
        build("component-definition", after)
    )


def test_aliases_resolve():
    assert resolve_model("ssp") == "system-security-plan"
    assert resolve_model("poam") == "plan-of-action-and-milestones"
    assert resolve_model("component-definition") == "component-definition"


def test_component_definition_carries_evidence_and_subprocessors():
    document = build("component-definition", make_context())["component-definition"]
    titles = {c["title"] for c in document["components"]}
    assert "Acme Platform" in titles  # the service
    assert "Core" in titles  # the product line
    assert "AWS" in titles  # the subprocessor
    resources = document["back-matter"]["resources"]
    assert any(r["title"] == "SOC 2 Type II" for r in resources)
    soc2 = next(r for r in resources if r["title"] == "SOC 2 Type II")
    assert soc2["rlinks"][0]["hashes"][0] == {"algorithm": "SHA-256", "value": "a" * 64}


def test_uncovered_controls_are_marked_not_claimed():
    ctx = make_context(claims=[ClaimRecord("mfa.enforced", True)])
    document = build("component-definition", ctx)["component-definition"]
    impl = document["components"][0]["control-implementations"][0]
    coverage = {
        req["control-id"]: next(
            p["value"] for p in req["props"] if p["name"] == "trustmcp-coverage"
        )
        for req in impl["implemented-requirements"]
    }
    assert "claimed" in coverage.values()
    assert "not-claimed" in coverage.values()


def test_non_boolean_claims_become_set_parameters():
    document = build("component-definition", make_context())["component-definition"]
    params = [
        p
        for impl in document["components"][0]["control-implementations"]
        for req in impl["implemented-requirements"]
        for p in req.get("set-parameters", [])
    ]
    assert any(p["values"] == ["72"] for p in params)


def test_assessment_results_flag_expired_evidence():
    expired = make_context(
        artifacts=[
            ArtifactRecord(
                id="art_old", type="pentest", title="Pen test", format="pdf",
                issued_at=dt.date(2024, 1, 1), valid_until=dt.date(2025, 1, 1),
                sha256="b" * 64, access="key_required", version=1, category=None,
                scope=None, description=None, product_ids=[], has_content=True,
                freshness="expired",
            )
        ]
    )
    results = build("assessment-results", expired)["assessment-results"]["results"][0]
    findings = {f["title"] for f in results["findings"]}
    assert "Evidence freshness" in findings


def test_poam_is_never_empty_and_tracks_gaps():
    """OSCAL requires at least one poam-item, and 'no gaps' is a real state."""
    everything = make_context(
        claims=[
            ClaimRecord(key, True)
            for key in (
                "mfa.enforced", "access_control.rbac", "encryption.at_rest",
                "encryption.in_transit", "breach_notification_hours",
                "bcp_dr.tested", "availability.sla", "subprocessors.count",
            )
        ],
        controls=[],
        artifacts=[],
    )
    items = build("plan-of-action-and-milestones", everything)[
        "plan-of-action-and-milestones"
    ]["poam-items"]
    assert len(items) == 1
    assert items[0]["title"] == "No open items"

    gappy = build("plan-of-action-and-milestones", make_context())[
        "plan-of-action-and-milestones"
    ]["poam-items"]
    assert any("Obtain evidence" in item["title"] for item in gappy)


def test_unverified_mark_becomes_a_poam_item():
    items = build(
        "plan-of-action-and-milestones", make_context(mark_status="unverified")
    )["plan-of-action-and-milestones"]["poam-items"]
    assert any("domain ownership unverified" in item["title"].lower() for item in items)


def test_ssp_information_types_come_from_the_published_inventory():
    ssp = build("system-security-plan", make_context())["system-security-plan"]
    titles = {
        t["title"]
        for t in ssp["system-characteristics"]["system-information"]["information-types"]
    }
    assert titles == {"Email"}


def test_ssp_says_so_when_no_inventory_is_published():
    ssp = build("system-security-plan", make_context(data_types=[]))["system-security-plan"]
    types = ssp["system-characteristics"]["system-information"]["information-types"]
    assert len(types) == 1
    assert "not published" in types[0]["description"]


def test_unknown_framework_is_rejected():
    with pytest.raises(ValueError):
        build("component-definition", make_context(), frameworks=["not_a_framework"])


def test_unknown_model_is_rejected():
    with pytest.raises(ValueError):
        build("nonsense", make_context())


# --- Round trip --------------------------------------------------------------


@pytest.mark.parametrize("model", ["component-definition", "system-security-plan"])
def test_round_trip_recovers_exactly_the_published_claims(model):
    """Exporting then re-importing must not invent claims the vendor never made."""
    ctx = make_context(
        claims=[
            ClaimRecord("mfa.enforced", True),
            ClaimRecord("breach_notification_hours", 72),
        ]
    )
    plan = plan_import(build(model, ctx))
    assert {c.key: c.value for c in plan.claims} == {
        "mfa.enforced": True,
        "breach_notification_hours": 72,
    }
    assert all(c.source == "props" for c in plan.claims)


def test_round_trip_preserves_list_and_numeric_claim_types():
    plan = plan_import(build("assessment-results", make_context()))
    values = {c.key: c.value for c in plan.claims}
    assert values["breach_notification_hours"] == 72
    assert values["data_residency"] == ["us", "eu"]
    assert values["mfa.enforced"] is True


def test_import_infers_claims_from_foreign_oscal():
    """A component-definition from another tool has no TrustMCP props, so
    coverage is the only signal — and inferred claims are labeled as such."""
    foreign = {
        "component-definition": {
            "uuid": "11111111-1111-4111-8111-111111111111",
            "metadata": {
                "title": "Vendor CDEF",
                "last-modified": "2026-06-01T00:00:00Z",
                "version": "1.0",
                "oscal-version": "1.1.3",
            },
            "components": [
                {
                    "uuid": "22222222-2222-4222-8222-222222222222",
                    "type": "service",
                    "title": "Their service",
                    "description": "x",
                    "control-implementations": [
                        {
                            "uuid": "33333333-3333-4333-8333-333333333333",
                            "source": "https://example.com/catalog",
                            "description": "y",
                            "implemented-requirements": [
                                {
                                    "uuid": "44444444-4444-4444-8444-444444444444",
                                    "control-id": "SC-28",
                                    "description": "Encryption at rest",
                                    "implementation-status": {"state": "implemented"},
                                }
                            ],
                        }
                    ],
                }
            ],
        }
    }
    plan = plan_import(foreign)
    assert plan.valid
    assert {c.key for c in plan.claims} == {"encryption.at_rest"}
    assert plan.claims[0].source == "inferred"
    assert any("inferred" in note for note in plan.notes)


def test_import_ignores_control_selectors():
    """`include-controls` names what was *reviewed*, not what is implemented."""
    document = {
        "assessment-results": {
            "uuid": "55555555-5555-4555-8555-555555555555",
            "metadata": {
                "title": "AR", "last-modified": "2026-06-01T00:00:00Z",
                "version": "1.0", "oscal-version": "1.1.3",
            },
            "import-ap": {"href": "#x"},
            "results": [
                {
                    "uuid": "66666666-6666-4666-8666-666666666666",
                    "title": "r", "description": "d",
                    "start": "2026-06-01T00:00:00Z",
                    "reviewed-controls": {
                        "control-selections": [
                            {"description": "s", "include-controls": [{"control-id": "SC-28"}]}
                        ]
                    },
                }
            ],
        }
    }
    assert plan_import(document).claims == []


def test_import_records_evidence_without_fetching_it():
    plan = plan_import(build("component-definition", make_context()))
    assert [e.title for e in plan.evidence] == ["SOC 2 Type II"]
    assert plan.evidence[0].sha256 == "a" * 64
    assert any("does not download" in note for note in plan.notes)


def test_import_rejects_a_non_oscal_document():
    plan = plan_import({"not-a-model": {}})
    assert not plan.valid
    assert plan.claims == []
    assert "nothing was read" in " ".join(plan.notes)


# --- Validation --------------------------------------------------------------


def test_validation_catches_a_dangling_evidence_link():
    document = build("component-definition", make_context())
    document["component-definition"]["back-matter"]["resources"] = []
    report = validate(document)
    assert not report["valid"]
    assert any("undefined uuid" in issue["message"] for issue in report["issues"])


def test_validation_catches_a_duplicate_uuid():
    document = build("component-definition", make_context())
    body = document["component-definition"]
    body["components"].append(dict(body["components"][0]))
    report = validate(document)
    assert any("duplicate uuid" in issue["message"] for issue in report["issues"])


def test_validation_requires_metadata():
    report = validate({"catalog": {"uuid": "77777777-7777-4777-8777-777777777777"}})
    assert not report["valid"]
    assert any("metadata" in issue["path"] for issue in report["issues"])


def test_capabilities_lists_every_model_and_format():
    caps = capabilities()
    assert {m["name"] for m in caps["vendor_models"]} == set(VENDOR_MODELS)
    assert set(caps["formats"]) == {"json", "yaml", "xml"}
    assert caps["exchange"]["continuous"]["poll"].endswith("since={cursor}")


def test_build_all_returns_every_vendor_model():
    assert set(build_all(make_context())) == set(VENDOR_MODELS)
