"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getTrustCenterForUser, requireUser } from "@/lib/trustcenter";
import { encryptSecret } from "@/lib/mcp-audit/crypto";
import { interrogateScan, runScan } from "@/lib/mcp-audit/engine";
import { MODEL_CATALOG, providerForModel, verifyCredential, type LlmProvider } from "@/lib/mcp-audit/llm";
import { RISK_DIMENSIONS } from "@/lib/mcp-audit/taxonomy";
import { getScanForUser, primaryOrgId, userOrgIds } from "@/lib/mcp-audit/store";

function validUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// --- Model credentials --------------------------------------------------------

export type CredentialFormState = { error?: string; ok?: string };

export async function saveCredential(
  _prev: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  const user = await requireUser();
  const orgId = await primaryOrgId(user.id);
  if (!orgId) return { error: "No workspace found." };

  const provider = String(formData.get("provider") ?? "") as LlmProvider;
  if (provider !== "anthropic" && provider !== "openai") return { error: "Pick a provider." };
  const apiKey = String(formData.get("api_key") ?? "").trim();
  if (!apiKey) return { error: "Paste an API key." };
  const model =
    String(formData.get("model") ?? "").trim() || MODEL_CATALOG[provider][0].id;
  const baseUrl = String(formData.get("base_url") ?? "").trim() || null;
  const label = String(formData.get("label") ?? "").trim() || null;

  // Verify connectivity before storing, so a bad key is caught here, not mid-scan.
  const check = await verifyCredential({ provider, apiKey, model, baseUrl: baseUrl ?? undefined });

  let apiKeyEnc: string;
  try {
    apiKeyEnc = encryptSecret(apiKey);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Encryption not configured." };
  }

  await db.llmCredential.create({
    data: {
      orgId,
      provider,
      label,
      model,
      apiKeyEnc,
      baseUrl,
      createdById: user.id,
      status: check.ok ? "ok" : "error",
      lastVerifiedAt: new Date(),
    },
  });
  revalidatePath("/audit/settings");
  return check.ok
    ? { ok: "Credential saved and verified." }
    : { error: `Saved, but verification failed: ${check.error}` };
}

export async function deleteCredential(id: string): Promise<void> {
  const user = await requireUser();
  const orgIds = await userOrgIds(user.id);
  await db.llmCredential.deleteMany({ where: { id, orgId: { in: orgIds } } });
  revalidatePath("/audit/settings");
}

// --- Custom clauses -----------------------------------------------------------

export type ClauseFormState = { error?: string; ok?: string };

export async function saveClause(
  _prev: ClauseFormState,
  formData: FormData,
): Promise<ClauseFormState> {
  const user = await requireUser();
  const orgId = await primaryOrgId(user.id);
  if (!orgId) return { error: "No workspace found." };

  const dimension = String(formData.get("dimension") ?? "");
  if (!RISK_DIMENSIONS.some((d) => d.id === dimension)) return { error: "Pick a risk dimension." };
  const title = String(formData.get("title") ?? "").trim();
  const intent = String(formData.get("intent") ?? "").trim();
  if (!title || !intent) return { error: "A title and intent are required." };

  await db.auditClause.create({
    data: { orgId, dimension, title, intent, createdById: user.id },
  });
  revalidatePath("/audit/settings");
  return { ok: "Clause added. It will be evaluated on every new scan." };
}

export async function toggleClause(id: string, enabled: boolean): Promise<void> {
  const user = await requireUser();
  const orgIds = await userOrgIds(user.id);
  await db.auditClause.updateMany({ where: { id, orgId: { in: orgIds } }, data: { enabled } });
  revalidatePath("/audit/settings");
}

export async function deleteClause(id: string): Promise<void> {
  const user = await requireUser();
  const orgIds = await userOrgIds(user.id);
  await db.auditClause.deleteMany({ where: { id, orgId: { in: orgIds } } });
  revalidatePath("/audit/settings");
}

// --- Scans --------------------------------------------------------------------

export type ScanFormState = { error?: string };

