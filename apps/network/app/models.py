from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Vendor(Base):
    __tablename__ = "vendors"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # vnd_xxx
    legal_name: Mapped[str] = mapped_column(String, nullable=False)
    # Legacy single product name (kept for back-compat). New trust centers use the
    # `products` list below; `product` mirrors the first one for old API consumers.
    product: Mapped[str | None] = mapped_column(String, nullable=True)
    # Product lines: list of {"id": "prd_xxx", "name": "..."}. A vendor can publish
    # any number of products and associate each document with zero or more of them.
    products: Mapped[list] = mapped_column(JSON, default=list)
    domains: Mapped[list] = mapped_column(JSON, default=list)
    branding: Mapped[dict] = mapped_column(JSON, default=dict)
    owner_token_hash: Mapped[str] = mapped_column(String, nullable=False)
    notify_email: Mapped[str | None] = mapped_column(String, nullable=True)
    notify_on_request: Mapped[bool] = mapped_column(Boolean, default=True)
    listed: Mapped[bool] = mapped_column(Boolean, default=True)  # show in public directory
    # Auto-release policies (any match -> request is auto-granted).
    auto_approve_domains: Mapped[list] = mapped_column(JSON, default=list)
    auto_approve_crm: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_approve_on_contract: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-vendor CRM credentials (override the network-global config when set).
    crm_provider: Mapped[str | None] = mapped_column(String, nullable=True)  # hubspot|salesforce
    crm_token: Mapped[str | None] = mapped_column(String, nullable=True)
    crm_instance_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # How the CRM is connected: "api" (a pasted token, the default) or "mcp"
    # (the customer's own CRM MCP server, queried for a company by domain).
    crm_connection: Mapped[str | None] = mapped_column(String, nullable=True)  # api|mcp
    crm_mcp_url: Mapped[str | None] = mapped_column(String, nullable=True)
    crm_mcp_token: Mapped[str | None] = mapped_column(String, nullable=True)  # bearer (secret)
    # MCP auth method: "bearer" (static token above) or "oauth" (client-credentials).
    crm_mcp_auth: Mapped[str | None] = mapped_column(String, nullable=True)  # bearer|oauth
    crm_mcp_client_id: Mapped[str | None] = mapped_column(String, nullable=True)
    crm_mcp_client_secret: Mapped[str | None] = mapped_column(String, nullable=True)  # secret
    crm_mcp_token_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # In-app approval agent: auto-apply an "approve" recommendation on arrival.
    agent_auto_approve: Mapped[bool] = mapped_column(Boolean, default=False)
    # Stamp each PDF download with the requester's identity (deters leaks).
    watermark_downloads: Mapped[bool] = mapped_column(Boolean, default=False)
    # NDA gate (click-through before access is requested).
    nda_required: Mapped[bool] = mapped_column(Boolean, default=False)
    nda_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Self-service DPA: visitors can fill a form to generate/sign a Data Processing
    # Addendum. When enabled, the public trust center surfaces the DPA flow.
    dpa_self_serve: Mapped[bool] = mapped_column(Boolean, default=False)
    dpa_intro: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Per-vendor Docusign template id for the DPA (overrides the network default).
    dpa_template_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Per-vendor Docusign credentials (override the network-global config when set,
    # so each trust center signs from its own Docusign account). The private key
    # and Connect HMAC key are secrets and are never echoed back through the API.
    docusign_account_id: Mapped[str | None] = mapped_column(String, nullable=True)
    docusign_integration_key: Mapped[str | None] = mapped_column(String, nullable=True)
    docusign_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    docusign_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)  # secret
    docusign_auth_host: Mapped[str | None] = mapped_column(String, nullable=True)
    docusign_base_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    docusign_connect_hmac_key: Mapped[str | None] = mapped_column(String, nullable=True)  # secret
    # External company links shown in the public header (also stored loosely in
    # branding for convenience). privacy_policy_url, marketplace_url, etc. live in
    # the branding JSON blob, so no dedicated columns are needed there.
    # Outbound webhooks for request/grant/revoke events.
    webhook_url: Mapped[str | None] = mapped_column(String, nullable=True)
    webhook_secret: Mapped[str | None] = mapped_column(String, nullable=True)
    # unverified | agent-ready | revoked. "revoked" is operator-set (abuse) and
    # sticky: re-verifying a domain does not re-grant it (see services.recompute_mark).
    mark_status: Mapped[str] = mapped_column(String, default="unverified")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attestations_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Public resource presentation: how the trust center lays out the resource
    # list. {"layout": "list|grid|table", "group_by": "category|type|product|none",
    # "category_order": [...], "show_descriptions": bool, "show_dates": bool,
    # "show_hashes": bool}. Empty = the defaults in schemas.ResourceDisplay.
    resource_display: Mapped[dict] = mapped_column(JSON, default=dict)
    # When the controls list was last updated - surfaced as "Updated X ago" on the
    # public trust center (a continuous-monitoring signal).
    controls_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    artifacts: Mapped[list[Artifact]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    claims: Mapped[list[Claim]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    subprocessors: Mapped[list[Subprocessor]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    badges: Mapped[list[ComplianceBadge]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    controls: Mapped[list[Control]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    data_types: Mapped[list[DataType]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    faqs: Mapped[list[FaqEntry]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    updates: Mapped[list[Update]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    subscribers: Mapped[list[Subscriber]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )
    drive_connections: Mapped[list[DriveConnection]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan"
    )


class DomainVerification(Base):
    __tablename__ = "domain_verifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    domain: Mapped[str] = mapped_column(String, nullable=False)
    method: Mapped[str] = mapped_column(String, default="dns")  # dns|well-known
    challenge_token: Mapped[str] = mapped_column(String, nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # art_xxx
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    format: Mapped[str | None] = mapped_column(String, nullable=True)
    issued_at: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    scope: Mapped[str | None] = mapped_column(String, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String, nullable=True)
    access: Mapped[str] = mapped_column(String, default="key_required")
    # Product lines this document belongs to (ids referencing Vendor.products).
    # Empty = applies to the whole vendor / all products.
    product_ids: Mapped[list] = mapped_column(JSON, default=list)
    # Resource grouping for the public trust center (e.g. "Compliance",
    # "Penetration Testing", "Questionnaires", "Privacy"). Free-form; optional.
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    # --- Public presentation -------------------------------------------------
    # How this resource reads on the public trust center. `title` is the name;
    # `description` is the blurb under it. `position` orders within a category
    # (lower first); `featured` pins it to the top of the page; `hidden` keeps
    # it out of the public listing entirely without deleting it or changing who
    # may download it (that is `access`).
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    featured: Mapped[bool] = mapped_column(Boolean, default=False)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    # --- Provenance ----------------------------------------------------------
    # Where the content came from: "upload" (a person uploaded it) or "drive"
    # (synced from a linked Google Drive folder). Synced artifacts keep the
    # Drive file id so a later revision updates this artifact instead of
    # creating a duplicate.
    source: Mapped[str] = mapped_column(String, default="upload")
    source_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    storage_key: Mapped[str | None] = mapped_column(String, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Set when an expiry nudge has been emailed for the current valid_until, so the
    # scheduled job emails once per expiry window rather than every run. Cleared when
    # valid_until changes (see manage.update_artifact).
    expiry_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vendor: Mapped[Vendor] = relationship(back_populates="artifacts")
    versions: Mapped[list[ArtifactVersion]] = relationship(
        back_populates="artifact", cascade="all, delete-orphan"
    )


class ArtifactVersion(Base):
    """An archived (previous) version of an artifact. The current content lives on
    the Artifact row; each new upload archives the prior content here."""

    __tablename__ = "artifact_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str | None] = mapped_column(String, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    issued_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    artifact: Mapped[Artifact] = relationship(back_populates="versions")


class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    key: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[object] = mapped_column(JSON, nullable=False)  # bool|str|num|list[str]
    evidence: Mapped[list] = mapped_column(JSON, default=list)

    vendor: Mapped[Vendor] = relationship(back_populates="claims")


class Subprocessor(Base):
    __tablename__ = "subprocessors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    domain: Mapped[str | None] = mapped_column(String, nullable=True)  # for nth-party graph
    # Grouping tag shown on the public page (e.g. "Core Product", "Analytics").
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String, nullable=True)

    vendor: Mapped[Vendor] = relationship(back_populates="subprocessors")


class ComplianceBadge(Base):
    """A compliance framework / certification shown as a badge on the public trust
    center (SOC 2, ISO 27001, FedRAMP, GDPR, …). Purely presentational - the
    underlying evidence still lives in artifacts/attestations."""

    __tablename__ = "compliance_badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)  # "SOC 2 Type II"
    standard: Mapped[str | None] = mapped_column(String, nullable=True)  # "soc2", "iso27001"
    logo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # Optional link to the artifact that is the evidence for this certification
    # (the SOC 2 report, ISO cert PDF, …), so a reader can verify the claim.
    evidence_artifact_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Optional certification validity window shown on the public trust center.
    issued_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    vendor: Mapped[Vendor] = relationship(back_populates="badges")


class Control(Base):
    """A security control, grouped by category, with a status. Mirrors Vanta's
    "Controls" grid (e.g. Infrastructure Security → "Production data backups
    conducted" → operating)."""

    __tablename__ = "controls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    category: Mapped[str] = mapped_column(String, nullable=False)  # "Infrastructure Security"
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="operating")  # operating|not_operating
    position: Mapped[int] = mapped_column(Integer, default=0)

    vendor: Mapped[Vendor] = relationship(back_populates="controls")


class DataType(Base):
    """A "data collected" line item - a kind of data the vendor does or does not
    collect (Vanta's "Data collected" yes/no list)."""

    __tablename__ = "data_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    collected: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    vendor: Mapped[Vendor] = relationship(back_populates="data_types")


class FaqEntry(Base):
    __tablename__ = "faq_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)

    vendor: Mapped[Vendor] = relationship(back_populates="faqs")


class Update(Base):
    """A trust-center announcement / changelog entry (Vanta's "Updates" feed)."""

    __tablename__ = "updates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String, nullable=True)  # Compliance|General|…
    published_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vendor: Mapped[Vendor] = relationship(back_populates="updates")


class Subscriber(Base):
    """An email subscribed to a vendor's trust-center updates."""

    __tablename__ = "subscribers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    email: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="subscribed")  # subscribed|unsubscribed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vendor: Mapped[Vendor] = relationship(back_populates="subscribers")


class KeyRequest(Base):
    __tablename__ = "key_requests"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # req_xxx
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    requester_name: Mapped[str] = mapped_column(String, nullable=False)
    requester_domain: Mapped[str] = mapped_column(String, nullable=False)
    requester_contact: Mapped[str] = mapped_column(String, nullable=False)
    requester_company: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    scope: Mapped[list] = mapped_column(JSON, default=list)
    # Requested artifact allowlist ("limited access"). Empty = full access (all
    # artifacts within scope). Carried onto the minted key when granted.
    artifact_ids: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|granted|denied
    access_key_id: Mapped[str | None] = mapped_column(String, nullable=True)
    auto_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    decision_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    contract_storage_key: Mapped[str | None] = mapped_column(String, nullable=True)
    contract_sha256: Mapped[str | None] = mapped_column(String, nullable=True)
    nda_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    nda_text_sha: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccessKey(Base):
    __tablename__ = "access_keys"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # key_xxx
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    key_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    display_hint: Mapped[str] = mapped_column(String, nullable=False)  # last 4 chars
    requester_name: Mapped[str] = mapped_column(String, nullable=False)
    requester_domain: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[list] = mapped_column(JSON, default=list)
    # Optional per-artifact allowlist; empty list = all artifacts within scope.
    artifact_ids: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="granted")  # granted|revoked
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Agreement(Base):
    """A self-service agreement submission (e.g. a DPA). The visitor fills company
    + signer details; the vendor owner is notified and can route it to signature.
    The signature step integrates with an external e-sign provider (Docusign)."""

    __tablename__ = "agreements"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # agr_xxx
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    type: Mapped[str] = mapped_column(String, default="dpa")
    company_name: Mapped[str] = mapped_column(String, nullable=False)
    signer_name: Mapped[str] = mapped_column(String, nullable=False)
    signer_email: Mapped[str] = mapped_column(String, nullable=False)
    signer_title: Mapped[str | None] = mapped_column(String, nullable=True)
    contact_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[dict] = mapped_column(JSON, default=dict)
    doing_business_as: Mapped[str | None] = mapped_column(String, nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String, nullable=True)
    subscribe_email: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="submitted")  # submitted|sent|signed
    envelope_id: Mapped[str | None] = mapped_column(String, nullable=True)  # e-sign envelope
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    access_key_id: Mapped[str | None] = mapped_column(String, nullable=True)
    actor: Mapped[str | None] = mapped_column(String, nullable=True)  # requester domain / owner
    action: Mapped[str] = mapped_column(String, nullable=False)
    target: Mapped[str | None] = mapped_column(String, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OscalChange(Base):
    """One entry in a vendor's OSCAL change log.

    The log is what makes the OSCAL exchange continuous rather than a series of
    unrelated snapshots: `sequence` is a per-vendor, gapless cursor a consumer
    resumes from, and `models` names which OSCAL documents the change
    invalidates so a subscriber re-pulls only what actually moved."""

    __tablename__ = "oscal_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    # Monotonic per vendor (not global), so one vendor's activity never advances
    # another's cursor.
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    event: Mapped[str] = mapped_column(String, nullable=False)  # artifact.updated, …
    subject: Mapped[str | None] = mapped_column(String, nullable=True)  # artifact id, claim key
    models: Mapped[list] = mapped_column(JSON, default=list)  # invalidated OSCAL models
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OscalSubscription(Base):
    """A consumer's standing request to be pushed OSCAL changes.

    Registered by a customer holding an access key with the `attestations`
    scope; the key it was created under is recorded so revoking the key can
    revoke the subscription with it."""

    __tablename__ = "oscal_subscriptions"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # sub_xxx
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    url: Mapped[str] = mapped_column(String, nullable=False)
    secret: Mapped[str | None] = mapped_column(String, nullable=True)  # HMAC shared secret
    # Empty = every model. Otherwise only changes touching these OSCAL models
    # are delivered.
    models: Mapped[list] = mapped_column(JSON, default=list)
    format: Mapped[str] = mapped_column(String, default="json")
    subscriber_domain: Mapped[str | None] = mapped_column(String, nullable=True)
    access_key_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, default="active")  # active|suspended|cancelled
    last_cursor: Mapped[int] = mapped_column(Integer, default=0)
    last_delivery_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_status: Mapped[str | None] = mapped_column(String, nullable=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DriveConnection(Base):
    """A linked Google Drive folder that feeds documents into a trust center.

    Credentials are stored per connection so each trust center syncs from its
    own Drive, and are never echoed back through the API. Two auth shapes are
    supported: an OAuth refresh token (a person authorized their own Drive) and
    a service-account key (the folder is shared with the service account)."""

    __tablename__ = "drive_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # drv_xxx
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    # Null while a click-through OAuth connection is authorized but the owner has
    # not picked a folder yet (status "pending_folder"). A connection in that
    # state holds credentials and nothing else — it never syncs.
    folder_id: Mapped[str | None] = mapped_column(String, nullable=True)
    folder_name: Mapped[str | None] = mapped_column(String, nullable=True)
    # oauth | service_account
    auth_type: Mapped[str] = mapped_column(String, default="oauth")
    client_id: Mapped[str | None] = mapped_column(String, nullable=True)
    client_secret: Mapped[str | None] = mapped_column(String, nullable=True)  # secret
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)  # secret
    service_account_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # secret
    # Walk sub-folders, or only the folder itself.
    recursive: Mapped[bool] = mapped_column(Boolean, default=True)
    # manual | on_change. `on_change` lets a scheduled poller sync without a
    # person clicking; `manual` syncs only when asked.
    sync_mode: Mapped[str] = mapped_column(String, default="manual")
    # When true, a file matching an auto-classification rule is published
    # without waiting in the review queue. Files matching nothing always wait.
    auto_publish: Mapped[bool] = mapped_column(Boolean, default=False)
    # Ordered list of {"match": glob, "field": ..., ...} — see drive_rules.py.
    rules: Mapped[list] = mapped_column(JSON, default=list)
    # Defaults applied to a file no rule matched.
    default_category: Mapped[str | None] = mapped_column(String, nullable=True)
    default_type: Mapped[str] = mapped_column(String, default="policy")
    default_access: Mapped[str] = mapped_column(String, default="key_required")
    # pending_folder | connected | error | disabled
    status: Mapped[str] = mapped_column(String, default="connected")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vendor: Mapped[Vendor] = relationship(back_populates="drive_connections")
    files: Mapped[list[DriveFile]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )


class DriveFile(Base):
    """One file seen in a linked Drive folder, and what the owner decided about it.

    A row exists for every file the sync has ever seen, including excluded ones
    — that is what stops a file the owner rejected from reappearing in the
    review queue on the next sync. `decision` is the owner's call; the
    `proposed_*` columns are what the classification rules suggested."""

    __tablename__ = "drive_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    connection_id: Mapped[str] = mapped_column(ForeignKey("drive_connections.id"), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("vendors.id"), index=True)
    drive_file_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str | None] = mapped_column(String, nullable=True)  # folder path within the link
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Drive's own change markers. `md5` is absent for Google-native docs, so
    # `modified_time` is the fallback signal that content moved.
    md5: Mapped[str | None] = mapped_column(String, nullable=True)
    modified_time: Mapped[str | None] = mapped_column(String, nullable=True)
    web_view_link: Mapped[str | None] = mapped_column(String, nullable=True)
    # pending | included | excluded
    decision: Mapped[str] = mapped_column(String, default="pending")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exclude_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    # What the rules proposed (shown pre-filled in the review queue).
    proposed_type: Mapped[str | None] = mapped_column(String, nullable=True)
    proposed_title: Mapped[str | None] = mapped_column(String, nullable=True)
    proposed_category: Mapped[str | None] = mapped_column(String, nullable=True)
    proposed_access: Mapped[str | None] = mapped_column(String, nullable=True)
    matched_rule: Mapped[str | None] = mapped_column(String, nullable=True)
    # The artifact this file publishes as, once included.
    artifact_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # The md5/modified_time actually published, so the syncer can tell a Drive
    # revision apart from a file it has already pushed.
    synced_md5: Mapped[str | None] = mapped_column(String, nullable=True)
    synced_modified_time: Mapped[str | None] = mapped_column(String, nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the file disappears from Drive; the artifact is left alone so a
    # published document never vanishes from a trust center behind the owner's back.
    missing_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    connection: Mapped[DriveConnection] = relationship(back_populates="files")
