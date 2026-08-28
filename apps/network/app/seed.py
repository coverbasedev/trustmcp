"""Seed production trust-center profiles.

Usage:
    python -m app.seed            # seed Acme (default)
    python -m app.seed chime      # seed Chime Enterprise
    python -m app.seed all        # seed every profile

Creates the vendor, uploads placeholder artifact content (so hashes are real),
declares attestations and subprocessors, marks a domain verified (agent-ready), and
prints the owner token plus a ready-to-use consumer access key.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from .config import get_settings
from .db import SessionLocal, init_db
from .ids import artifact_id, key_id
from .models import (
    AccessKey,
    Artifact,
    Claim,
    ComplianceBadge,
    Control,
    DataType,
    DomainVerification,
    FaqEntry,
    Subprocessor,
    Update,
    Vendor,
)
from .security import generate_access_key, generate_owner_token, hash_secret
from .storage import Storage


@dataclass
class Profile:
    vendor_id: str
    legal_name: str
    product: str
    domain: str
    branding: dict
    # (type, title, issued, valid_until|None, scope|None, category|None)
    artifacts: list[tuple]
    claims: list[tuple]  # (key, value)
    subprocessors: list[tuple]  # (name, purpose, location, domain)
    badges: list[tuple] = field(default_factory=list)  # (name, standard)
    controls: list[tuple] = field(default_factory=list)  # (category, name)
    data_types: list[tuple] = field(default_factory=list)  # (label, collected)
    faqs: list[tuple] = field(default_factory=list)  # (question, answer)
    updates: list[tuple] = field(default_factory=list)  # (title, body, category, date)
    consumer: str = "Globex Inc"
    consumer_domain: str = "globex.com"
    extras: dict = field(default_factory=dict)


ACME = Profile(
    vendor_id="vnd_acme",
    legal_name="Acme Corp",
    product="Acme Platform",
    domain="acme.com",
    branding={
        "display_name": "Acme",
        "primary_color": "#4f46e5",
        "accent_color": "#06b6d4",
        "headline": "Trust, machine-readable.",
        "description": "Acme's assurance evidence, published once for agents to read.",
        "support_email": "trust@acme.com",
    },
    artifacts=[
        ("soc2_type2", "SOC 2 Type II Report", date(2026, 1, 15), date(2027, 1, 15),
         "Acme Platform, US regions", "Compliance"),
        ("pentest", "Q1 2026 Penetration Test", date(2026, 3, 2), date(2026, 6, 20), None,
         "Penetration Testing"),
        ("insurance_coi", "Certificate of Insurance", date(2026, 4, 10), date(2027, 4, 10), None,
         "Miscellaneous (Financial)"),
        ("sbom", "Core Platform SBOM", date(2026, 5, 20), None, None, "Miscellaneous (Security)"),
    ],
    claims=[
        ("mfa.enforced", True),
        ("encryption.at_rest", "AES-256"),
        ("encryption.in_transit", "TLS 1.2+"),
        ("data_residency", ["US", "EU"]),
        ("breach_notification_hours", 72),
        ("subprocessors.count", 11),
    ],
    subprocessors=[
        ("Amazon Web Services", "Infrastructure hosting", "US, EU", "aws.amazon.com"),
        ("Datadog", "Observability", "US", "datadoghq.com"),
        ("Stripe", "Payments", "US", "stripe.com"),
    ],
    badges=[
        ("SOC 2 Type II", "soc2"),
        ("ISO 27001:2022", "iso27001"),
        ("GDPR", "gdpr"),
        ("CCPA", "ccpa"),
    ],
    controls=[
        ("Infrastructure Security", "Service infrastructure maintained"),
        ("Infrastructure Security", "Production data backups conducted"),
        ("Infrastructure Security", "Database replication utilized"),
        ("Organizational Security", "Employee background checks performed"),
        ("Organizational Security", "Password policy enforced"),
        ("Organizational Security", "Security awareness training implemented"),
        ("Product Security", "Data encryption utilized"),
        ("Product Security", "Data transmission encrypted"),
        ("Data and Privacy", "Data retention procedures established"),
        ("Data and Privacy", "Data deletion requests handled"),
    ],
    data_types=[
        ("Customer personally identifiable information", True),
        ("Employee personally identifiable information", True),
        ("Credit card information", False),
        ("Personal health information", False),
    ],
    faqs=[
        ("Where can I find information about uptime and downtimes?",
         "Our live status page is at status.acme.com with historical uptime."),
        ("How does Acme handle access controls and authentication?",
         "MFA is enforced for all staff; access follows least-privilege with periodic reviews."),
        ("What compliance frameworks does Acme follow?",
         "SOC 2 Type II, ISO 27001:2022, GDPR, and CCPA. Reports are available on request."),
    ],
    updates=[
        ("Acme's latest SOC 2 Type II report is available", "We completed another SOC 2 Type II "
         "audit with no exceptions.", "Compliance", date(2026, 1, 20)),
        ("New subprocessor added", "We added a new observability subprocessor; see the "
         "subprocessor list.", "General", date(2026, 2, 5)),
    ],
)

# Chime Enterprise (Chime's B2B product) - vendor-side founding participant.
CHIME = Profile(
    vendor_id="vnd_chime",
    legal_name="Chime Financial, Inc.",
    product="Chime Enterprise",
    domain="chime.com",
    branding={
        "display_name": "Chime Enterprise",
        "primary_color": "#1ec677",
        "accent_color": "#0b1b2b",
        "headline": "Banking infrastructure you can verify.",
        "description": (
            "Chime Enterprise publishes its security and compliance evidence once, "
            "machine-readably, so partners and their agents can assess on their own terms."
        ),
        "support_email": "trust@chime.com",
    },
    artifacts=[
        ("soc2_type2", "SOC 2 Type II Report", date(2026, 2, 1), date(2027, 2, 1),
         "Chime Enterprise, US", "Compliance"),
        ("iso_27001", "ISO/IEC 27001 Certificate", date(2025, 11, 10), date(2028, 11, 10), None,
         "Compliance"),
        ("pentest", "2026 H1 Penetration Test", date(2026, 4, 15), date(2026, 7, 1), None,
         "Penetration Testing"),
        ("insurance_coi", "Certificate of Insurance", date(2026, 1, 5), date(2027, 1, 5), None,
         "Miscellaneous (Financial)"),
        ("dpa", "Data Processing Addendum", date(2026, 1, 1), None, None, "Privacy"),
        ("sbom", "Enterprise Platform SBOM", date(2026, 5, 1), None, None,
         "Miscellaneous (Security)"),
    ],
    claims=[
        ("mfa.enforced", True),
        ("encryption.at_rest", "AES-256"),
        ("encryption.in_transit", "TLS 1.3"),
        ("data_residency", ["US"]),
        ("breach_notification_hours", 48),
        ("compliance.pci_dss", True),
        ("availability.sla", "99.95%"),
        ("bcp_dr.tested", True),
        ("subprocessors.count", 9),
    ],
    subprocessors=[
        ("Amazon Web Services", "Infrastructure hosting", "US", "aws.amazon.com"),
        ("Galileo Financial Technologies", "Card processing", "US", "galileo-ft.com"),
        ("Plaid", "Account linking", "US", "plaid.com"),
        ("Datadog", "Observability", "US", "datadoghq.com"),
    ],
    badges=[
        ("SOC 2 Type II", "soc2"),
        ("ISO 27001:2022", "iso27001"),
        ("PCI DSS 4.0.1", "pci"),
        ("GDPR", "gdpr"),
    ],
    controls=[
        ("Infrastructure Security", "Service infrastructure maintained"),
        ("Infrastructure Security", "Production data backups conducted"),
        ("Organizational Security", "Employee background checks performed"),
        ("Organizational Security", "Security awareness training implemented"),
        ("Internal Security Procedures", "Incident response plan tested"),
        ("Internal Security Procedures", "Continuity and disaster recovery plans tested"),
        ("Product Security", "Data encryption utilized"),
        ("Data and Privacy", "Data retention procedures established"),
    ],
    data_types=[
        ("Customer personally identifiable information", True),
        ("Financial account information", True),
        ("Personal health information", False),
    ],
    faqs=[
        ("Where can I find Chime Enterprise's Data Processing Addendum?",
         "Use the self-service DPA form on this page to generate and sign our DPA."),
        ("How is data encrypted?",
         "AES-256 at rest and TLS 1.3 in transit across all Chime Enterprise services."),
    ],
    updates=[
        ("Chime Enterprise renews PCI DSS 4.0.1", "Our PCI DSS 4.0.1 attestation has been "
         "renewed.", "Compliance", date(2026, 3, 1)),
    ],
    consumer="Initech LLP",
    consumer_domain="initech.com",
)

PROFILES = {"acme": ACME, "chime": CHIME}


def seed_profile(p: Profile, *, storage: Storage, db) -> None:
    existing = db.query(Vendor).filter(Vendor.id == p.vendor_id).first()
    if existing:
        print(f"{p.legal_name} already seeded: {existing.id}")
        return

    owner_token = generate_owner_token()
    vendor = Vendor(
        id=p.vendor_id,
        legal_name=p.legal_name,
        product=p.product,
        domains=[p.domain],
        branding=p.branding,
        owner_token_hash=hash_secret(owner_token),
        mark_status="agent-ready",
        published_at=datetime.now(UTC),
        attestations_generated_at=datetime.now(UTC),
        controls_updated_at=datetime.now(UTC),
        dpa_self_serve=True,
        dpa_intro="Complete the fields below to generate our DPA for execution.",
    )
    db.add(vendor)

    for type_, title, issued, valid, scope, category in p.artifacts:
        aid = artifact_id(type_)
        content = f"TrustMCP placeholder artifact: {title} for {p.legal_name} ({type_}).".encode()
        storage_key = f"{vendor.id}/{aid}/seed"
        digest = storage.put(storage_key, content, "application/pdf")
        db.add(
            Artifact(
                id=aid, vendor_id=vendor.id, type=type_, title=title, issued_at=issued,
                valid_until=valid, scope=scope, category=category, access="key_required",
                storage_key=storage_key, sha256=digest, content_type="application/pdf",
                size_bytes=len(content),
            )
        )

    for key, value in p.claims:
        db.add(Claim(vendor_id=vendor.id, key=key, value=value, evidence=[]))

    for name, purpose, loc, dom in p.subprocessors:
        db.add(
            Subprocessor(
                vendor_id=vendor.id, name=name, purpose=purpose, location=loc,
                domain=dom, category="Core Product",
            )
        )

    for i, (name, standard) in enumerate(p.badges):
        db.add(ComplianceBadge(vendor_id=vendor.id, name=name, standard=standard, position=i))

    for i, (category, name) in enumerate(p.controls):
        db.add(Control(vendor_id=vendor.id, category=category, name=name, position=i))

    for i, (label, collected) in enumerate(p.data_types):
        db.add(DataType(vendor_id=vendor.id, label=label, collected=collected, position=i))

    for i, (question, answer) in enumerate(p.faqs):
        db.add(FaqEntry(vendor_id=vendor.id, question=question, answer=answer, position=i))

    for title, body, category, pub in p.updates:
        db.add(
            Update(vendor_id=vendor.id, title=title, body=body, category=category, published_at=pub)
        )

    db.add(
        DomainVerification(
            vendor_id=vendor.id, domain=p.domain, method="dns",
            challenge_token="trustmcp-verify=seed", verified=True, verified_at=datetime.now(UTC),
        )
    )

    secret = generate_access_key(get_settings())
    db.add(
        AccessKey(
            id=key_id(), vendor_id=vendor.id, key_hash=hash_secret(secret),
            display_hint=secret[-4:], requester_name=p.consumer,
            requester_domain=p.consumer_domain,
            scope=["manifest", "attestations", "artifacts"], status="granted",
            expires_at=datetime.now(UTC) + timedelta(days=get_settings().key_ttl_days),
        )
    )

    print(f"Seeded {p.legal_name} ({p.vendor_id}).")
    print(f"  OWNER TOKEN  : {owner_token}")
    print(f"  {p.consumer_domain.upper()} KEY : {secret}")
    print(f'    export TRUSTMCP_KEYS=\'{{"{p.vendor_id}": "{secret}"}}\'')


def seed(which: str = "acme") -> None:
    settings = get_settings()
    init_db()
    storage = Storage(settings)
    db = SessionLocal()
    try:
        targets = list(PROFILES.values()) if which == "all" else [PROFILES[which]]
        for p in targets:
            seed_profile(p, storage=storage, db=db)
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    arg = sys.argv[1].lower() if len(sys.argv) > 1 else "acme"
    if arg not in PROFILES and arg != "all":
        print(f"Unknown profile '{arg}'. Options: {', '.join(PROFILES)}, all")
        sys.exit(1)
    seed(arg)