export async function startScan(
  _prev: ScanFormState,
  formData: FormData,
): Promise<ScanFormState> {
  const user = await requireUser();
  const orgId = await primaryOrgId(user.id);
  if (!orgId) return { error: "No workspace found." };

  const name = String(formData.get("name") ?? "").trim();
  const targetUrl = String(formData.get("target_url") ?? "").trim();
  const transport = String(formData.get("transport") ?? "http");
  const intendedUse = String(formData.get("intended_use") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const integrationPoints = String(formData.get("integration_points") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!name) return { error: "Give the scan a name." };
  if (!validUrl(targetUrl)) return { error: "Enter the MCP server URL, including https://." };
  if (!model) return { error: "Pick a model to run the scan with." };

  const provider = providerForModel(model);
  const cred = await db.llmCredential.findFirst({ where: { orgId, provider } });
  if (!cred) {
    return { error: `Add a ${provider} credential under Model credentials before scanning with this model.` };
  }

  // Build the target auth blob (encrypted) from the form.
  const authKind = String(formData.get("auth_kind") ?? "none");
  let authSecretEnc: string | null = null;
  let authDetail: string | null = null;
  try {
    if (authKind === "bearer") {
      const bearer = String(formData.get("auth_bearer") ?? "").trim();
      if (bearer) {
        authSecretEnc = encryptSecret(JSON.stringify({ kind: "bearer", bearer }));
        authDetail = "Authorization: Bearer ***";
      }
    } else if (authKind === "header") {
      const hn = String(formData.get("auth_header_name") ?? "").trim();
      const hv = String(formData.get("auth_header_value") ?? "").trim();
      if (hn && hv) {
        authSecretEnc = encryptSecret(JSON.stringify({ kind: "header", header: { name: hn, value: hv } }));
        authDetail = `${hn}: ***`;
      }
    } else if (authKind === "oauth_client_credentials") {
      const tokenUrl = String(formData.get("auth_token_url") ?? "").trim();
      const clientId = String(formData.get("auth_client_id") ?? "").trim();
      const clientSecret = String(formData.get("auth_client_secret") ?? "").trim();
      if (tokenUrl && clientId && clientSecret) {
        authSecretEnc = encryptSecret(
          JSON.stringify({ kind: "oauth_client_credentials", oauth: { tokenUrl, clientId, clientSecret } }),
        );
        authDetail = `OAuth client-credentials @ ${new URL(tokenUrl).host}`;
      }
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not store auth." };
  }

  const scan = await db.mcpAuditScan.create({
    data: {
      orgId,
      createdById: user.id,
      name,
      targetUrl,
      transport,
      authKind: authSecretEnc ? authKind : "none",
      authDetail,
      authSecretEnc,
      intendedUse: intendedUse || null,
      integrationPoints,
      provider,
      model,
      status: "pending",
      statusDetail: "Queued.",
    },
  });

  // Detached — the engine persists its own progress and terminal state.
  void runScan(scan.id).catch(() => {
    /* runScan records failures itself */
  });

  redirect(`/audit/${scan.id}`);
}

export async function rescan(scanId: string): Promise<void> {
  const user = await requireUser();
  const scan = await getScanForUser(user.id, scanId);
  if (!scan) throw new Error("NOT_FOUND");
  // Reset progress + prior results; the engine overwrites the result blobs as it
  // re-runs, so we clear the summary fields and log and let the run repopulate.
  await db.mcpAuditScan.update({
    where: { id: scanId },
    data: {
      status: "pending",
      statusDetail: "Re-queued.",
      log: [],
      overallScore: null,
      grade: null,
      published: false,
      publishedAt: null,
    },
  });
  void runScan(scanId).catch(() => {});
  revalidatePath(`/audit/${scanId}`);
}

export async function deleteScan(scanId: string): Promise<void> {
  const user = await requireUser();
  const orgIds = await userOrgIds(user.id);
  await db.mcpAuditScan.deleteMany({ where: { id: scanId, orgId: { in: orgIds } } });
  redirect("/audit/scans");
}

export async function updateScanDescription(scanId: string, description: string): Promise<void> {
  const user = await requireUser();
  const scan = await getScanForUser(user.id, scanId);
  if (!scan) throw new Error("NOT_FOUND");
  await db.mcpAuditScan.update({ where: { id: scanId }, data: { description: description.trim() || null } });
  revalidatePath(`/audit/${scanId}`);
}

export type InterrogateState = { answer?: string; error?: string; probes?: { hypothesis: string; prompt: string; safety: string }[] };

export async function interrogate(
  scanId: string,
  _prev: InterrogateState,
  formData: FormData,
): Promise<InterrogateState> {
  const user = await requireUser();
  const scan = await getScanForUser(user.id, scanId);
  if (!scan) return { error: "Not found." };
  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { error: "Ask a question." };
  try {
    const turn = await interrogateScan(scanId, question);
    revalidatePath(`/audit/${scanId}`);
    return {
      answer: turn.answer,
      probes: turn.newProbes?.map((p) => ({ hypothesis: p.hypothesis, prompt: p.prompt, safety: p.safety })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Interrogation failed." };
  }
}

// --- Publishing a scan to a trust center --------------------------------------

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "scan";
}

export async function publishScan(scanId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const scan = await getScanForUser(user.id, scanId);
  if (!scan) throw new Error("NOT_FOUND");
  if (scan.status !== "completed") throw new Error("Scan is not complete.");

  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const tc = await getTrustCenterForUser(user.id, vendorId);
  if (!tc) throw new Error("You don't manage that trust center.");

  const version = String(formData.get("version") ?? "").trim() || `v${Date.now().toString(36)}`;
  const slug =
    scan.publishSlug ?? `${slugify(scan.name)}-${scan.id.slice(-6)}`;

  await db.mcpAuditScan.update({
    where: { id: scanId },
    data: {
      published: true,
      publishedVendorId: vendorId,
      publishSlug: slug,
      publishedVersion: version,
      publishedAt: new Date(),
    },
  });
  revalidatePath(`/audit/${scanId}`);
  revalidatePath(`/tc/${vendorId}/mcp-audits`);
}

export async function unpublishScan(scanId: string): Promise<void> {
  const user = await requireUser();
  const scan = await getScanForUser(user.id, scanId);
  if (!scan) throw new Error("NOT_FOUND");
  await db.mcpAuditScan.update({
    where: { id: scanId },
    data: { published: false, publishedAt: null },
  });
  revalidatePath(`/audit/${scanId}`);
  if (scan.publishedVendorId) revalidatePath(`/tc/${scan.publishedVendorId}/mcp-audits`);
}
