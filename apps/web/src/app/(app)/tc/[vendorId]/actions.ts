"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveClaim, type ClaimTemplate } from "@/lib/attestation-claims";
import { trustmcp } from "@/lib/trustmcp";
import type { DnsProviderDetection } from "@trustmcp/sdk";
import { sendMail } from "@/lib/mail";
import { canManage, canReviewRequests } from "@/lib/roles";
import { getRole } from "@/lib/team";
import { getTrustCenterForUser, requireUser } from "@/lib/trustcenter";

async function ctx(vendorId: string) {
  const user = await requireUser();
  const tc = await getTrustCenterForUser(user.id, vendorId);
  if (!tc) throw new Error("FORBIDDEN");
  // Content/config mutations require owner/admin.
  const role = await getRole(user.id, tc.orgId);
  if (!canManage(role)) throw new Error("FORBIDDEN: requires admin or owner role");
  return { tc, client: trustmcp() };
}

// Access-request decisions (approve/deny/revoke) are also open to the
// "request reviewer" role, who can gate access without editing the trust center.
async function reviewCtx(vendorId: string) {
  const user = await requireUser();
  const tc = await getTrustCenterForUser(user.id, vendorId);
  if (!tc) throw new Error("FORBIDDEN");
  const role = await getRole(user.id, tc.orgId);
  if (!canReviewRequests(role)) throw new Error("FORBIDDEN: requires reviewer, admin, or owner role");
  return { tc, client: trustmcp() };
}

function refresh(vendorId: string) {
  revalidatePath(`/tc/${vendorId}`, "layout");
}

// Include a secret field in the update only when the user typed a new value, so
// a blank input preserves the stored secret instead of clearing it.
function secret(formData: FormData, key: string): Record<string, string> {
  const v = String(formData.get(key) ?? "").trim();
  return v ? { [key]: v } : {};
}

export async function saveBranding(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const s = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || undefined;
  };
  // Product lines arrive as parallel arrays: product_id[] (empty for new) +
  // product_name[]. Zip them, drop blanks, and replace the whole list.
  const productIds = formData.getAll("product_id").map(String);
  const products = formData
    .getAll("product_name")
    .map((name, i) => ({ id: productIds[i]?.trim() || undefined, name: String(name).trim() }))
    .filter((p) => p.name);
  await client.updateProfile(vendorId, tc.ownerToken, {
    legal_name: s("legal_name"),
    products,
    branding: {
      display_name: s("display_name"),
      logo_url: s("logo_url"),
      primary_color: s("primary_color"),
      accent_color: s("accent_color"),
      support_email: s("support_email"),
      headline: s("headline"),
      description: s("description"),
      privacy_policy_url: s("privacy_policy_url"),
      marketplace_url: s("marketplace_url"),
      company_url: s("company_url"),
    },
  });
  redirect(`/tc/${vendorId}/branding?saved=1`);
}

// Returns the new (cache-busted) logo URL so the client can update its preview and
// reset its own state. We deliberately do NOT redirect here: redirecting to the
// same branding route is a soft navigation that doesn't remount the uploader, so
// its "Uploading…" state would never clear. The client calls router.refresh().
export async function uploadLogo(
  vendorId: string,
  formData: FormData,
): Promise<{ url: string } | undefined> {
  const { tc, client } = await ctx(vendorId);
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return undefined;
  const { logo_url } = await client.uploadBrandingLogo(vendorId, tc.ownerToken, file, file.name);
  refresh(vendorId);
  return { url: logo_url };
}

export async function deleteTrustCenter(vendorId: string) {
  const { tc, client } = await ctx(vendorId);
  await client.deleteVendor(vendorId, tc.ownerToken);
  await db.trustCenter.delete({ where: { id: tc.id } }).catch(() => {});
  redirect("/dashboard");
}

