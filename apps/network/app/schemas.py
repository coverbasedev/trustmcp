from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "0.1"

ScopeItem = Literal["manifest", "attestations", "artifacts"]
ClaimValue = bool | str | float | int | list[str]


# --- Management: vendors / profile ------------------------------------------


class ProductIn(BaseModel):
    # id is optional: omit for a new product line (the server mints one), include
    # to keep/rename an existing one. Lines absent from a profile update are removed.
    id: str | None = None
    name: str


class ProductOut(BaseModel):
    id: str
    name: str


class VendorCreate(BaseModel):
    legal_name: str
    product: str | None = None  # legacy single-product convenience
    products: list[str] = Field(default_factory=list)  # initial product-line names
    domains: list[str] = Field(default_factory=list)
    notify_email: str | None = None


class Branding(BaseModel):
    display_name: str | None = None
    logo_url: str | None = None
    wide_logo_url: str | None = None  # horizontal lockup logo (alongside the square one)
    primary_color: str | None = None
    accent_color: str | None = None
    support_email: str | None = None
    headline: str | None = None
    description: str | None = None
    # External links rendered in the public trust-center header.
    privacy_policy_url: str | None = None
    marketplace_url: str | None = None
    company_url: str | None = None


class ProfileUpdate(BaseModel):
    legal_name: str | None = None
    product: str | None = None
    # Full replacement of the product-line list (add/rename/remove in one call).
    products: list[ProductIn] | None = None
    domains: list[str] | None = None
    branding: Branding | None = None
    notify_email: str | None = None
    notify_on_request: bool | None = None
    listed: bool | None = None
    auto_approve_domains: list[str] | None = None
    auto_approve_crm: bool | None = None
    auto_approve_on_contract: bool | None = None
    nda_required: bool | None = None
    nda_text: str | None = None
    dpa_self_serve: bool | None = None
    dpa_intro: str | None = None
    dpa_template_id: str | None = None
    webhook_url: str | None = None
    webhook_secret: str | None = None
    crm_provider: str | None = None
    crm_token: str | None = None
    crm_instance_url: str | None = None
    crm_connection: str | None = None  # api|mcp
    crm_mcp_url: str | None = None
    crm_mcp_token: str | None = None
    crm_mcp_auth: str | None = None  # bearer|oauth
    crm_mcp_client_id: str | None = None
    crm_mcp_client_secret: str | None = None
    crm_mcp_token_url: str | None = None
    # Per-vendor Docusign credentials (override the network-global config).
    docusign_account_id: str | None = None
    docusign_integration_key: str | None = None
    docusign_user_id: str | None = None
    docusign_private_key: str | None = None
    docusign_auth_host: str | None = None
    docusign_base_uri: str | None = None
    docusign_connect_hmac_key: str | None = None
    agent_auto_approve: bool | None = None
    watermark_downloads: bool | None = None


class VendorOut(BaseModel):
    id: str
    legal_name: str
    product: str | None
    products: list[ProductOut] = Field(default_factory=list)
    domains: list[str]
    branding: dict
    mark_status: str
    published_at: datetime | None
    notify_email: str | None = None
    notify_on_request: bool = True
    listed: bool = True
    auto_approve_domains: list[str] = Field(default_factory=list)
    auto_approve_crm: bool = False
    auto_approve_on_contract: bool = False
    nda_required: bool = False
    nda_text: str | None = None
    dpa_self_serve: bool = False
    dpa_intro: str | None = None
    dpa_template_id: str | None = None
    webhook_url: str | None = None
    webhook_secret: str | None = None
    crm_provider: str | None = None
    crm_configured: bool = False
    crm_instance_url: str | None = None
    crm_connection: str | None = None
    crm_mcp_url: str | None = None
    crm_mcp_configured: bool = False  # MCP bearer token is set
    crm_mcp_auth: str | None = None
    crm_mcp_client_id: str | None = None
    crm_mcp_token_url: str | None = None
    crm_mcp_client_secret_set: bool = False  # OAuth client secret is set
    # Docusign: identifiers/URLs are echoed for the form; secrets (private key,
    # Connect HMAC key) are never returned - only "*_set" booleans.
    docusign_account_id: str | None = None
    docusign_integration_key: str | None = None
    docusign_user_id: str | None = None
    docusign_auth_host: str | None = None
    docusign_base_uri: str | None = None
    docusign_private_key_set: bool = False
    docusign_connect_hmac_key_set: bool = False
    docusign_configured: bool = False  # all four per-vendor credentials present
    agent_auto_approve: bool = False
    watermark_downloads: bool = False


