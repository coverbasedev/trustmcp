"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { canManage } from "@/lib/roles";
import { getRole } from "@/lib/team";
import { getTrustCenterForUser, requireUser } from "@/lib/trustcenter";
import { runImportPhase, runRequestPhase } from "@/lib/migration";

// Importing/copying content requires owner or admin on the target trust center.
async function manageCtx(vendorId: string) {
  const user = await requireUser();
  const tc = await getTrustCenterForUser(user.id, vendorId);
  if (!tc) throw new Error("FORBIDDEN");
  const role = await getRole(user.id, tc.orgId);
  if (!canManage(role)) throw new Error("FORBIDDEN: requires admin or owner role");
  return { user, tc };
}

function refresh(vendorId: string) {
  revalidatePath(`/tc/${vendorId}/migrations`);
}

export type MigrationFormState = { error?: string };

function validUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Start a Trust Center AI Migration: kick off the request phase (open the source,
 * request docs, sign any NDA) in the background and return to the dashboard, which
 * polls for progress and surfaces a Resume button once it's awaiting release.
 */
export async function startMigration(
  vendorId: string,
  _prev: MigrationFormState,
  formData: FormData,
): Promise<MigrationFormState> {
  const { user } = await manageCtx(vendorId);

  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  const requesterName = String(formData.get("requester_name") ?? "").trim();
  const requesterEmail = String(formData.get("requester_email") ?? "").trim().toLowerCase();
  const requesterCompany = String(formData.get("requester_company") ?? "").trim();
  const accessNotes = String(formData.get("access_notes") ?? "").trim();

  if (!validUrl(sourceUrl)) {
    return { error: "Enter the source trust center URL, including https://." };
  }
  if (!requesterEmail) {
    return { error: "A requester email is required to ask the source for access." };
  }

  const migration = await db.trustCenterMigration.create({
    data: {
      vendorId,
      sourceUrl,
      requesterName: requesterName || null,
      requesterEmail,
      requesterCompany: requesterCompany || null,
      accessNotes: accessNotes || null,
      createdById: user.id,
      status: "pending",
      statusDetail: "Queued. Starting the Browserbase session…",
    },
  });

  // Detached: the web service is a long-lived process, so the phase keeps running
  // after this action returns. It persists its own progress and terminal state.
  void runRequestPhase(migration.id).catch(() => {
    /* runRequestPhase records failures itself */
  });

  refresh(vendorId);
  return {};
}

/** Press Resume: pull all documents/details and copy them into this trust center. */
export async function resumeMigration(vendorId: string, migrationId: string): Promise<void> {
  await manageCtx(vendorId);
  const migration = await db.trustCenterMigration.findUnique({ where: { id: migrationId } });
  if (!migration || migration.vendorId !== vendorId) throw new Error("NOT_FOUND");

  await db.trustCenterMigration.update({
    where: { id: migrationId },
    data: { status: "importing", statusDetail: "Resuming — importing documents and content…" },
  });

  void runImportPhase(migrationId).catch(() => {
    /* runImportPhase records failures itself */
  });

  refresh(vendorId);
}

/** Retry a failed migration from the request phase. */
export async function retryMigration(vendorId: string, migrationId: string): Promise<void> {
  await manageCtx(vendorId);
  const migration = await db.trustCenterMigration.findUnique({ where: { id: migrationId } });
  if (!migration || migration.vendorId !== vendorId) throw new Error("NOT_FOUND");

  await db.trustCenterMigration.update({
    where: { id: migrationId },
    data: { status: "pending", statusDetail: "Retrying…", browserbaseSessionId: null },
  });

  void runRequestPhase(migrationId).catch(() => {
    /* records failures itself */
  });

  refresh(vendorId);
}

export async function deleteMigration(vendorId: string, migrationId: string): Promise<void> {
  await manageCtx(vendorId);
  await db.trustCenterMigration.deleteMany({ where: { id: migrationId, vendorId } });
  refresh(vendorId);
}