export async function saveSettings(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const bool = (k: string) => formData.get(k) === "on";
  const domainsRaw = String(formData.get("auto_approve_domains") ?? "");
  const auto_approve_domains = domainsRaw
    .split(/[\n,]/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  await client.updateProfile(vendorId, tc.ownerToken, {
    notify_email: String(formData.get("notify_email") ?? "").trim(),
    notify_on_request: bool("notify_on_request"),
    listed: bool("listed"),
    auto_approve_domains,
    auto_approve_crm: bool("auto_approve_crm"),
    auto_approve_on_contract: bool("auto_approve_on_contract"),
    nda_required: bool("nda_required"),
    nda_text: String(formData.get("nda_text") ?? "").trim(),
    dpa_self_serve: bool("dpa_self_serve"),
    dpa_intro: String(formData.get("dpa_intro") ?? "").trim(),
    dpa_template_id: String(formData.get("dpa_template_id") ?? "").trim(),
    webhook_url: String(formData.get("webhook_url") ?? "").trim(),
    webhook_secret: String(formData.get("webhook_secret") ?? "").trim(),
    crm_provider: String(formData.get("crm_provider") ?? "").trim(),
    crm_instance_url: String(formData.get("crm_instance_url") ?? "").trim(),
    crm_connection: String(formData.get("crm_connection") ?? "api").trim(),
    crm_mcp_url: String(formData.get("crm_mcp_url") ?? "").trim(),
    crm_mcp_auth: String(formData.get("crm_mcp_auth") ?? "").trim(),
    crm_mcp_client_id: String(formData.get("crm_mcp_client_id") ?? "").trim(),
    crm_mcp_token_url: String(formData.get("crm_mcp_token_url") ?? "").trim(),
    docusign_account_id: String(formData.get("docusign_account_id") ?? "").trim(),
    docusign_integration_key: String(formData.get("docusign_integration_key") ?? "").trim(),
    docusign_user_id: String(formData.get("docusign_user_id") ?? "").trim(),
    docusign_auth_host: String(formData.get("docusign_auth_host") ?? "").trim(),
    docusign_base_uri: String(formData.get("docusign_base_uri") ?? "").trim(),
    agent_auto_approve: bool("agent_auto_approve"),
    watermark_downloads: bool("watermark_downloads"),
    // Secrets: only send when a new value is typed, so a blank field keeps the
    // existing stored secret rather than clobbering it on every save.
    ...secret(formData, "crm_token"),
    ...secret(formData, "crm_mcp_token"),
    ...secret(formData, "crm_mcp_client_secret"),
    ...secret(formData, "docusign_private_key"),
    ...secret(formData, "docusign_connect_hmac_key"),
  });
  redirect(`/tc/${vendorId}/settings?saved=1`);
}

export async function publish(vendorId: string) {
  const { tc, client } = await ctx(vendorId);
  await client.publish(vendorId, tc.ownerToken);
  refresh(vendorId);
}

export async function addArtifact(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const type = String(formData.get("type") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || undefined;
  const issued_at = String(formData.get("issued_at") ?? "").trim();
  const valid_until = String(formData.get("valid_until") ?? "").trim() || null;
  const scope = String(formData.get("scope") ?? "").trim() || undefined;
  const category = String(formData.get("category") ?? "").trim() || undefined;
  const format = String(formData.get("format") ?? "").trim() || undefined;
  const access = String(formData.get("access") ?? "key_required") === "public"
    ? "public"
    : "key_required";
  const product_ids = formData.getAll("product_ids").map(String);
  const created = await client.createArtifact(vendorId, tc.ownerToken, {
    type,
    title,
    format,
    issued_at,
    valid_until,
    scope,
    category,
    access,
    product_ids,
  });

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    await client.uploadArtifactContent(vendorId, tc.ownerToken, created.id, file, file.name);
  }
  refresh(vendorId);
}

// Add one or more standardized questionnaires as "Questionnaires"-category
// artifacts. Each starts without content; the owner uploads their completed copy
// from the resource list (same flow as any other document). `code`/`name` arrive
// as parallel arrays (one per picked template).
export async function addQuestionnaires(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const codes = formData.getAll("code").map(String);
  const names = formData.getAll("name").map(String);
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]?.trim();
    const title = (names[i] ?? "").trim();
    if (!title) continue;
    await client.createArtifact(vendorId, tc.ownerToken, {
      type: "questionnaire",
      title,
      format: code || undefined,
      issued_at: today,
      category: "Questionnaires",
      access: "key_required",
    });
  }
  refresh(vendorId);
}

// Add a Software Bill of Materials as a "Bill of Materials"-category artifact of
// type "sbom". Versioning/freshness reuses the standard artifact machinery.
export async function addSbom(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const title = String(formData.get("title") ?? "").trim() || "Software Bill of Materials";
  const format = String(formData.get("format") ?? "").trim() || undefined;
  const access = String(formData.get("access") ?? "key_required") === "public" ? "public" : "key_required";
  const today = new Date().toISOString().slice(0, 10);
  const created = await client.createArtifact(vendorId, tc.ownerToken, {
    type: "sbom",
    title,
    format,
    issued_at: today,
    category: "Bill of Materials",
    access,
  });
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    await client.uploadArtifactContent(vendorId, tc.ownerToken, created.id, file, file.name);
  }
  refresh(vendorId);
}