class VendorCreated(VendorOut):
    owner_token: str  # returned ONCE at creation


# --- Artifacts ---------------------------------------------------------------


class ArtifactCreate(BaseModel):
    type: str
    title: str | None = None
    format: str | None = None
    issued_at: date
    valid_until: date | None = None
    scope: str | None = None
    category: str | None = None
    access: Literal["public", "key_required"] = "key_required"
    # Product lines this document belongs to (empty = applies to all products).
    product_ids: list[str] = Field(default_factory=list)
    # Public presentation. `description` is the blurb under the title;
    # `position` orders within a category; `featured` pins it to the top;
    # `hidden` keeps it off the public page without changing who may download it.
    description: str | None = None
    position: int = 0
    featured: bool = False
    hidden: bool = False


class ArtifactUpdate(BaseModel):
    type: str | None = None
    title: str | None = None
    format: str | None = None
    issued_at: date | None = None
    valid_until: date | None = None
    scope: str | None = None
    category: str | None = None
    access: Literal["public", "key_required"] | None = None
    product_ids: list[str] | None = None
    description: str | None = None
    position: int | None = None
    featured: bool | None = None
    hidden: bool | None = None


class ArtifactOut(BaseModel):
    id: str
    type: str
    title: str | None
    format: str | None
    issued_at: date
    valid_until: date | None
    scope: str | None
    category: str | None = None
    sha256: str | None
    access: str
    uri: str
    has_content: bool
    version: int = 1
    product_ids: list[str] = Field(default_factory=list)
    description: str | None = None
    position: int = 0
    featured: bool = False
    hidden: bool = False
    # "upload" or "drive" — where the content came from.
    source: str = "upload"
    source_ref: str | None = None


class ArtifactLink(BaseModel):
    id: str
    sha256: str | None
    url: str
    expires_in: int


# --- Attestations ------------------------------------------------------------


class ClaimIn(BaseModel):
    key: str
    value: ClaimValue
    evidence: list[str] = Field(default_factory=list)


class AttestationsUpdate(BaseModel):
    claims: list[ClaimIn]


# --- Subprocessors -----------------------------------------------------------


class SubprocessorIn(BaseModel):
    name: str
    purpose: str | None = None
    location: str | None = None
    domain: str | None = None
    category: str | None = None
    logo_url: str | None = None


class SubprocessorsUpdate(BaseModel):
    subprocessors: list[SubprocessorIn]


# --- Access keys -------------------------------------------------------------


class Requester(BaseModel):
    name: str
    domain: str
    contact: str


class KeyRequestIn(BaseModel):
    vendor_id: str
    requester: Requester
    scope: list[ScopeItem] = Field(
        default_factory=lambda: ["manifest", "attestations", "artifacts"], min_length=1
    )
    # "Limited access": restrict the grant to specific artifacts. Empty = full access.
    artifact_ids: list[str] = Field(default_factory=list)
    company: str | None = None
    reason: str | None = None
    nda_accepted: bool = False


class KeyApprove(BaseModel):
    scope: list[ScopeItem] | None = None  # optionally narrow the requested scope
    ttl_days: int | None = None
    artifact_ids: list[str] | None = None  # optionally restrict to specific artifacts


# --- Domain verification -----------------------------------------------------


class DomainAdd(BaseModel):
    domain: str


class MarkRevoke(BaseModel):
    reason: str | None = None


class DomainChallenge(BaseModel):
    domain: str
    method: str
    dns_record_name: str
    dns_record_value: str
    well_known_url: str
    well_known_value: str
    verified: bool


# --- Custom-domain hosting ---------------------------------------------------


class CustomDomainAdd(BaseModel):
    domain: str


class CustomDomainDetect(BaseModel):
    domain: str


class CustomDomainAutoConfigure(BaseModel):
    domain: str
    provider: str
    credentials: dict = Field(default_factory=dict)


class CustomDomainConnect(BaseModel):
    domain: str


# --- Compliance badges / controls / data / FAQ / updates ---------------------


class BadgeIn(BaseModel):
    name: str
    standard: str | None = None
    logo_url: str | None = None
    evidence_artifact_id: str | None = None
    issued_on: date | None = None
    valid_until: date | None = None


class BadgesUpdate(BaseModel):
    badges: list[BadgeIn]


class ControlIn(BaseModel):
    category: str
    name: str
    description: str | None = None
    status: str = "operating"


class ControlsUpdate(BaseModel):
    controls: list[ControlIn]


class DataTypeIn(BaseModel):
    label: str
    collected: bool = True


