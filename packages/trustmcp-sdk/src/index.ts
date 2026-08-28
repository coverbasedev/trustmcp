/**
 * TypeScript client for the TrustMCP Network.
 *
 * Designed for server-side use (e.g. Next.js route handlers / server actions).
 * Three credential modes mirror the network's auth tiers:
 *   - service token  -> create vendors on behalf of users
 *   - owner token    -> manage a specific vendor's trust center
 *   - access key      -> read a profile as a customer (scoped)
 */

import type { Manifest, Attestations, Freshness } from "@trustmcp/spec";

export class TrustMCPError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "TrustMCPError";
  }
}

export interface TrustMCPClientOptions {
  network: string;
  serviceToken?: string;
  fetchImpl?: typeof fetch;
}

export interface CustomDomainInstructionRecord {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
}

export interface CustomDomainStatus {
  domain: string | null;
  status?: "pending" | "verified" | "active" | "error";
  cname_target?: string;
  txt_name?: string;
  txt_value?: string;
  // "active" = serving a valid cert over HTTPS; "blocked" = verified but our edge
  // isn't routable yet so no cert can be issued (see last_error).
  tls?: "none" | "pending" | "provisioning" | "issued" | "active" | "blocked";
  verified_at?: string | null;
  last_error?: string | null;
  instructions?: { records: CustomDomainInstructionRecord[] };
}

/** A credential field a DNS provider's API needs for auto-configuration. */
export interface DnsProviderField {
  name: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
}

/** A provider we can auto-configure via API, with its credential field spec. */
export interface DnsProviderCatalogEntry {
  key: string;
  label: string;
  dns_panel_url?: string;
  can_auto: boolean;
  fields: DnsProviderField[];
}

/** Result of best-effort DNS-provider detection for a custom domain. */
export interface DnsProviderDetection {
  /** Provider key (e.g. "vercel"), or null when unrecognized. */
  provider: string | null;
  /** Back-compat alias of `can_auto`. */
  supported: boolean;
  /** True when we can create the records via the provider's API. */
  can_auto: boolean;
  /** Human-readable provider name, when detected. */
  label?: string | null;
  /** Deep-link into the provider's DNS management UI, when known. */
  dns_panel_url?: string | null;
  /** Credential fields the detected provider's API needs (empty if not auto). */
  fields?: DnsProviderField[];
  /** Every provider we can auto-configure (for a manual override in the UI). */
  catalog?: DnsProviderCatalogEntry[];
}

export interface Branding {
  display_name?: string;
  logo_url?: string;
  /** Wide / horizontal lockup logo, shown in the trust-center header. */
  wide_logo_url?: string;
  primary_color?: string;
  accent_color?: string;
  support_email?: string;
  headline?: string;
  description?: string;
  privacy_policy_url?: string;
  marketplace_url?: string;
  company_url?: string;
}

export interface BadgeEvidence {
  id: string;
  title: string;
  access: string;
  type?: string;
  has_content?: boolean;
}

export interface Badge {
  name: string;
  standard?: string | null;
  logo_url?: string | null;
  evidence_artifact_id?: string | null;
  evidence?: BadgeEvidence | null;
  issued_on?: string | null;
  valid_until?: string | null;
}

export interface ControlItem {
  category: string;
  name: string;
  description?: string | null;
  status: string;
}