export async function uploadContent(vendorId: string, artifactId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const file = formData.get("file");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (file instanceof File && file.size > 0) {
    await client.uploadArtifactContent(vendorId, tc.ownerToken, artifactId, file, file.name, note);
  }
  refresh(vendorId);
}

export async function editArtifact(vendorId: string, artifactId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const s = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? undefined : v;
  };
  await client.updateArtifact(vendorId, tc.ownerToken, artifactId, {
    title: s("title"),
    type: s("type"),
    format: s("format"),
    issued_at: s("issued_at"),
    valid_until: formData.get("valid_until") === "" ? null : s("valid_until"),
    scope: s("scope"),
    category: s("category"),
    access: s("access") === "public" ? "public" : s("access") === "key_required" ? "key_required" : undefined,
    // Replace the product association with whatever is checked (empty = none).
    product_ids: formData.getAll("product_ids").map(String),
  });
  refresh(vendorId);
}

export async function deleteArtifact(vendorId: string, artifactId: string) {
  const { tc, client } = await ctx(vendorId);
  await client.deleteArtifact(vendorId, tc.ownerToken, artifactId);
  redirect(`/tc/${vendorId}/artifacts`);
}

export async function saveAttestations(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  // Claims arrive as parallel arrays keyed key[]/value[]/evidence[].
  const keys = formData.getAll("key").map(String);
  const values = formData.getAll("value").map(String);
  const evidences = formData.getAll("evidence").map(String);
  const claims = keys
    .map((key, i) => ({ key: key.trim(), raw: (values[i] ?? "").trim(), ev: (evidences[i] ?? "").trim() }))
    .filter((c) => c.key)
    .map((c) => ({
      key: c.key,
      value: parseClaimValue(c.raw),
      evidence: c.ev ? c.ev.split(",").map((s) => s.trim()).filter(Boolean) : [],
    }));
  await client.replaceAttestations(vendorId, tc.ownerToken, claims);
  refresh(vendorId);
}

function parseClaimValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  if (raw.includes(",")) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw;
}

// --- Attestation auto-fill from a completed questionnaire --------------------

// Parse an uploaded questionnaire into key/answer pairs. Accepts JSON object
// ({key: value}), JSON array ([{key,value} | {question,answer}]), and CSV/TSV.
function parseQuestionnairePairs(text: string): { key: string; raw: string }[] {
  const out: { key: string; raw: string }[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) {
        for (const r of data as Record<string, unknown>[]) {
          const key = String(r.key ?? r.question ?? r.id ?? "").trim();
          const val = r.value ?? r.answer ?? r.response ?? "";
          if (key) out.push({ key, raw: Array.isArray(val) ? val.join(",") : String(val) });
        }
      } else {
        for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
          out.push({ key: String(key), raw: Array.isArray(val) ? val.join(",") : String(val) });
        }
      }
      if (out.length) return out;
    } catch {
      // fall through to delimited parsing
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const sep = raw.includes("\t") ? "\t" : raw.includes(",") ? "," : ":";
    const idx = raw.indexOf(sep);
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim().replace(/^"|"$/g, "");
    const val = raw.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (/^(key|question|claim)$/i.test(key)) continue; // header
    out.push({ key, raw: val });
  }
  return out;
}

function coerceClaimValue(tmpl: ClaimTemplate, raw: string): boolean | string | number | string[] {
  const v = raw.trim();
  if (tmpl.type === "boolean") {
    return /^(true|yes|y|1|✓|x|compliant|implemented|enabled|in place)$/i.test(v);
  }
  if (tmpl.type === "number") {
    const num = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isNaN(num) ? v : num;
  }
  if (tmpl.type === "multiselect") {
    const parts = v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const opts = tmpl.options ?? [];
    const matched = parts
      .map((p) => opts.find((o) => o.toLowerCase() === p.toLowerCase()) ?? p)
      .filter(Boolean);
    return matched;
  }
  if (tmpl.type === "enum") {
    const opt = (tmpl.options ?? []).find((o) => o.toLowerCase() === v.toLowerCase());
    return opt ?? v;
  }
  return v;
}