class DataTypesUpdate(BaseModel):
    data_types: list[DataTypeIn]


class FaqIn(BaseModel):
    question: str
    answer: str


class FaqUpdate(BaseModel):
    faqs: list[FaqIn]


class UpdateIn(BaseModel):
    title: str
    body: str | None = None
    category: str | None = None
    published_at: date | None = None


class UpdatesUpdate(BaseModel):
    updates: list[UpdateIn]


# --- Public engagement flows -------------------------------------------------


class SubscribeIn(BaseModel):
    email: str


class AskIn(BaseModel):
    question: str


class ReclaimIn(BaseModel):
    email: str


class AgreementIn(BaseModel):
    type: str = "dpa"
    company_name: str
    signer_name: str
    signer_email: str
    signer_title: str | None = None
    contact_details: str | None = None
    address: dict = Field(default_factory=dict)
    doing_business_as: str | None = None
    registration_number: str | None = None
    subscribe_email: str | None = None


# --- Public resource presentation --------------------------------------------


class ResourceDisplay(BaseModel):
    """How the public trust center lays out the resource list.

    The defaults reproduce today's behavior exactly (a list, grouped by
    category, with dates), so a vendor who never touches this sees no change.
    """

    layout: Literal["list", "grid", "table"] = "list"
    group_by: Literal["category", "type", "product", "none"] = "category"
    # Categories in the order they should appear. Anything not named here is
    # appended alphabetically, so adding a category never makes it disappear.
    category_order: list[str] = Field(default_factory=list)
    show_descriptions: bool = True
    show_dates: bool = True
    show_hashes: bool = False
    # Pull `featured` resources into a band above the grouped list.
    feature_band: bool = True
    empty_message: str | None = None


class ResourceDisplayUpdate(BaseModel):
    layout: Literal["list", "grid", "table"] | None = None
    group_by: Literal["category", "type", "product", "none"] | None = None
    category_order: list[str] | None = None
    show_descriptions: bool | None = None
    show_dates: bool | None = None
    show_hashes: bool | None = None
    feature_band: bool | None = None
    empty_message: str | None = None


class ArtifactPresentationItem(BaseModel):
    """One row of a bulk presentation update."""

    id: str
    title: str | None = None
    description: str | None = None
    category: str | None = None
    position: int | None = None
    featured: bool | None = None
    hidden: bool | None = None


class ArtifactPresentationUpdate(BaseModel):
    items: list[ArtifactPresentationItem] = Field(default_factory=list)


# --- Google Drive sync -------------------------------------------------------


class DriveRule(BaseModel):
    """One auto-classification rule. First match wins."""

    match: str
    action: Literal["include", "review", "exclude"] = "include"
    type: str | None = None
    category: str | None = None
    access: Literal["public", "key_required"] | None = None
    title: str | None = None
    label: str | None = None
    reason: str | None = None


class DriveConnect(BaseModel):
    folder_id: str
    auth_type: Literal["oauth", "service_account"] = "oauth"
    # OAuth: the installed app's credentials plus the refresh token from the
    # consent flow. Write-only — never echoed back.
    client_id: str | None = None
    client_secret: str | None = None
    refresh_token: str | None = None
    # Service account: the JSON key, for a folder shared with its client_email.
    service_account_json: str | None = None
    recursive: bool = True
    sync_mode: Literal["manual", "on_change"] = "manual"
    # Publish rule-matched files without review. Files matching no rule always
    # wait in the queue regardless of this setting.
    auto_publish: bool = False
    rules: list[dict] = Field(default_factory=list)
    default_category: str | None = None
    default_type: str = "policy"
    default_access: Literal["public", "key_required"] = "key_required"


class DriveConnectionUpdate(BaseModel):
    recursive: bool | None = None
    sync_mode: Literal["manual", "on_change"] | None = None
    auto_publish: bool | None = None
    rules: list[dict] | None = None
    default_category: str | None = None
    default_type: str | None = None
    default_access: Literal["public", "key_required"] | None = None
    status: Literal["connected", "disabled"] | None = None


class DriveDecision(BaseModel):
    """The owner's call on one discovered file, plus how it should present."""

    decision: Literal["included", "excluded"]
    reason: str | None = None
    # Classification (overrides what the rules proposed).
    type: str | None = None
    title: str | None = None
    category: str | None = None
    access: Literal["public", "key_required"] | None = None
    # Presentation on the public trust center.
    description: str | None = None
    position: int | None = None
    featured: bool | None = None
    hidden: bool | None = None
    product_ids: list[str] | None = None
    issued_at: date | None = None
    valid_until: date | None = None