export interface DataTypeItem {
  label: string;
  collected: boolean;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface UpdateItem {
  title: string;
  body?: string | null;
  category?: string | null;
  published_at?: string | null;
}

export interface SubprocessorItem {
  name: string;
  purpose?: string | null;
  location?: string | null;
  domain?: string | null;
  category?: string | null;
  logo_url?: string | null;
}

export interface AgreementInput {
  type?: string;
  company_name: string;
  signer_name: string;
  signer_email: string;
  signer_title?: string;
  contact_details?: string;
  address?: Record<string, string>;
  doing_business_as?: string;
  registration_number?: string;
  subscribe_email?: string;
}

export interface Product {
  id: string;
  name: string;
}

export interface Vendor {
  id: string;
  legal_name: string;
  product: string | null;
  products: Product[];
  domains: string[];
  branding: Branding;
  mark_status: string;
  published_at: string | null;
  notify_email?: string | null;
  notify_on_request?: boolean;
  listed?: boolean;
  auto_approve_domains?: string[];
  auto_approve_crm?: boolean;
  auto_approve_on_contract?: boolean;
  nda_required?: boolean;
  nda_text?: string | null;
  dpa_self_serve?: boolean;
  dpa_intro?: string | null;
  dpa_template_id?: string | null;
  webhook_url?: string | null;
  webhook_secret?: string | null;
  crm_provider?: string | null;
  crm_configured?: boolean;
  crm_instance_url?: string | null;
  crm_connection?: string | null; // "api" | "mcp"
  crm_mcp_url?: string | null;
  crm_mcp_configured?: boolean;
  crm_mcp_auth?: string | null; // "bearer" | "oauth"
  crm_mcp_client_id?: string | null;
  crm_mcp_token_url?: string | null;
  crm_mcp_client_secret_set?: boolean;
  // Docusign: identifiers/URLs are returned; secrets surface only as "*_set" flags.
  docusign_account_id?: string | null;
  docusign_integration_key?: string | null;
  docusign_user_id?: string | null;
  docusign_auth_host?: string | null;
  docusign_base_uri?: string | null;
  docusign_private_key_set?: boolean;
  docusign_connect_hmac_key_set?: boolean;
  docusign_configured?: boolean;
  agent_auto_approve?: boolean;
  watermark_downloads?: boolean;
  /** How the public trust center lays out the resource list. */
  resource_display?: ResourceDisplay;
}

export interface VendorCreated extends Vendor {
  owner_token: string;
}

export interface ArtifactOut {
  id: string;
  type: string;
  title: string | null;
  format: string | null;
  issued_at: string;
  valid_until: string | null;
  scope: string | null;
  category: string | null;
  sha256: string | null;
  access: string;
  uri: string;
  has_content: boolean;
  version: number;
  product_ids: string[];
  /** Blurb shown under the title on the public trust center. */
  description?: string | null;
  /** Order within a category; lower first. */
  position?: number;
  /** Pinned to the top of the public page. */
  featured?: boolean;
  /** Kept off the public listing. Distinct from `access`, which controls
   * entitlement — hiding does not make a public artifact private. */
  hidden?: boolean;
  /** "upload" or "drive". */
  source?: string;
  source_ref?: string | null;
}

export interface ArtifactVersion {
  version: number;
  sha256: string | null;
  issued_at: string | null;
  valid_until: string | null;
  current: boolean;
  note?: string | null;
}

export interface Recommendation {
  level: "approve" | "review" | "caution";
  reasons: string[];
}

export interface KeyRequestItem {
  id: string;
  requester: { name: string; domain: string; contact: string; company?: string | null };
  reason?: string | null;
  scope: string[];
  artifact_ids: string[];
  status: "pending" | "granted" | "denied";
  created_at: string;
  decided_at: string | null;
  access_key_id: string | null;
  auto_approved: boolean;
  decision_reason: string | null;
  has_contract: boolean;
  nda_accepted: boolean;
  recommendation?: Recommendation;
}

export interface Insights {
  vendor_id: string;
  requests: { total: number; pending: number; granted: number; denied: number; auto_approved: number };
  keys: { total: number; active: number; revoked: number };
  reads: {
    total: number;
    by_artifact: { artifact_id: string; reads: number }[];
    by_requester: { requester: string; reads: number }[];
  };
  recent_activity: { action: string; actor: string | null; target: string | null; at: string }[];
}

export interface PublicArtifact {
  id: string;
  type: string;
  title: string | null;
  category: string | null;
  issued_at: string;
  valid_until: string | null;
  access: string;
  freshness: string | null;
  product_ids: string[];
  description?: string | null;
  featured?: boolean;
  position?: number;
  /** Present only when the vendor turned on `show_hashes`. */
  sha256?: string | null;
}

export interface ResourceDisplay {
  layout: "list" | "grid" | "table";
  group_by: "category" | "type" | "product" | "none";
  /** Categories in display order. Anything not named here is appended
   * alphabetically, so a new category is never silently dropped. */
  category_order: string[];
  show_descriptions: boolean;
  show_dates: boolean;
  show_hashes: boolean;
  feature_band: boolean;
  empty_message?: string | null;
}

export interface ArtifactPresentationItem {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  position?: number;
  featured?: boolean;
  hidden?: boolean;
}

/** One auto-classification rule for a linked Drive folder. First match wins. */
export interface DriveRule {
  match: string;
  action?: "include" | "review" | "exclude";
  type?: string;
  category?: string;
  access?: "public" | "key_required";
  title?: string;
  label?: string;
  reason?: string;
}

export interface DriveConnection {
  id: string;
  vendor_id: string;
  folder_id: string;
  folder_name: string | null;
  auth_type: "oauth" | "service_account";
  /** Whether credentials are stored. The credentials themselves are never returned. */
  credentials_set: boolean;
  recursive: boolean;
  sync_mode: "manual" | "on_change";
  auto_publish: boolean;
  rules: DriveRule[];
  default_category: string | null;
  default_type: string;
  default_access: "public" | "key_required";
  status: "pending_folder" | "connected" | "error" | "disabled";
  /** Authorized at Google but not yet pointed at a folder. Syncs nothing. */
  needs_folder: boolean;
  last_error: string | null;
  last_sync_at: string | null;
  last_sync_summary: DriveSyncSummary | Record<string, never>;
  created_at: string | null;
  files: DriveFileCounts | Record<string, never>;
}

/** Whether the operator configured a Google OAuth client for this network. When
 * false, owners must supply their own credentials instead of clicking through. */
export interface DriveOAuthAvailability {
  oauth_available: boolean;
  redirect_uri: string | null;
}

export type DriveConnectionStatus =
  | ({ connected: true } & DriveConnection & DriveOAuthAvailability)
  | ({ connected: false; vendor_id: string } & DriveOAuthAvailability);

export interface DriveConnectInput {
  folder_id: string;
  auth_type?: "oauth" | "service_account";
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  service_account_json?: string;
  recursive?: boolean;
  sync_mode?: "manual" | "on_change";
  auto_publish?: boolean;
  rules?: DriveRule[];
  default_category?: string | null;
  default_type?: string;
  default_access?: "public" | "key_required";
}

export interface DriveSyncSummary {
  discovered: number;
  new: number;
  updated: number;
  unchanged: number;
  published: number;
  versioned: number;
  queued: number;
  auto_excluded: number;
  missing: number;
  errors: string[];
  at: string;
}

export interface DriveFileCounts {
  total: number;
  pending: number;
  included: number;
  excluded: number;
}

export interface DriveFileItem {
  id: number;
  drive_file_id: string;
  name: string;
  path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  modified_time: string | null;
  web_view_link: string | null;
  decision: "pending" | "included" | "excluded";
  exclude_reason: string | null;
  matched_rule: string | null;
  proposed: {
    type: string | null;
    title: string | null;
    category: string | null;
    access: string | null;
  };
  artifact_id: string | null;
  artifact: {
    id: string;
    title: string | null;
    type: string;
    version: number;
    access: string;
    category: string | null;
    hidden: boolean;
    featured: boolean;
  } | null;
  synced_at: string | null;
  missing_since: string | null;
  last_seen_at: string | null;
}

export interface DriveDecisionInput {
  decision: "included" | "excluded";
  reason?: string;
  type?: string;
  title?: string;
  category?: string | null;
  access?: "public" | "key_required";
  description?: string;
  position?: number;
  featured?: boolean;
  hidden?: boolean;
  product_ids?: string[];
  issued_at?: string;
  valid_until?: string;
}

export interface DriveRulePreviewRow {
  file_id: number;
  name: string;
  path: string | null;
  current_decision: string;
  would: {
    action: "include" | "review" | "exclude";
    type: string;
    category: string | null;
    access: string;
    title: string;
    rule: string | null;
    reason: string | null;
  };
}

export type OscalModel =
  | "component-definition"
  | "system-security-plan"
  | "assessment-plan"
  | "assessment-results"
  | "plan-of-action-and-milestones";

export interface OscalCapabilities {
  oscal_version: string;
  document_version: string;
  formats: string[];
  vendor_models: { name: string; description: string }[];
  network_models: { name: string; description: string }[];
  aliases: Record<string, string>;
  frameworks: { id: string; name: string; controls: number }[];
  exchange: Record<string, Record<string, string>>;
  notes: string[];
}

export interface OscalBundle {
  vendor_id: string;
  oscal_version: string;
  generated_at: string;
  frameworks: string[];
  /** Content digest per document. Store these and re-parse only what moved. */
  digests: Record<string, string>;
  documents: Record<string, Record<string, unknown>>;
  cursor: number;
}

export interface OscalChange {
  sequence: number;
  event: string;
  subject: string | null;
  /** The OSCAL models this change invalidates. */
  models: string[];
  detail: Record<string, unknown>;
  at: string | null;
}

export interface OscalChangeBatch {
  vendor_id: string;
  since: number;
  cursor: number;
  latest: number;
  /** True when the page was full — keep paging before assuming you are caught up. */
  has_more: boolean;
  changes: OscalChange[];
}

export interface OscalSubscription {
  id: string;
  vendor_id: string;
  url: string;
  models: string[];
  format: string;
  status: "active" | "suspended" | "cancelled";
  last_cursor: number;
  last_status: string | null;
  failures: number;
  created_at: string | null;
}

export interface OscalValidationReport {
  valid: boolean;
  model: string | null;
  issues: { severity: string; path: string; message: string }[];
}

export interface OscalImportResult {
  applied: boolean;
  dry_run: boolean;
  plan: {
    model: string | null;
    valid: boolean;
    counts: Record<string, number>;
    claims: { key: string; value: unknown; evidence: string[]; source: string }[];
    controls: { category: string; name: string; status: string }[];
    subprocessors: { name: string }[];
    evidence: { title: string; href: string | null; sha256: string | null }[];
    notes: string[];
  };
  result?: { mode: string; applied: Record<string, number> };
}

export class TrustMCPClient {
  private network: string;
  private serviceToken?: string;
  private fetchImpl: typeof fetch;