export async function autofillAttestations(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/tc/${vendorId}/attestations?error=empty`);
  }
  const pairs = parseQuestionnairePairs((await file.text()) || "");
  if (pairs.length === 0) redirect(`/tc/${vendorId}/attestations?error=parse`);

  const { claims: existing } = await client.getOwnerAttestations(vendorId, tc.ownerToken);
  const byKey = new Map<string, { key: string; value: unknown; evidence: string[] }>(
    existing.map((c) => [c.key, { key: c.key, value: c.value, evidence: c.evidence ?? [] }]),
  );
  let matched = 0;
  for (const { key, raw } of pairs) {
    const tmpl = resolveClaim(key);
    if (!tmpl) continue; // only auto-fill recognized catalog claims
    matched += 1;
    byKey.set(tmpl.key, {
      key: tmpl.key,
      value: coerceClaimValue(tmpl, raw),
      evidence: byKey.get(tmpl.key)?.evidence ?? [],
    });
  }
  if (matched === 0) redirect(`/tc/${vendorId}/attestations?error=nomatch`);
  await client.replaceAttestations(vendorId, tc.ownerToken, [...byKey.values()]);
  redirect(`/tc/${vendorId}/attestations?autofilled=${matched}`);
}

export async function saveSubprocessors(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const names = formData.getAll("name").map(String);
  const purposes = formData.getAll("purpose").map(String);
  const locations = formData.getAll("location").map(String);
  const domains = formData.getAll("domain").map(String);
  const categories = formData.getAll("category").map(String);
  const logos = formData.getAll("logo_url").map(String);
  const subprocessors = names
    .map((name, i) => ({
      name: name.trim(),
      purpose: purposes[i]?.trim(),
      location: locations[i]?.trim(),
      domain: domains[i]?.trim() || undefined,
      category: categories[i]?.trim() || undefined,
      logo_url: logos[i]?.trim() || undefined,
    }))
    .filter((s) => s.name);
  await client.replaceSubprocessors(vendorId, tc.ownerToken, subprocessors);
  refresh(vendorId);
}

export async function addDomain(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();
  if (domain) await client.addDomain(vendorId, tc.ownerToken, domain);
  refresh(vendorId);
}

export async function verifyDomain(vendorId: string, domain: string) {
  const { tc, client } = await ctx(vendorId);
  try {
    await client.verifyDomain(vendorId, tc.ownerToken, domain);
  } catch {
    // Surface failure via the page reload; the challenge stays available.
  }
  refresh(vendorId);
}

export async function removeDomain(vendorId: string, domain: string) {
  const { tc, client } = await ctx(vendorId);
  await client.removeDomain(vendorId, tc.ownerToken, domain);
  refresh(vendorId);
}

// ---- Custom domain hosting (serve the trust center on trust.<customer>.com) ----

export async function setCustomDomain(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const domain = String(formData.get("custom_domain") ?? "").trim().toLowerCase();
  if (domain) await client.setCustomDomain(vendorId, tc.ownerToken, domain);
  refresh(vendorId);
}

export async function verifyCustomDomain(vendorId: string) {
  const { tc, client } = await ctx(vendorId);
  try {
    await client.verifyCustomDomain(vendorId, tc.ownerToken);
  } catch {
    // Verification failures (records not yet propagated) surface on reload.
  }
  refresh(vendorId);
}

export async function removeCustomDomain(vendorId: string) {
  const { tc, client } = await ctx(vendorId);
  await client.removeCustomDomain(vendorId, tc.ownerToken);
  refresh(vendorId);
}

/** Detect the DNS provider for the custom domain (best-effort). */
export async function detectDnsProvider(
  vendorId: string,
  domain: string,
): Promise<DnsProviderDetection> {
  const { tc, client } = await ctx(vendorId);
  try {
    return await client.detectDnsProvider(vendorId, tc.ownerToken, domain);
  } catch {
    return { provider: null, supported: false, can_auto: false, catalog: [] };
  }
}

/**
 * Auto-create the CNAME + TXT records at the user's DNS provider. Credentials
 * are forwarded to the network for this single call only and never persisted.
 */
export async function autoConfigureDns(
  vendorId: string,
  input: { domain: string; provider: string; credentials: Record<string, string> },
): Promise<{ ok: boolean; error?: string }> {
  const { tc, client } = await ctx(vendorId);
  try {
    const res = await client.autoConfigureDns(vendorId, tc.ownerToken, input);
    refresh(vendorId);
    return { ok: !!res.ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not configure DNS automatically.";
    return { ok: false, error: msg };
  }
}

/**
 * Discover whether the custom domain's DNS provider supports the Domain Connect
 * synchronous flow ("Plaid for DNS"). Returns an `apply_url` to open in a popup when
 * supported; the user approves the records at their own provider — nothing stored.
 */
export async function discoverDomainConnect(
  vendorId: string,
  domain: string,
): Promise<{ supported: boolean; provider_name: string | null; apply_url: string | null }> {
  const { tc, client } = await ctx(vendorId);
  try {
    return await client.discoverDomainConnect(vendorId, tc.ownerToken, domain);
  } catch {
    return { supported: false, provider_name: null, apply_url: null };
  }
}

// See uploadLogo: return the new URL instead of redirecting so the uploader can
// clear its busy state and refresh in place.
export async function uploadWideLogo(
  vendorId: string,
  formData: FormData,
): Promise<{ url: string } | undefined> {
  const { tc, client } = await ctx(vendorId);
  const file = formData.get("wide_logo");
  if (!(file instanceof File) || file.size === 0) return undefined;
  const { wide_logo_url } = await client.uploadBrandingLogoWide(
    vendorId,
    tc.ownerToken,
    file,
    file.name,
  );
  refresh(vendorId);
  return { url: wide_logo_url };
}

async function requesterContact(
  client: ReturnType<typeof trustmcp>,
  vendorId: string,
  ownerToken: string,
  requestId: string,
): Promise<{ contact: string; name: string } | null> {
  const reqs = (await client.listKeyRequests(vendorId, ownerToken)) as {
    id: string;
    requester: { name: string; contact: string };
  }[];
  const r = reqs.find((x) => x.id === requestId);
  return r ? { contact: r.requester.contact, name: r.requester.name } : null;
}

export async function approveKey(vendorId: string, requestId: string, formData?: FormData) {
  const { tc, client } = await reviewCtx(vendorId);
  const who = await requesterContact(client, vendorId, tc.ownerToken, requestId);
  // Optional per-artifact restriction; empty = all artifacts in scope.
  const artifact_ids = formData ? formData.getAll("artifact_ids").map(String) : [];
  const grant = await client.approveKeyRequest(vendorId, tc.ownerToken, requestId, { artifact_ids });
  if (who?.contact && grant.key) {
    await sendMail({
      to: who.contact,
      subject: `Access granted to ${tc.legalName}'s trust center`,
      text:
        `Your request was approved. Use this scoped access key with the TrustMCP network or MCP server:\n\n` +
        `  vendor_id: ${vendorId}\n  key: ${grant.key}\n  scope: ${(grant.scope ?? []).join(", ")}\n` +
        `  expires: ${grant.expires_at ?? "n/a"}\n\n` +
        `Treat this key as a secret. It can be revoked at any time.`,
    });
  }
  refresh(vendorId);
}

