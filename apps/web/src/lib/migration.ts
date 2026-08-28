// Trust Center AI Migration orchestration.
//
// Two phases, separated by a human-in-the-loop pause:
//
//   1. requestPhase  - open the source trust center, request access to all
//                      documentation, and sign an NDA if one is required. Then
//                      stop and wait ("awaiting_release") for the source owner to
//                      release the documents to our requester.
//   2. importPhase   - kicked off when the user presses Resume. Reconnect to the
//                      browser, pull every document + all profile content from the
//                      source, AI-label the documents, and copy everything into
//                      the target trust center via the TrustMCP SDK.
//
// Both phases run detached from the request that triggers them (the web service
// is a long-lived Node process), and persist their progress to the
// TrustCenterMigration row so the dashboard can poll it.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { trustmcp } from "@/lib/trustmcp";
import {
  type MigrationEnv,
  type SessionHandle,
  closeSession,
  migrationEnv,
  resumeSession,
  startSession,
} from "@/lib/browserbase";
import { labelDocument } from "@/lib/ai-labeler";

const MIGRATION_NOTE = "Trust Center AI Migration";

interface LogEntry {
  at: string;
  step: string;
  detail: string;
}

// --- profile + document extraction schemas (Stagehand uses zod) ---

const ProfileSchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  companyUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  products: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(),
  badges: z
    .array(
      z.object({
        name: z.string(),
        standard: z.string().optional(),
        issuedOn: z.string().optional(),
        validUntil: z.string().optional(),
      }),
    )
    .optional(),
  controls: z
    .array(
      z.object({
        category: z.string(),
        name: z.string(),
        description: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .optional(),
  subprocessors: z
    .array(
      z.object({
        name: z.string(),
        purpose: z.string().optional(),
        location: z.string().optional(),
        domain: z.string().optional(),
        category: z.string().optional(),
      }),
    )
    .optional(),
  dataTypes: z
    .array(z.object({ label: z.string(), collected: z.boolean() }))
    .optional(),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  updates: z
    .array(
      z.object({
        title: z.string(),
        body: z.string().optional(),
        category: z.string().optional(),
        publishedAt: z.string().optional(),
      }),
    )
    .optional(),
});

const DocumentsSchema = z.object({
  documents: z.array(
    z.object({
      title: z.string(),
      type: z.string().optional(),
      downloadUrl: z.string().optional(),
      issuedAt: z.string().optional(),
      validUntil: z.string().optional(),
    }),
  ),
});

// --- small persistence helpers ---

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function readLog(id: string): Promise<LogEntry[]> {
  const row = await db.trustCenterMigration.findUnique({ where: { id }, select: { log: true } });
  return Array.isArray(row?.log) ? (row!.log as unknown as LogEntry[]) : [];
}

async function persist(id: string, data: Prisma.TrustCenterMigrationUpdateInput) {
  await db.trustCenterMigration.update({ where: { id }, data });
}

/** Append a log line and persist it (keeps the dashboard timeline live). */
async function log(id: string, current: LogEntry[], step: string, detail: string) {
  current.push({ at: new Date().toISOString(), step, detail });
  await persist(id, { log: current as unknown as Prisma.InputJsonValue });
}

async function setStatus(
  id: string,
  current: LogEntry[],
  status: string,
  statusDetail: string,
) {
  current.push({ at: new Date().toISOString(), step: status, detail: statusDetail });
  await persist(id, { status, statusDetail, log: current as unknown as Prisma.InputJsonValue });
}

async function fail(id: string, current: LogEntry[], detail: string) {
  await setStatus(id, current, "failed", detail);
}

// --- download helpers ---

function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
  } catch {
    /* ignore */
  }
  return fallback;
}

function formatFromContentType(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(url)) return "pdf";
  if (ct.includes("word") || /\.docx?(\?|$)/i.test(url)) return "docx";
  if (ct.includes("sheet") || /\.xlsx?(\?|$)/i.test(url)) return "xlsx";
  if (ct.includes("json") || /\.json(\?|$)/i.test(url)) return "json";
  return "pdf";
}

