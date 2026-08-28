import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
  return session.user as { id: string; email?: string | null; name?: string | null };
}

/** Returns the user's personal org, creating it (and a membership) on first use. */
export async function ensureOrg(userId: string, email?: string | null) {
  const existing = await db.membership.findFirst({
    where: { userId },
    include: { org: true },
  });
  if (existing) return existing.org;

  const base = (email?.split("@")[0] ?? "org").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  const org = await db.organization.create({
    data: {
      name: email ? `${email}'s workspace` : "Workspace",
      slug,
      memberships: { create: { userId, role: "owner" } },
    },
  });
  return org;
}

export async function listTrustCenters(userId: string) {
  const memberships = await db.membership.findMany({ where: { userId }, select: { orgId: true } });
  const orgIds = memberships.map((m) => m.orgId);
  return db.trustCenter.findMany({
    where: { orgId: { in: orgIds } },
    orderBy: { createdAt: "desc" },
  });
}

/** Owner email + legal name for a trust center (for notifications). */
export async function getOwnerContact(vendorId: string) {
  const tc = await db.trustCenter.findUnique({ where: { vendorId } });
  if (!tc) return null;
  const user = await db.user.findUnique({ where: { id: tc.createdById } });
  return { email: user?.email ?? null, legalName: tc.legalName, vendorId };
}

/** Loads a trust center and asserts the current user is a member of its org. */
export async function getTrustCenterForUser(userId: string, vendorId: string) {
  const tc = await db.trustCenter.findUnique({ where: { vendorId } });
  if (!tc) return null;
  const membership = await db.membership.findFirst({
    where: { userId, orgId: tc.orgId },
  });
  if (!membership) return null;
  return tc;
}