export async function applyRecommendation(vendorId: string, requestId: string, level: string) {
  // The "approval agent" drafts a decision; this applies it in one click.
  if (level === "approve") return approveKey(vendorId, requestId);
  return denyKey(vendorId, requestId);
}

export async function denyKey(vendorId: string, requestId: string) {
  const { tc, client } = await reviewCtx(vendorId);
  const who = await requesterContact(client, vendorId, tc.ownerToken, requestId);
  await client.denyKeyRequest(vendorId, tc.ownerToken, requestId);
  if (who?.contact) {
    await sendMail({
      to: who.contact,
      subject: `Access request to ${tc.legalName} was not approved`,
      text: `Your request to access ${tc.legalName}'s trust center was not approved at this time.`,
    });
  }
  refresh(vendorId);
}

export async function revokeKey(vendorId: string, keyId: string) {
  const { tc, client } = await reviewCtx(vendorId);
  await client.revokeKey(vendorId, tc.ownerToken, keyId);
  refresh(vendorId);
}

export async function sendAgreementForSignature(vendorId: string, agreementId: string) {
  const { tc, client } = await ctx(vendorId);
  try {
    await client.sendAgreement(vendorId, tc.ownerToken, agreementId);
  } catch {
    // Surfaced via the page (status stays "submitted"); e-sign may be unconfigured.
  }
  refresh(vendorId);
}

// --- Trust-center sections (replace-all forms, mirroring subprocessors) ------