async function downloadFile(
  url: string,
  cookieHeader: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      redirect: "follow",
    });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    return { bytes, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

// =====================================================================
// Phase 1 — request access + sign NDA, then pause for document release.
// =====================================================================

export async function runRequestPhase(migrationId: string): Promise<void> {
  const m = await db.trustCenterMigration.findUnique({ where: { id: migrationId } });
  if (!m) return;
  const env = migrationEnv();
  const current = Array.isArray(m.log) ? (m.log as unknown as LogEntry[]) : [];

  if (!env) {
    await fail(
      migrationId,
      current,
      "Migration isn't configured. Set BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID and TRUSTMCP_ANTHROPIC_API_KEY.",
    );
    return;
  }

  let handle: SessionHandle | undefined;
  try {
    await setStatus(
      migrationId,
      current,
      "requesting",
      "Starting a Browserbase session and opening the source trust center…",
    );

    handle = await startSession(env);
    await persist(migrationId, {
      browserbaseSessionId: handle.sessionId,
      sessionReplayUrl: handle.replayUrl,
    });
    const { sh } = handle;

    await sh.context.newPage(m.sourceUrl);
    await log(migrationId, current, "open", `Opened ${m.sourceUrl}`);

    const requester = [m.requesterName, m.requesterEmail, m.requesterCompany]
      .filter(Boolean)
      .join(", ") || "the requesting company";

    // Drive the (vendor-specific, unknown) access flow with an autonomous agent.
    const agent = sh.agent({ model: { modelName: env.model, apiKey: env.anthropicApiKey } });
    const result = await agent.execute(
      `You are importing an existing trust center into another one. On this trust center page, ` +
        `request access to ALL available documents and security resources, identifying as ${requester}. ` +
        (m.requesterName ? `Requester name: ${m.requesterName}. ` : "") +
        (m.requesterEmail ? `Requester email: ${m.requesterEmail}. ` : "") +
        (m.requesterCompany ? `Requester company: ${m.requesterCompany}. ` : "") +
        (m.accessNotes ? `Additional access details: ${m.accessNotes}. ` : "") +
        `Fill in and submit any required access-request form. If you are presented with a ` +
        `Non-Disclosure Agreement (NDA), read it and accept/sign it on behalf of the requester so ` +
        `the request can proceed. Do NOT download any files yet. Stop once the access request has ` +
        `been submitted (and the NDA, if any, is signed).`,
    );

    await log(
      migrationId,
      current,
      "request",
      result?.message ?? "Submitted the access request to the source trust center.",
    );

    const ndaSigned = /\b(nda|non-disclosure|agreement)\b/i.test(JSON.stringify(result ?? {}));
    await persist(migrationId, { ndaSigned });

    await setStatus(
      migrationId,
      current,
      "awaiting_release",
      `Access requested${ndaSigned ? " and NDA signed" : ""}. Ask the source trust center to release ` +
        `all documents to ${m.requesterEmail || "the requester"}, then press Resume to import everything.`,
    );
    // Intentionally keep the session alive (keepAlive) so Resume can reconnect.
  } catch (e) {
    await fail(migrationId, current, `Request phase failed: ${errMsg(e)}`);
    if (handle) await closeSession(handle.sh);
  }
}

// =====================================================================
// Phase 2 — pull everything from the source and copy it into the target.
// =====================================================================

export async function runImportPhase(migrationId: string): Promise<void> {
  const m = await db.trustCenterMigration.findUnique({ where: { id: migrationId } });
  if (!m) return;
  const env = migrationEnv();
  const current = Array.isArray(m.log) ? (m.log as unknown as LogEntry[]) : [];

  if (!env) {
    await fail(migrationId, current, "Migration isn't configured (missing Browserbase / Anthropic env).");
    return;
  }

  const tc = await db.trustCenter.findUnique({ where: { vendorId: m.vendorId } });
  if (!tc) {
    await fail(migrationId, current, "Target trust center not found.");
    return;
  }

  let handle: SessionHandle | undefined;
  try {
    await setStatus(
      migrationId,
      current,
      "importing",
      "Reconnecting to the browser and reading the source trust center…",
    );

    // Reconnect to the live session; fall back to a fresh one if it expired.
    if (m.browserbaseSessionId) {
      try {
        handle = await resumeSession(env, m.browserbaseSessionId);
      } catch {
        await log(migrationId, current, "reconnect", "Prior session expired; starting a fresh one.");
      }
    }
    if (!handle) {
      handle = await startSession(env);
      await persist(migrationId, {
        browserbaseSessionId: handle.sessionId,
        sessionReplayUrl: handle.replayUrl,
      });
    }
    const { sh } = handle;

    // Ensure we are on the source trust center (now with documents released).
    const active = sh.context.activePage();
    if (active) {
      await active.goto(m.sourceUrl);
    } else {
      await sh.context.newPage(m.sourceUrl);
    }
    await log(migrationId, current, "open", `Re-opened ${m.sourceUrl} to import content.`);

    // --- pull profile content + document list ---
    const profile = await sh.extract(
      "Extract this trust center's details: company display name, description/tagline, company website URL, " +
        "primary brand color (hex if visible), product lines/products, the company's domains, compliance " +
        "certifications/badges (with standard and dates if shown), security controls grouped by category, " +
        "subprocessors, data types collected (and whether each is collected), FAQs (question/answer), and " +
        "recent updates.",
      ProfileSchema,
    );
    await log(migrationId, current, "extract", "Extracted profile content from the source.");

    const docList = await sh.extract(
      "List every document or downloadable resource on this trust center. For each, give its title, the document " +
        "type/category, a direct download URL (the href the download button points to) if available, and the issued " +
        "and expiry dates if shown.",
      DocumentsSchema,
    );
    await log(
      migrationId,
      current,
      "extract",
      `Found ${docList.documents.length} document(s) on the source.`,
    );

    // --- copy profile content into the target via the SDK ---
    const client = trustmcp();
    const vendorId = m.vendorId;
    const owner = tc.ownerToken;

    const branding: Record<string, string> = {};
    if (profile.displayName) branding.display_name = profile.displayName;
    if (profile.description) branding.description = profile.description;
    if (profile.companyUrl) branding.company_url = profile.companyUrl;
    if (profile.primaryColor) branding.primary_color = profile.primaryColor;

    const profileUpdate: Parameters<typeof client.updateProfile>[2] = {};
    if (Object.keys(branding).length) profileUpdate.branding = branding;
    // Product lines (deduped, non-empty).
    const products = [...new Set((profile.products ?? []).map((p) => p.trim()).filter(Boolean))];
    if (products.length) profileUpdate.products = products.map((name) => ({ name }));
    // Domains (deduped, lowercased; they import unverified and can be verified later).
    const domains = [
      ...new Set((profile.domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)),
    ];
    if (domains.length) profileUpdate.domains = domains;

    if (Object.keys(profileUpdate).length) {
      await client.updateProfile(vendorId, owner, profileUpdate);
      const parts = [
        Object.keys(branding).length ? "branding" : null,
        products.length ? `${products.length} product line(s)` : null,
        domains.length ? `${domains.length} domain(s)` : null,
      ].filter(Boolean);
      await log(migrationId, current, "copy", `Copied company details (${parts.join(", ")}).`);
    }

    if (profile.badges?.length) {
      await client.replaceBadges(
        vendorId,
        owner,
        profile.badges.map((b) => ({
          name: b.name,
          standard: b.standard ?? null,
          issued_on: b.issuedOn ?? null,
          valid_until: b.validUntil ?? null,
        })),
      );
      await log(migrationId, current, "copy", `Copied ${profile.badges.length} compliance badge(s).`);
    }

    if (profile.controls?.length) {
      await client.replaceControls(
        vendorId,
        owner,
        profile.controls.map((c) => ({
          category: c.category,
          name: c.name,
          description: c.description ?? null,
          status: c.status ?? "operating",
        })),
      );
      await log(migrationId, current, "copy", `Copied ${profile.controls.length} control(s).`);
    }

    if (profile.subprocessors?.length) {
      await client.replaceSubprocessors(
        vendorId,
        owner,
        profile.subprocessors.map((s) => ({
          name: s.name,
          purpose: s.purpose,
          location: s.location,
          domain: s.domain,
          category: s.category,
        })),
      );
      await log(
        migrationId,
        current,
        "copy",
        `Copied ${profile.subprocessors.length} subprocessor(s).`,
      );
    }

    if (profile.dataTypes?.length) {
      await client.replaceDataTypes(vendorId, owner, profile.dataTypes);
      await log(migrationId, current, "copy", `Copied ${profile.dataTypes.length} data type(s).`);
    }

    if (profile.faqs?.length) {
      await client.replaceFaqs(vendorId, owner, profile.faqs);
      await log(migrationId, current, "copy", `Copied ${profile.faqs.length} FAQ(s).`);
    }

    if (profile.updates?.length) {
      await client.replaceUpdates(
        vendorId,
        owner,
        profile.updates.map((u) => ({
          title: u.title,
          body: u.body ?? null,
          category: u.category ?? null,
          published_at: u.publishedAt ?? null,
        })),
      );
      await log(migrationId, current, "copy", `Copied ${profile.updates.length} update(s).`);
    }

    // --- download, AI-label, and upload every document ---
    const cookies = await sh.context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const today = new Date().toISOString().slice(0, 10);
    let imported = 0;

    for (const doc of docList.documents) {
      if (!doc.downloadUrl) {
        await log(migrationId, current, "skip", `No download URL for "${doc.title}".`);
        continue;
      }
      const url = absoluteUrl(doc.downloadUrl, m.sourceUrl);
      if (!url) continue;

      const file = await downloadFile(url, cookieHeader);
      if (!file) {
        await log(migrationId, current, "skip", `Could not download "${doc.title}".`);
        continue;
      }

      const filename = filenameFromUrl(url, `${doc.title}.${formatFromContentType(file.contentType, url)}`);
      const label = await labelDocument({
        apiKey: env.anthropicApiKey,
        model: env.model,
        filename,
        hintTitle: doc.title,
        hintType: doc.type,
      });

      const artifact = await client.createArtifact(vendorId, owner, {
        type: label.type,
        title: label.title,
        category: label.category,
        format: formatFromContentType(file.contentType, url),
        issued_at: doc.issuedAt || today,
        valid_until: doc.validUntil || null,
        access: "key_required",
      });
      await client.uploadArtifactContent(
        vendorId,
        owner,
        artifact.id,
        new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
        filename,
        MIGRATION_NOTE,
      );
      imported += 1;
      await persist(migrationId, { importedCount: imported });
      await log(migrationId, current, "import", `Imported "${label.title}" as ${label.type}.`);
    }

    await closeSession(sh);
    handle = undefined;

    await setStatus(
      migrationId,
      current,
      "completed",
      `${MIGRATION_NOTE} complete: imported ${imported} document(s) and copied the source trust center's content.`,
    );
  } catch (e) {
    await fail(migrationId, current, `Import phase failed: ${errMsg(e)}`);
    if (handle) await closeSession(handle.sh);
  }
}
