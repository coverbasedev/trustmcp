// Persistence + authorization helpers for the audit subsystem. All access is
// scoped to the caller's organizations, mirroring lib/trustcenter.ts. Secrets
// (LLM keys, target auth) are decrypted only here, server-side, and never returned
// to a client component.

import { db } from "@/lib/db";
import { decryptSecret } from "./crypto";
import type { LlmConfig, LlmProvider } from "./llm";
import { providerForModel } from "./llm";
import type { DimensionId } from "./taxonomy";
import type { StaticControl } from "./controls";

/** Org ids the user belongs to. */
export async function userOrgIds(userId: string): Promise<string[]> {
  const memberships = await db.membership.findMany({ where: { userId }, select: { orgId: true } });
  return memberships.map((m) => m.orgId);
}

/** The user's primary org (first membership), for creating org-scoped records. */
export async function primaryOrgId(userId: string): Promise<string | null> {
  const m = await db.membership.findFirst({ where: { userId }, select: { orgId: true } });
  return m?.orgId ?? null;
}

/** Load a scan the user is allowed to see, or null. */
export async function getScanForUser(userId: string, scanId: string) {
  const orgIds = await userOrgIds(userId);
  const scan = await db.mcpAuditScan.findUnique({ where: { id: scanId } });
  if (!scan || !orgIds.includes(scan.orgId)) return null;
  return scan;
}

/** List an org's scans, newest first. */
export async function listScansForUser(userId: string) {
  const orgIds = await userOrgIds(userId);
  return db.mcpAuditScan.findMany({
    where: { orgId: { in: orgIds } },
    orderBy: { createdAt: "desc" },
  });
}

/** Resolve the LLM config for a scan: its stored credential, decrypted. */
export async function llmConfigForScan(scan: {
  orgId: string;
  provider: string;
  model: string;
}): Promise<LlmConfig | null> {
  const cred = await db.llmCredential.findFirst({
    where: { orgId: scan.orgId, provider: scan.provider },
    orderBy: { createdAt: "desc" },
  });
  if (!cred) return null;
  return {
    provider: scan.provider as LlmProvider,
    apiKey: decryptSecret(cred.apiKeyEnc),
    model: scan.model || cred.model,
    baseUrl: cred.baseUrl ?? undefined,
  };
}

/** Decrypt a scan's target auth (secrets), returning the shape mcp-inspect wants. */
export function decodeTargetAuth(authSecretEnc: string | null): {
  kind: "none" | "bearer" | "oauth_client_credentials" | "header";
  bearer?: string;
  header?: { name: string; value: string };
  oauth?: { tokenUrl: string; clientId: string; clientSecret: string };
} {
  if (!authSecretEnc) return { kind: "none" };
  try {
    return JSON.parse(decryptSecret(authSecretEnc));
  } catch {
    return { kind: "none" };
  }
}

/** Merge the static controls with an org's enabled custom clauses. */
export async function controlsForOrg(orgId: string): Promise<{
  clauses: { id: string; dimension: DimensionId; title: string; intent: string; weight: number }[];
}> {
  const rows = await db.auditClause.findMany({ where: { orgId, enabled: true } });
  return {
    clauses: rows.map((c) => ({
      id: c.id,
      dimension: c.dimension as DimensionId,
      title: c.title,
      intent: c.intent,
      weight: c.weight ?? 0.6,
    })),
  };
}

/** Whether an org has at least one usable credential (for UI gating). */
export async function hasCredential(orgId: string, provider?: string): Promise<boolean> {
  const count = await db.llmCredential.count({
    where: { orgId, ...(provider ? { provider } : {}) },
  });
  return count > 0;
}

/** Providers an org has credentials for, with the default model of each. */
export async function availableProviders(
  orgId: string,
): Promise<{ provider: LlmProvider; model: string; label: string | null }[]> {
  const rows = await db.llmCredential.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    provider: r.provider as LlmProvider,
    model: r.model,
    label: r.label,
  }));
}

export { providerForModel };
export type { StaticControl };