function plusOneYear(iso: string): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export async function saveBadges(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  // Parallel arrays, one entry per standard row, plus per-row file inputs named
  // evidence_file_{i} (so a row can carry several dropped evidence files).
  const names = formData.getAll("name").map(String);
  const standards = formData.getAll("standard").map(String);
  const logos = formData.getAll("logo_url").map(String);
  const evidenceIds = formData.getAll("evidence_artifact_id").map(String);
  const issuedOn = formData.getAll("issued_on").map(String);
  const validUntil = formData.getAll("valid_until").map(String);
  const accesses = formData.getAll("access").map(String);
  const today = new Date().toISOString().slice(0, 10);

  const badges: {
    name: string;
    standard?: string;
    logo_url?: string;
    evidence_artifact_id?: string;
    issued_on?: string;
    valid_until?: string;
  }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;
    const standard = standards[i]?.trim() || undefined;
    const rowIssued = issuedOn[i]?.trim() || undefined;
    const rowValid = validUntil[i]?.trim() || undefined;
    const rowAccess = accesses[i] === "public" ? "public" : "key_required";
    let evidence_artifact_id = evidenceIds[i]?.trim() || undefined;

    // Each dropped/selected file becomes a Compliance evidence artifact, inheriting
    // the row's dates and visibility (auto-filled defaults when left blank).
    const files = formData.getAll(`evidence_file_${i}`).filter((f): f is File => f instanceof File && f.size > 0);
    for (const file of files) {
      const created = await client.createArtifact(vendorId, tc.ownerToken, {
        type: standard || "compliance",
        title: name,
        issued_at: rowIssued || today,
        valid_until: rowValid || plusOneYear(rowIssued || today),
        category: "Compliance",
        access: rowAccess,
      });
      await client.uploadArtifactContent(vendorId, tc.ownerToken, created.id, file, file.name);
      if (!evidence_artifact_id) evidence_artifact_id = created.id;
    }
    badges.push({
      name,
      standard,
      logo_url: logos[i]?.trim() || undefined,
      evidence_artifact_id,
      issued_on: rowIssued,
      valid_until: rowValid,
    });
  }
  await client.replaceBadges(vendorId, tc.ownerToken, badges);
  redirect(`/tc/${vendorId}/compliance?saved=1`);
}

export async function saveControls(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const categories = formData.getAll("category").map(String);
  const names = formData.getAll("name").map(String);
  const statuses = formData.getAll("status").map(String);
  const controls = names
    .map((name, i) => ({
      category: (categories[i] ?? "").trim() || "General",
      name: name.trim(),
      status: statuses[i] === "not_operating" ? "not_operating" : "operating",
    }))
    .filter((c) => c.name);
  await client.replaceControls(vendorId, tc.ownerToken, controls);
  redirect(`/tc/${vendorId}/controls?saved=1`);
}

/**
 * Append controls chosen from the controls library to the existing list,
 * de-duplicating by category + name (case-insensitive) and preserving any
 * descriptions already on the trust center.
 */