  constructor(opts: TrustMCPClientOptions) {
    this.network = opts.network.replace(/\/$/, "");
    this.serviceToken = opts.serviceToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async req<T>(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.network}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const detail =
        (body && (body.detail || body.message)) || res.statusText || "request failed";
      throw new TrustMCPError(typeof detail === "string" ? detail : JSON.stringify(detail), res.status, body);
    }
    return body as T;
  }

  private service(): Record<string, string> {
    if (!this.serviceToken) throw new TrustMCPError("service token not configured", 500);
    return { "x-trustmcp-service-token": this.serviceToken };
  }

  private owner(token: string): Record<string, string> {
    return { "x-trustmcp-owner-token": token };
  }

  // --- service ---
  createVendor(input: {
    legal_name: string;
    product?: string;
    products?: string[];
    domains?: string[];
    notify_email?: string;
  }): Promise<VendorCreated> {
    return this.req("/v1/vendors", {
      method: "POST",
      headers: this.service(),
      body: JSON.stringify(input),
    });
  }

  // --- owner: profile ---
  getVendor(vendorId: string, ownerToken: string): Promise<Vendor> {
    return this.req(`/v1/vendors/${vendorId}`, { headers: this.owner(ownerToken) });
  }

  updateProfile(
    vendorId: string,
    ownerToken: string,
    input: {
      legal_name?: string;
      product?: string;
      products?: { id?: string; name: string }[];
      domains?: string[];
      branding?: Branding;
      notify_email?: string;
      notify_on_request?: boolean;
      listed?: boolean;
      auto_approve_domains?: string[];
      auto_approve_crm?: boolean;
      auto_approve_on_contract?: boolean;
      nda_required?: boolean;
      nda_text?: string;
      dpa_self_serve?: boolean;
      dpa_intro?: string;
      dpa_template_id?: string;
      webhook_url?: string;
      webhook_secret?: string;
      crm_provider?: string;
      crm_token?: string;
      crm_instance_url?: string;
      crm_connection?: string; // "api" | "mcp"
      crm_mcp_url?: string;
      crm_mcp_token?: string;
      crm_mcp_auth?: string; // "bearer" | "oauth"
      crm_mcp_client_id?: string;
      crm_mcp_client_secret?: string;
      crm_mcp_token_url?: string;
      docusign_account_id?: string;
      docusign_integration_key?: string;
      docusign_user_id?: string;
      docusign_private_key?: string;
      docusign_auth_host?: string;
      docusign_base_uri?: string;
      docusign_connect_hmac_key?: string;
      agent_auto_approve?: boolean;
      watermark_downloads?: boolean;
    },
  ): Promise<Vendor> {
    return this.req(`/v1/vendors/${vendorId}/profile`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  async uploadBrandingLogo(
    vendorId: string,
    ownerToken: string,
    file: Blob,
    filename: string,
  ): Promise<{ logo_url: string }> {
    const form = new FormData();
    form.append("file", file, filename);
    const res = await this.fetchImpl(`${this.network}/v1/vendors/${vendorId}/branding/logo`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: form,
    });
    if (!res.ok) throw new TrustMCPError("logo upload failed", res.status, await res.text());
    return res.json();
  }

  /** Upload the wide / horizontal lockup logo (shown in the trust-center header). */
  async uploadBrandingLogoWide(
    vendorId: string,
    ownerToken: string,
    file: Blob,
    filename: string,
  ): Promise<{ wide_logo_url: string }> {
    const form = new FormData();
    form.append("file", file, filename);
    const res = await this.fetchImpl(`${this.network}/v1/vendors/${vendorId}/branding/logo/wide`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: form,
    });
    if (!res.ok) throw new TrustMCPError("wide logo upload failed", res.status, await res.text());
    return res.json();
  }

