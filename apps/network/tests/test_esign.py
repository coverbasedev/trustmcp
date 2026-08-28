from __future__ import annotations

from types import SimpleNamespace

from app.config import Settings
from app.esign import build_envelope_payload, map_envelope_status
from tests.conftest import owner_headers


def test_status_mapping():
    assert map_envelope_status("completed") == "signed"
    assert map_envelope_status("sent") == "sent"
    assert map_envelope_status("declined") == "declined"
    assert map_envelope_status("voided") == "voided"
    assert map_envelope_status("unknown") is None
    assert map_envelope_status(None) is None


def test_build_envelope_payload_prefills_template_roles():
    settings = Settings(
        environment="test",
        docusign_dpa_template_id="tmpl-default",
        docusign_role_name="Signer",
    )
    vendor = SimpleNamespace(legal_name="Acme Corp", dpa_template_id=None)
    agreement = SimpleNamespace(
        company_name="Globex",
        signer_name="Pat Smith",
        signer_email="pat@globex.com",
        signer_title="GC",
        doing_business_as="Globex Intl",
        registration_number="REG-1",
        contact_details="Privacy Team",
        address={"line1": "1 Main St", "locality": "Springfield", "country": "US"},
    )
    payload = build_envelope_payload(settings, vendor, agreement)
    assert payload["templateId"] == "tmpl-default"
    assert payload["status"] == "sent"
    role = payload["templateRoles"][0]
    assert role["email"] == "pat@globex.com"
    assert role["roleName"] == "Signer"
    labels = {t["tabLabel"]: t["value"] for t in role["tabs"]["textTabs"]}
    assert labels["company_name"] == "Globex"
    assert "1 Main St" in labels["company_address"]
    assert "Springfield" in labels["company_address"]


def test_vendor_template_overrides_default():
    settings = Settings(environment="test", docusign_dpa_template_id="tmpl-default")
    vendor = SimpleNamespace(legal_name="Acme", dpa_template_id="tmpl-vendor")
    agreement = SimpleNamespace(
        company_name="G", signer_name="P", signer_email="p@g.com", signer_title=None,
        doing_business_as=None, registration_number=None, contact_details=None, address={},
    )
    assert build_envelope_payload(settings, vendor, agreement)["templateId"] == "tmpl-vendor"


def test_webhook_updates_agreement_status(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={"dpa_self_serve": True})
    client.post(
        f"/v1/vendors/{vid}/agreements",
        json={"company_name": "Globex", "signer_name": "Pat", "signer_email": "pat@globex.com"},
    )
    # Simulate that the agreement was sent and got an envelope id (no Docusign in tests).
    agr = client.get(f"/v1/vendors/{vid}/agreements", headers=h).json()[0]
    # Manually attach an envelope id via the DB so the webhook can match it.
    from app.db import SessionLocal
    from app.models import Agreement

    db = SessionLocal()
    row = db.get(Agreement, agr["id"])
    row.envelope_id = "env-123"
    row.status = "sent"
    db.add(row)
    db.commit()
    db.close()

    r = client.post(
        "/v1/esign/webhook",
        json={"data": {"envelopeId": "env-123", "envelopeSummary": {"status": "completed"}}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["agreement_status"] == "signed"
    assert client.get(f"/v1/vendors/{vid}/agreements", headers=h).json()[0]["status"] == "signed"


def test_send_endpoint_requires_esign_config(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={"dpa_self_serve": True})
    client.post(
        f"/v1/vendors/{vid}/agreements",
        json={"company_name": "Globex", "signer_name": "Pat", "signer_email": "pat@globex.com"},
    )
    agr = client.get(f"/v1/vendors/{vid}/agreements", headers=h).json()[0]
    # No Docusign configured in tests -> 409.
    r = client.post(f"/v1/vendors/{vid}/agreements/{agr['id']}/send", headers=h)
    assert r.status_code == 409