export async function addLibraryControls(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const categories = formData.getAll("category").map(String);
  const names = formData.getAll("name").map(String);
  const descriptions = formData.getAll("description").map(String);
  const picked = names
    .map((name, i) => ({
      category: (categories[i] ?? "").trim() || "General",
      name: name.trim(),
      description: (descriptions[i] ?? "").trim() || null,
      status: "operating" as const,
    }))
    .filter((c) => c.name);

  if (picked.length === 0) {
    redirect(`/tc/${vendorId}/controls`);
  }

  const { controls: existing } = await client.getOwnerControls(vendorId, tc.ownerToken);
  const seen = new Set(existing.map((c) => `${c.category}|||${c.name}`.toLowerCase()));
  const merged = existing.map((c) => ({
    category: c.category,
    name: c.name,
    description: c.description ?? null,
    status: c.status,
  }));
  let added = 0;
  for (const c of picked) {
    const key = `${c.category}|||${c.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
    added += 1;
  }
  await client.replaceControls(vendorId, tc.ownerToken, merged);
  redirect(`/tc/${vendorId}/controls?added=${added}`);
}

function normControlStatus(s?: string): "operating" | "not_operating" {
  return String(s ?? "").toLowerCase().includes("not") ? "not_operating" : "operating";
}

// Parse an uploaded/pasted control standard into {category, name, status}. Accepts
// JSON (array, or {controls:[…]}), CSV/TSV (Category, Control, Status[, …]), and
// loose lines ("Category: Control" or just "Control").
function parseControlText(text: string): { category: string; name: string; status: string }[] {
  const out: { category: string; name: string; status: string }[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const arr: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : Array.isArray((data as { controls?: unknown }).controls)
          ? ((data as { controls: Record<string, unknown>[] }).controls)
          : [];
      for (const r of arr) {
        const name = String(r.name ?? r.control ?? r.title ?? "").trim();
        if (!name) continue;
        const category = String(r.category ?? r.domain ?? r.family ?? "General").trim() || "General";
        out.push({ category, name, status: normControlStatus(String(r.status ?? "")) });
      }
      if (out.length) return out;
    } catch {
      // fall through to line parsing
    }
  }
  const lines = trimmed.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const raw = rawLine.trim();
    if (!raw) return;
    if (raw.includes(",") || raw.includes("\t")) {
      // Skip an obvious header row.
      if (idx === 0 && /\b(category|control|name|status|domain)\b/i.test(raw) && !/operating/i.test(raw)) {
        return;
      }
      const cells = raw.split(/[,\t]/).map((s) => s.trim().replace(/^"|"$/g, ""));
      const [category, name, status] = [cells[0], cells[1], cells[2]];
      if (name) out.push({ category: category || "General", name, status: normControlStatus(status) });
      else if (category) out.push({ category: "General", name: category, status: "operating" });
    } else if (raw.includes(":")) {
      const [cat, ...rest] = raw.split(":");
      const name = rest.join(":").trim();
      if (name) out.push({ category: cat.trim() || "General", name, status: "operating" });
    } else {
      out.push({ category: "General", name: raw, status: "operating" });
    }
  });
  return out;
}

// Upload/paste an internal control standard; parse it and append to the controls.
export async function parseControls(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  let text = String(formData.get("bulk") ?? "").trim();
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) text = (await file.text()).trim();
  if (!text) redirect(`/tc/${vendorId}/controls?error=empty`);
  const parsed = parseControlText(text);
  if (parsed.length === 0) redirect(`/tc/${vendorId}/controls?error=parse`);
  const { controls: existing } = await client.getOwnerControls(vendorId, tc.ownerToken);
  const merged = [
    ...existing.map((c) => ({ category: c.category, name: c.name, status: c.status })),
    ...parsed,
  ];
  await client.replaceControls(vendorId, tc.ownerToken, merged);
  redirect(`/tc/${vendorId}/controls?added=${parsed.length}`);
}

export async function saveDataTypes(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const labels = formData.getAll("label").map(String);
  const collected = new Set(formData.getAll("collected").map(String));
  const data_types = labels
    .map((label, i) => ({ label: label.trim(), collected: collected.has(String(i)) }))
    .filter((d) => d.label);
  await client.replaceDataTypes(vendorId, tc.ownerToken, data_types);
  redirect(`/tc/${vendorId}/data?saved=1`);
}

export async function saveFaqs(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const questions = formData.getAll("question").map(String);
  const answers = formData.getAll("answer").map(String);
  const faqs = questions
    .map((question, i) => ({ question: question.trim(), answer: (answers[i] ?? "").trim() }))
    .filter((f) => f.question && f.answer);
  await client.replaceFaqs(vendorId, tc.ownerToken, faqs);
  redirect(`/tc/${vendorId}/faq?saved=1`);
}

export async function saveUpdates(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const titles = formData.getAll("title").map(String);
  const bodies = formData.getAll("body").map(String);
  const categories = formData.getAll("category").map(String);
  const dates = formData.getAll("published_at").map(String);
  const updates = titles
    .map((title, i) => ({
      title: title.trim(),
      body: (bodies[i] ?? "").trim() || undefined,
      category: (categories[i] ?? "").trim() || undefined,
      published_at: (dates[i] ?? "").trim() || undefined,
    }))
    .filter((u) => u.title);
  await client.replaceUpdates(vendorId, tc.ownerToken, updates);
  redirect(`/tc/${vendorId}/updates?saved=1`);
}

// --- Google Drive sync -------------------------------------------------------

/** Link a Drive folder. Credentials are write-only: a blank field on a re-save
 * keeps whatever is already stored rather than clearing it. */
export async function connectDrive(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const s = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || undefined;
  };
  const authType = s("auth_type") === "oauth" ? "oauth" : "service_account";
  await client.connectDrive(vendorId, tc.ownerToken, {
    folder_id: extractFolderId(String(formData.get("folder_id") ?? "")),
    auth_type: authType,
    client_id: s("client_id"),
    client_secret: s("client_secret"),
    refresh_token: s("refresh_token"),
    service_account_json: s("service_account_json"),
    recursive: formData.get("recursive") === "on",
    sync_mode: formData.get("sync_mode") === "on_change" ? "on_change" : "manual",
    auto_publish: formData.get("auto_publish") === "on",
    default_category: s("default_category") ?? null,
    default_type: s("default_type") ?? "policy",
    default_access: s("default_access") === "public" ? "public" : "key_required",
  });
  refresh(vendorId);
}

/** Accept either a bare folder id or a pasted Drive URL — people copy the URL. */
function extractFolderId(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  try {
    const url = new URL(trimmed);
    const id = url.searchParams.get("id");
    if (id) return id;
  } catch {
    // Not a URL; treat it as an id.
  }
  return trimmed;
}

export async function updateDriveConnection(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  await client.updateDriveConnection(vendorId, tc.ownerToken, {
    recursive: formData.get("recursive") === "on",
    sync_mode: formData.get("sync_mode") === "on_change" ? "on_change" : "manual",
    auto_publish: formData.get("auto_publish") === "on",
    default_category: String(formData.get("default_category") ?? "").trim() || null,
    default_type: String(formData.get("default_type") ?? "policy").trim(),
    default_access:
      formData.get("default_access") === "public" ? "public" : "key_required",
  });
  refresh(vendorId);
}

/** Save the classification rules. Rules arrive as parallel arrays so the form
 * can add and remove rows without JavaScript. */
export async function saveDriveRules(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const matches = formData.getAll("rule_match").map(String);
  const rules = matches
    .map((match, i) => ({
      match: match.trim(),
      label: String(formData.getAll("rule_label")[i] ?? "").trim() || undefined,
      action: (String(formData.getAll("rule_action")[i] ?? "include") ||
        "include") as "include" | "review" | "exclude",
      type: String(formData.getAll("rule_type")[i] ?? "").trim() || undefined,
      category: String(formData.getAll("rule_category")[i] ?? "").trim() || undefined,
      access: (String(formData.getAll("rule_access")[i] ?? "").trim() || undefined) as
        | "public"
        | "key_required"
        | undefined,
    }))
    .filter((r) => r.match);
  await client.updateDriveConnection(vendorId, tc.ownerToken, { rules });
  refresh(vendorId);
}

export async function syncDrive(vendorId: string) {
  const { tc, client } = await ctx(vendorId);
  await client.syncDrive(vendorId, tc.ownerToken);
  refresh(vendorId);
}

export async function disconnectDrive(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  await client.disconnectDrive(vendorId, tc.ownerToken, formData.get("purge") === "on");
  redirect(`/tc/${vendorId}/drive`);
}

/** Include a discovered file (publishing it) or exclude it, with the
 * classification and presentation the reviewer chose. */
export async function decideDriveFile(
  vendorId: string,
  fileId: number,
  formData: FormData,
) {
  const { tc, client } = await ctx(vendorId);
  const decision = formData.get("decision") === "included" ? "included" : "excluded";
  const s = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || undefined;
  };
  await client.decideDriveFile(vendorId, tc.ownerToken, fileId, {
    decision,
    reason: s("reason"),
    type: s("type"),
    title: s("title"),
    category: s("category") ?? null,
    access: s("access") === "public" ? "public" : "key_required",
    description: s("description"),
    position: formData.get("position") ? Number(formData.get("position")) : undefined,
    featured: formData.get("featured") === "on",
    hidden: formData.get("hidden") === "on",
    valid_until: s("valid_until"),
  });
  refresh(vendorId);
}

export async function excludeDriveFiles(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const ids = formData.getAll("file_ids").map((v) => Number(v));
  if (ids.length) {
    await client.excludeDriveFiles(vendorId, tc.ownerToken, ids, "excluded in bulk");
  }
  refresh(vendorId);
}

// --- Public resource presentation -------------------------------------------

export async function saveResourceDisplay(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const order = String(formData.get("category_order") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  await client.updateResourceDisplay(vendorId, tc.ownerToken, {
    layout: (String(formData.get("layout") ?? "list") || "list") as
      | "list"
      | "grid"
      | "table",
    group_by: (String(formData.get("group_by") ?? "category") || "category") as
      | "category"
      | "type"
      | "product"
      | "none",
    category_order: order,
    show_descriptions: formData.get("show_descriptions") === "on",
    show_dates: formData.get("show_dates") === "on",
    show_hashes: formData.get("show_hashes") === "on",
    feature_band: formData.get("feature_band") === "on",
    empty_message: String(formData.get("empty_message") ?? "").trim() || null,
  });
  refresh(vendorId);
}

/** Save the whole resource list's ordering and labels in one request, so the
 * page never renders half-reordered. */
export async function saveResourcePresentation(vendorId: string, formData: FormData) {
  const { tc, client } = await ctx(vendorId);
  const ids = formData.getAll("presentation_id").map(String);
  const items = ids.map((id, i) => ({
    id,
    title: String(formData.getAll("presentation_title")[i] ?? "").trim() || undefined,
    description: String(formData.getAll("presentation_description")[i] ?? "").trim(),
    category: String(formData.getAll("presentation_category")[i] ?? "").trim(),
    position: Number(formData.getAll("presentation_position")[i] ?? 0) || 0,
    featured: formData.getAll("presentation_featured").map(String).includes(id),
    hidden: formData.getAll("presentation_hidden").map(String).includes(id),
  }));
  if (items.length) {
    await client.updateArtifactPresentation(vendorId, tc.ownerToken, items);
  }
  refresh(vendorId);
}

/** Choose which Drive folder to sync, completing a click-through connection. */
export async function chooseDriveFolder(vendorId: string, folderId: string) {
  const { tc, client } = await ctx(vendorId);
  await client.setDriveFolder(vendorId, tc.ownerToken, folderId);
  refresh(vendorId);
  redirect(`/tc/${vendorId}/drive`);
}