  publish(vendorId: string, ownerToken: string): Promise<Vendor> {
    return this.req(`/v1/vendors/${vendorId}/publish`, {
      method: "POST",
      headers: this.owner(ownerToken),
    });
  }

  // --- owner: artifacts ---
  listArtifacts(vendorId: string, ownerToken: string): Promise<ArtifactOut[]> {
    return this.req(`/v1/vendors/${vendorId}/artifacts`, { headers: this.owner(ownerToken) });
  }

  createArtifact(
    vendorId: string,
    ownerToken: string,
    input: {
      type: string;
      title?: string;
      format?: string;
      issued_at: string;
      valid_until?: string | null;
      scope?: string;
      category?: string;
      access?: "public" | "key_required";
      product_ids?: string[];
      description?: string;
      position?: number;
      featured?: boolean;
      hidden?: boolean;
    },
  ): Promise<ArtifactOut> {
    return this.req(`/v1/vendors/${vendorId}/artifacts`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  async uploadArtifactContent(
    vendorId: string,
    ownerToken: string,
    artifactId: string,
    file: Blob,
    filename: string,
    note?: string,
  ): Promise<ArtifactOut> {
    const form = new FormData();
    form.append("file", file, filename);
    if (note) form.append("note", note);
    const res = await this.fetchImpl(
      `${this.network}/v1/vendors/${vendorId}/artifacts/${artifactId}/content`,
      { method: "POST", headers: this.owner(ownerToken), body: form },
    );
    if (!res.ok) throw new TrustMCPError("upload failed", res.status, await res.text());
    return res.json();
  }

  getArtifactVersions(
    vendorId: string,
    ownerToken: string,
    artifactId: string,
  ): Promise<{ artifact_id: string; versions: ArtifactVersion[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/artifacts/${artifactId}/versions`, {
      headers: this.owner(ownerToken),
    });
  }

  updateArtifact(
    vendorId: string,
    ownerToken: string,
    artifactId: string,
    input: {
      type?: string;
      title?: string;
      format?: string;
      issued_at?: string;
      valid_until?: string | null;
      scope?: string;
      category?: string;
      access?: "public" | "key_required";
      product_ids?: string[];
      description?: string | null;
      position?: number;
      featured?: boolean;
      hidden?: boolean;
    },
  ): Promise<ArtifactOut> {
    return this.req(`/v1/vendors/${vendorId}/artifacts/${artifactId}`, {
      method: "PATCH",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  deleteVendor(vendorId: string, ownerToken: string): Promise<void> {
    return this.req(`/v1/vendors/${vendorId}`, {
      method: "DELETE",
      headers: this.owner(ownerToken),
    });
  }

  deleteArtifact(vendorId: string, ownerToken: string, artifactId: string): Promise<void> {
    return this.req(`/v1/vendors/${vendorId}/artifacts/${artifactId}`, {
      method: "DELETE",
      headers: this.owner(ownerToken),
    });
  }

  // --- owner: attestations / subprocessors ---
  getOwnerAttestations(
    vendorId: string,
    ownerToken: string,
  ): Promise<{ claims: { key: string; value: unknown; evidence: string[] }[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/attestations`, {
      headers: this.owner(ownerToken),
    });
  }

  getOwnerSubprocessors(
    vendorId: string,
    ownerToken: string,
  ): Promise<{ subprocessors: SubprocessorItem[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/subprocessors`, {
      headers: this.owner(ownerToken),
    });
  }

  replaceAttestations(
    vendorId: string,
    ownerToken: string,
    claims: { key: string; value: unknown; evidence: string[] }[],
  ): Promise<{ count: number }> {
    return this.req(`/v1/vendors/${vendorId}/attestations`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ claims }),
    });
  }

  replaceSubprocessors(
    vendorId: string,
    ownerToken: string,
    subprocessors: {
      name: string;
      purpose?: string;
      location?: string;
      domain?: string;
      category?: string;
      logo_url?: string;
    }[],
  ): Promise<{ count: number }> {
    return this.req(`/v1/vendors/${vendorId}/subprocessors`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ subprocessors }),
    });
  }

  // --- owner: trust-center sections (badges/controls/data/faq/updates) ---
  getOwnerBadges(vendorId: string, ownerToken: string): Promise<{ badges: Badge[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/badges`, { headers: this.owner(ownerToken) });
  }

  replaceBadges(vendorId: string, ownerToken: string, badges: Badge[]): Promise<{ count: number }> {
    return this.req(`/v1/vendors/${vendorId}/badges`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ badges }),
    });
  }

  getOwnerControls(vendorId: string, ownerToken: string): Promise<{ controls: ControlItem[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/controls`, { headers: this.owner(ownerToken) });
  }

  replaceControls(
    vendorId: string,
    ownerToken: string,
    controls: ControlItem[],
  ): Promise<{ count: number }> {
    return this.req(`/v1/vendors/${vendorId}/controls`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ controls }),
    });
  }

  getOwnerDataTypes(vendorId: string, ownerToken: string): Promise<{ data_types: DataTypeItem[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/data-types`, {
      headers: this.owner(ownerToken),
    });
  }

  replaceDataTypes(
    vendorId: string,
    ownerToken: string,
    data_types: DataTypeItem[],
  ): Promise<{ count: number }> {
    return this.req(`/v1/vendors/${vendorId}/data-types`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ data_types }),
    });
  }

  getOwnerFaqs(vendorId: string, ownerToken: string): Promise<{ faqs: FaqItem[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/faqs`, { headers: this.owner(ownerToken) });
  }

  replaceFaqs(vendorId: string, ownerToken: string, faqs: FaqItem[]): Promise<{ count: number }> {
    return this.req(`/v1/vendors/${vendorId}/faqs`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ faqs }),
    });
  }

  getOwnerUpdates(vendorId: string, ownerToken: string): Promise<{ updates: UpdateItem[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/updates`, { headers: this.owner(ownerToken) });
  }

  replaceUpdates(
    vendorId: string,
    ownerToken: string,
    updates: UpdateItem[],
  ): Promise<{ count: number }> {
    return this.req(`/v1/vendors/${vendorId}/updates`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ updates }),
    });
  }

  listSubscribers(
    vendorId: string,
    ownerToken: string,
  ): Promise<{ count: number; subscribers: { email: string; since: string }[] }> {
    return this.req(`/v1/vendors/${vendorId}/subscribers`, { headers: this.owner(ownerToken) });
  }

  listAgreements(
    vendorId: string,
    ownerToken: string,
  ): Promise<
    {
      id: string;
      type: string;
      company_name: string;
      signer_name: string;
      signer_email: string;
      signer_title: string | null;
      status: string;
      envelope_id: string | null;
      created_at: string;
    }[]
  > {
    return this.req(`/v1/vendors/${vendorId}/agreements`, { headers: this.owner(ownerToken) });
  }

  sendAgreement(
    vendorId: string,
    ownerToken: string,
    agreementId: string,
  ): Promise<{ id: string; status: string; envelope_id: string }> {
    return this.req(`/v1/vendors/${vendorId}/agreements/${agreementId}/send`, {
      method: "POST",
      headers: this.owner(ownerToken),
    });
  }

  // --- owner: domains / mark ---
  listDomains(
    vendorId: string,
    ownerToken: string,
  ): Promise<
    {
      domain: string;
      verified: boolean;
      method: string;
      dns_record_name: string;
      dns_record_value: string;
      well_known_url: string;
    }[]
  > {
    return this.req(`/v1/vendors/${vendorId}/domains`, { headers: this.owner(ownerToken) });
  }

  addDomain(vendorId: string, ownerToken: string, domain: string): Promise<unknown> {
    return this.req(`/v1/vendors/${vendorId}/domains`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ domain }),
    });
  }

  verifyDomain(vendorId: string, ownerToken: string, domain: string): Promise<unknown> {
    return this.req(`/v1/vendors/${vendorId}/domains/${domain}/verify`, {
      method: "POST",
      headers: this.owner(ownerToken),
    });
  }

  removeDomain(
    vendorId: string,
    ownerToken: string,
    domain: string,
  ): Promise<{ domain: string; removed: boolean; mark_status: string }> {
    return this.req(`/v1/vendors/${vendorId}/domains/${domain}`, {
      method: "DELETE",
      headers: this.owner(ownerToken),
    });
  }

  // --- owner: custom domain hosting (serve the trust center on a customer
  // domain, e.g. trust.acme.com, via CNAME) ---
  getCustomDomain(
    vendorId: string,
    ownerToken: string,
  ): Promise<CustomDomainStatus> {
    return this.req(`/v1/vendors/${vendorId}/custom-domain`, { headers: this.owner(ownerToken) });
  }

  setCustomDomain(
    vendorId: string,
    ownerToken: string,
    domain: string,
  ): Promise<CustomDomainStatus> {
    return this.req(`/v1/vendors/${vendorId}/custom-domain`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ domain }),
    });
  }

  verifyCustomDomain(vendorId: string, ownerToken: string): Promise<CustomDomainStatus> {
    return this.req(`/v1/vendors/${vendorId}/custom-domain/verify`, {
      method: "POST",
      headers: this.owner(ownerToken),
    });
  }

  removeCustomDomain(vendorId: string, ownerToken: string): Promise<{ removed: boolean }> {
    return this.req(`/v1/vendors/${vendorId}/custom-domain`, {
      method: "DELETE",
      headers: this.owner(ownerToken),
    });
  }

  /**
   * Best-effort detect the DNS provider for a domain (by nameservers). Returns the
   * provider key (or null), whether we can auto-configure it via API (`can_auto`), a
   * human label, a deep-link to the provider's DNS panel, the credential fields its
   * API needs, and a `catalog` of all auto-configurable providers for a manual
   * override in the UI.
   */
  detectDnsProvider(
    vendorId: string,
    ownerToken: string,
    domain: string,
  ): Promise<DnsProviderDetection> {
    return this.req(`/v1/vendors/${vendorId}/custom-domain/dns/detect`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ domain }),
    });
  }

  /**
   * Auto-create the required CNAME + TXT records at the user's DNS provider.
   * Credentials are forwarded for this single call and never stored by the
   * network.
   */
  autoConfigureDns(
    vendorId: string,
    ownerToken: string,
    input: { domain: string; provider: string; credentials: Record<string, string> },
  ): Promise<{ ok: boolean }> {
    return this.req(`/v1/vendors/${vendorId}/custom-domain/dns/auto-configure`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  /**
   * Discover whether the domain's DNS provider supports the Domain Connect
   * synchronous flow (the open "Plaid for DNS" standard). When supported, returns an
   * `apply_url` — a provider-hosted consent page the user opens (typically in a
   * popup) to approve the CNAME + TXT directly at their provider. No credentials are
   * collected or stored.
   */
  discoverDomainConnect(
    vendorId: string,
    ownerToken: string,
    domain: string,
  ): Promise<{ supported: boolean; provider_name: string | null; apply_url: string | null }> {
    return this.req(`/v1/vendors/${vendorId}/custom-domain/dns/domain-connect/discover`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ domain }),
    });
  }

  // --- operator: mark revocation (service-token scoped — network trust anchor) ---
  revokeMark(
    vendorId: string,
    reason?: string,
  ): Promise<{ vendor_id: string; mark_status: string; reason: string | null }> {
    return this.req(`/v1/vendors/${vendorId}/mark/revoke`, {
      method: "POST",
      headers: this.service(),
      body: JSON.stringify({ reason: reason ?? null }),
    });
  }

  reinstateMark(vendorId: string): Promise<{ vendor_id: string; mark_status: string }> {
    return this.req(`/v1/vendors/${vendorId}/mark/reinstate`, {
      method: "POST",
      headers: this.service(),
    });
  }

  // --- owner: keys / audit ---
  listKeyRequests(vendorId: string, ownerToken: string): Promise<KeyRequestItem[]> {
    return this.req(`/v1/vendors/${vendorId}/keys/requests`, { headers: this.owner(ownerToken) });
  }

  getInsights(vendorId: string, ownerToken: string): Promise<Insights> {
    return this.req(`/v1/vendors/${vendorId}/insights`, { headers: this.owner(ownerToken) });
  }

  approveKeyRequest(
    vendorId: string,
    ownerToken: string,
    requestId: string,
    body: { scope?: string[]; ttl_days?: number; artifact_ids?: string[] } = {},
  ): Promise<{ key?: string; key_id?: string; scope?: string[]; expires_at?: string }> {
    return this.req(`/v1/vendors/${vendorId}/keys/requests/${requestId}/approve`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify(body),
    });
  }

  denyKeyRequest(vendorId: string, ownerToken: string, requestId: string): Promise<unknown> {
    return this.req(`/v1/vendors/${vendorId}/keys/requests/${requestId}/deny`, {
      method: "POST",
      headers: this.owner(ownerToken),
    });
  }

  listKeys(vendorId: string, ownerToken: string): Promise<unknown[]> {
    return this.req(`/v1/vendors/${vendorId}/keys`, { headers: this.owner(ownerToken) });
  }

  revokeKey(vendorId: string, ownerToken: string, keyId: string): Promise<unknown> {
    return this.req(`/v1/vendors/${vendorId}/keys/${keyId}/revoke`, {
      method: "POST",
      headers: this.owner(ownerToken),
    });
  }

  getAudit(vendorId: string, ownerToken: string): Promise<unknown[]> {
    return this.req(`/v1/vendors/${vendorId}/audit`, { headers: this.owner(ownerToken) });
  }

  // --- public + consumer ---
  getMark(vendorId: string): Promise<{
    vendor_id: string;
    legal_name: string;
    mark: string;
    verified_domains: string[];
    issued: boolean;
  }> {
    return this.req(`/v1/mark/${vendorId}`);
  }

  getDirectory(): Promise<{
    count: number;
    vendors: {
      id: string;
      legal_name: string;
      product: string | null;
      domains: string[];
      mark: string;
      display_name: string;
      headline: string | null;
    }[];
  }> {
    return this.req("/v1/directory");
  }

  async requestAccessWithContract(
    input: {
      vendor_id: string;
      requester: { name: string; domain: string; contact: string };
      scope: string[];
      nda_accepted?: boolean;
    },
    file: Blob,
    filename: string,
  ): Promise<{ status: string; request_id?: string; key?: string; reason?: string }> {
    const form = new FormData();
    form.append("vendor_id", input.vendor_id);
    form.append("name", input.requester.name);
    form.append("domain", input.requester.domain);
    form.append("contact", input.requester.contact);
    form.append("scope", JSON.stringify(input.scope));
    if (input.nda_accepted) form.append("nda_accepted", "true");
    form.append("file", file, filename);
    const res = await this.fetchImpl(`${this.network}/v1/keys/request-with-contract`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new TrustMCPError("contract request failed", res.status, await res.text());
    return res.json();
  }

  getPublicProfile(vendorId: string): Promise<{
    vendor: { id: string; legal_name: string; product: string | null; products: Product[]; domains: string[]; branding: Branding };
    mark: string;
    verified_domains: string[];
    published_at: string | null;
    artifacts: PublicArtifact[];
    /** The same resources, grouped and ordered the way the vendor configured. */
    resources?: {
      display: ResourceDisplay;
      featured: PublicArtifact[];
      groups: { title: string; resources: PublicArtifact[] }[];
    };
    badges: Badge[];
    controls: ControlItem[];
    controls_updated_at: string | null;
    data_types: DataTypeItem[];
    subprocessors: SubprocessorItem[];
    faqs: FaqItem[];
    updates: UpdateItem[];
    claim_keys: string[];
    available_scopes: string[];
    accepts_contract?: boolean;
    nda_required?: boolean;
    nda_text?: string | null;
    dpa_self_serve?: boolean;
    dpa_intro?: string | null;
    ask_enabled?: boolean;
  }> {
    return this.req(`/v1/vendors/${vendorId}/public`);
  }

  /**
   * Resolve a custom-domain hostname (e.g. trust.acme.com) to its published vendor
   * id, or null when no published+verified vendor claims it. Used to serve each
   * vendor's trust center on their own connected domain.
   */
  async resolveCustomDomain(host: string): Promise<string | null> {
    try {
      const res = await this.req<{ vendor_id: string }>(
        `/v1/custom-domains/resolve?host=${encodeURIComponent(host)}`,
      );
      return res.vendor_id;
    } catch (e) {
      if (e instanceof TrustMCPError && e.status === 404) return null;
      throw e;
    }
  }

  getPublicArtifact(
    vendorId: string,
    artifactId: string,
  ): Promise<{
    id: string;
    sha256: string | null;
    url: string;
    content_type?: string | null;
    expires_in: number;
  }> {
    return this.req(`/v1/vendors/${vendorId}/artifacts/${artifactId}/public`);
  }

  requestAccess(input: {
    vendor_id: string;
    requester: { name: string; domain: string; contact: string };
    scope?: string[];
    artifact_ids?: string[];
    company?: string;
    reason?: string;
    nda_accepted?: boolean;
  }): Promise<{ status: string; request_id?: string; vendor_id: string; key?: string; reason?: string }> {
    return this.req("/v1/keys/request", { method: "POST", body: JSON.stringify(input) });
  }

  // --- public engagement: subscribe / ask / reclaim / agreements ---
  subscribe(vendorId: string, email: string): Promise<{ status: string; email: string }> {
    return this.req(`/v1/vendors/${vendorId}/subscribe`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  ask(vendorId: string, question: string): Promise<{ available: boolean; answer: string }> {
    return this.req(`/v1/vendors/${vendorId}/ask`, {
      method: "POST",
      body: JSON.stringify({ question }),
    });
  }

  reclaimAccess(vendorId: string, email: string): Promise<{ status: string; message: string }> {
    return this.req(`/v1/vendors/${vendorId}/reclaim`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  submitAgreement(
    vendorId: string,
    input: AgreementInput,
  ): Promise<{ status: string; id: string }> {
    return this.req(`/v1/vendors/${vendorId}/agreements`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // --- frameworks, graph, signing ---
  getFrameworks(): Promise<{ frameworks: { id: string; name: string; controls: number }[] }> {
    return this.req("/v1/frameworks");
  }

  getMappedAttestations(
    vendorId: string,
    accessKey: string,
    framework: string,
  ): Promise<{
    vendor_id: string;
    framework: string;
    name: string;
    controls: {
      control: string;
      title: string;
      claims: { key: string; value: unknown; evidence: string[] }[];
      present: boolean;
    }[];
  }> {
    return this.req(`/v1/vendors/${vendorId}/attestations/mapped?framework=${framework}`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  getSubprocessorGraph(
    vendorId: string,
    accessKey: string,
  ): Promise<{
    vendor_id: string;
    subprocessors: {
      name: string;
      purpose: string | null;
      location: string | null;
      domain: string | null;
      linked_vendor: { vendor_id: string; legal_name: string; mark: string } | null;
    }[];
  }> {
    return this.req(`/v1/vendors/${vendorId}/graph`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  getNetworkKey(): Promise<{ alg: string; public_key: string; key_id: string }> {
    return this.req("/v1/network/key");
  }

  getManifest(vendorId: string, accessKey: string): Promise<Manifest> {
    return this.req(`/v1/vendors/${vendorId}/manifest`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  getAttestations(vendorId: string, accessKey: string): Promise<Attestations> {
    return this.req(`/v1/vendors/${vendorId}/attestations`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  getFreshness(vendorId: string, accessKey: string): Promise<Freshness> {
    return this.req(`/v1/vendors/${vendorId}/freshness`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  // --- owner: public resource presentation ---

  getResourceDisplay(
    vendorId: string,
    ownerToken: string,
  ): Promise<{ display: ResourceDisplay; categories_in_use: string[] }> {
    return this.req(`/v1/vendors/${vendorId}/manage/resource-display`, {
      headers: this.owner(ownerToken),
    });
  }

  updateResourceDisplay(
    vendorId: string,
    ownerToken: string,
    input: Partial<ResourceDisplay>,
  ): Promise<{ display: ResourceDisplay }> {
    return this.req(`/v1/vendors/${vendorId}/resource-display`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  /** Reorder and re-label several resources in one request, so a drag-to-reorder
   * list never renders half-applied. */
  updateArtifactPresentation(
    vendorId: string,
    ownerToken: string,
    items: ArtifactPresentationItem[],
  ): Promise<{ updated: number; artifacts: ArtifactOut[] }> {
    return this.req(`/v1/vendors/${vendorId}/artifacts/presentation`, {
      method: "PUT",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ items }),
    });
  }

  // --- owner: Google Drive sync ---

  getDriveConnection(
    vendorId: string,
    ownerToken: string,
  ): Promise<DriveConnectionStatus> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive`, {
      headers: this.owner(ownerToken),
    });
  }

  connectDrive(
    vendorId: string,
    ownerToken: string,
    input: DriveConnectInput,
  ): Promise<DriveConnection> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  updateDriveConnection(
    vendorId: string,
    ownerToken: string,
    input: Partial<
      Pick<
        DriveConnection,
        | "recursive"
        | "sync_mode"
        | "auto_publish"
        | "rules"
        | "default_category"
        | "default_type"
        | "default_access"
      >
    > & { status?: "connected" | "disabled" },
  ): Promise<DriveConnection> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive`, {
      method: "PATCH",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  /** Unlink the folder. Published artifacts stay unless `purge` is set. */
  async disconnectDrive(
    vendorId: string,
    ownerToken: string,
    purge = false,
  ): Promise<void> {
    await this.req(
      `/v1/vendors/${vendorId}/integrations/drive?purge=${purge ? "true" : "false"}`,
      { method: "DELETE", headers: this.owner(ownerToken) },
    );
  }

  syncDrive(
    vendorId: string,
    ownerToken: string,
  ): Promise<{ summary: DriveSyncSummary; connection: DriveConnection }> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive/sync`, {
      method: "POST",
      headers: this.owner(ownerToken),
    });
  }

  listDriveFiles(
    vendorId: string,
    ownerToken: string,
    decision?: "pending" | "included" | "excluded",
  ): Promise<{ counts: DriveFileCounts; files: DriveFileItem[] }> {
    const query = decision ? `?decision=${decision}` : "";
    return this.req(`/v1/vendors/${vendorId}/integrations/drive/files${query}`, {
      headers: this.owner(ownerToken),
    });
  }

  /** Include or exclude one discovered file. Including publishes it immediately. */
  decideDriveFile(
    vendorId: string,
    ownerToken: string,
    fileId: number,
    input: DriveDecisionInput,
  ): Promise<{ file: DriveFileItem; published: boolean; outcome?: string }> {
    return this.req(
      `/v1/vendors/${vendorId}/integrations/drive/files/${fileId}/decision`,
      {
        method: "POST",
        headers: this.owner(ownerToken),
        body: JSON.stringify(input),
      },
    );
  }

  /** Bulk exclusion only — publishing stays a per-file decision. */
  excludeDriveFiles(
    vendorId: string,
    ownerToken: string,
    fileIds: number[],
    reason?: string,
  ): Promise<{ excluded: number; counts: DriveFileCounts }> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive/files/decisions`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ decision: "excluded", file_ids: fileIds, reason }),
    });
  }

  /** Show what a rule set would do to the files already discovered, before saving it. */
  previewDriveRules(
    vendorId: string,
    ownerToken: string,
    rules: DriveRule[],
  ): Promise<{ counts: Record<string, number>; files: DriveRulePreviewRow[] }> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive/rules/preview`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ rules }),
    });
  }

  /** Begin the click-through connection. Returns the Google consent URL to open,
   * built from the network's own OAuth client — the owner supplies nothing. */
  driveOAuthStart(
    vendorId: string,
    ownerToken: string,
  ): Promise<{
    authorization_url: string;
    redirect_uri: string;
    scope: string;
    expires_in: number;
  }> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive/oauth/start`, {
      headers: this.owner(ownerToken),
    });
  }

  /** Finish consent: the network trades the code for tokens and stores them.
   * The connection lands at `pending_folder` until a folder is chosen. */
  driveOAuthExchange(
    vendorId: string,
    ownerToken: string,
    input: { code: string; state: string },
  ): Promise<DriveConnection & { needs_folder: boolean }> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive/oauth/exchange`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify(input),
    });
  }

  /** Folders inside `parent`, for the picker. Requires an authorized connection. */
  listDriveFolders(
    vendorId: string,
    ownerToken: string,
    parent = "root",
  ): Promise<{
    parent: string;
    current: { id: string; name: string | null };
    folders: { id: string; name: string }[];
    shared_drives: { id: string; name: string }[];
    selected_folder_id: string | null;
  }> {
    return this.req(
      `/v1/vendors/${vendorId}/integrations/drive/folders?parent=${encodeURIComponent(parent)}`,
      { headers: this.owner(ownerToken) },
    );
  }

  /** Choose the folder to sync, completing a click-through connection. */
  setDriveFolder(
    vendorId: string,
    ownerToken: string,
    folderId: string,
  ): Promise<DriveConnection> {
    return this.req(`/v1/vendors/${vendorId}/integrations/drive/folder`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ folder_id: folderId }),
    });
  }

  // --- consumer: OSCAL ---

  getOscalCapabilities(): Promise<OscalCapabilities> {
    return this.req("/v1/oscal/capabilities");
  }

  /** One OSCAL model for a vendor. JSON only — use the REST endpoint directly for
   * YAML or XML, which are meant to be handed to another tool as bytes. */
  getOscalModel(
    vendorId: string,
    accessKey: string,
    model: OscalModel | string = "component-definition",
    frameworks?: string[],
  ): Promise<Record<string, unknown>> {
    const query = frameworks?.length ? `?framework=${frameworks.join(",")}` : "";
    return this.req(`/v1/vendors/${vendorId}/oscal/${model}${query}`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  getOscalBundle(
    vendorId: string,
    accessKey: string,
    frameworks?: string[],
  ): Promise<OscalBundle> {
    const query = frameworks?.length ? `?framework=${frameworks.join(",")}` : "";
    return this.req(`/v1/vendors/${vendorId}/oscal/bundle${query}`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  /** Poll the change feed. Pass the `cursor` from the previous response. */
  getOscalChanges(
    vendorId: string,
    accessKey: string,
    since = 0,
    opts: { limit?: number; models?: string[] } = {},
  ): Promise<OscalChangeBatch> {
    const params = new URLSearchParams({ since: String(since) });
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.models?.length) params.set("models", opts.models.join(","));
    return this.req(`/v1/vendors/${vendorId}/oscal/changes?${params}`, {
      headers: { authorization: `Bearer ${accessKey}` },
    });
  }

  subscribeOscalChanges(
    vendorId: string,
    accessKey: string,
    input: { url: string; secret?: string; models?: string[] },
  ): Promise<OscalSubscription> {
    return this.req(`/v1/vendors/${vendorId}/oscal/subscriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessKey}` },
      body: JSON.stringify(input),
    });
  }

  /** Populate a trust center from an OSCAL document. A dry run unless `apply`. */
  importOscal(
    vendorId: string,
    ownerToken: string,
    document: Record<string, unknown>,
    opts: { apply?: boolean; mode?: "merge" | "replace" } = {},
  ): Promise<OscalImportResult> {
    return this.req(`/v1/vendors/${vendorId}/oscal/import`, {
      method: "POST",
      headers: this.owner(ownerToken),
      body: JSON.stringify({ document, ...opts }),
    });
  }

  validateOscal(document: Record<string, unknown>): Promise<OscalValidationReport> {
    return this.req("/v1/oscal/validate", {
      method: "POST",
      body: JSON.stringify(document),
    });
  }
}

export type { Manifest, Attestations, Freshness } from "@trustmcp/spec";
