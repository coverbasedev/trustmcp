import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ensureOrg } from "@/lib/trustcenter";
import { isAssignableRole } from "@/lib/roles";

export type AssignableRole = "admin" | "reviewer" | "viewer";

export const INVITE_TTL_DAYS = 14;

/** Normalize a free-form domain string to a bare host (e.g. "acme.com"). */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function emailDomain(email?: string | null): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}
const ACTIVE_ORG_COOKIE = "trustmcp_org";

/** All orgs the user belongs to, with their role. */
export async function listUserOrgs(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { org: true },
    orderBy: { org: { name: "asc" } },
  });
  return memberships.map((m) => ({ id: m.orgId, name: m.org.name, role: m.role }));
}

/** The user's active org: the cookie-selected one (if they're a member), else primary. */
export async function activeOrg(userId: string, email?: string | null) {
  const selected = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  if (selected) {
    const m = await db.membership.findFirst({ where: { userId, orgId: selected } });
    if (m) {
      const org = await db.organization.findUnique({ where: { id: selected } });
      if (org) return org;
    }
  }
  return ensureOrg(userId, email);
}

export async function setActiveOrgCookie(orgId: string) {
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function getRole(userId: string, orgId: string): Promise<string | null> {
  const m = await db.membership.findFirst({ where: { userId, orgId } });
  return m?.role ?? null;
}

/** Rename a workspace. Returns the trimmed name actually stored (capped at 80 chars). */
export async function renameOrg(orgId: string, name: string): Promise<string | null> {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return null;
  await db.organization.update({ where: { id: orgId }, data: { name: trimmed } });
  return trimmed;
}

export async function listMembers(orgId: string) {
  const members = await db.membership.findMany({
    where: { orgId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { role: "asc" },
  });
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    email: m.user.email,
    name: m.user.name,
  }));
}

export async function listPendingInvites(orgId: string) {
  return db.invitation.findMany({
    where: { orgId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}

export async function createInvitation(
  orgId: string,
  email: string,
  role: AssignableRole,
  invitedById: string,
) {
  const normalizedEmail = email.toLowerCase();
  // Supersede any earlier pending invite for the same address so the list never
  // shows duplicates and only the newest link/role is valid.
  await db.invitation.updateMany({
    where: { orgId, email: normalizedEmail, status: "pending" },
    data: { status: "revoked" },
  });
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  return db.invitation.create({
    data: { orgId, email: normalizedEmail, role, token, invitedById, expiresAt },
  });
}

/** Is this email already a member of the org? (Used to short-circuit invites.) */
export async function isMemberByEmail(orgId: string, email: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return false;
  const m = await db.membership.findFirst({ where: { userId: user.id, orgId } });
  return !!m;
}

export type AcceptResult =
  | { ok: true; orgId: string }
  | { ok: false; reason: "not-found" | "expired" | "already" };

export async function acceptInvitation(token: string, userId: string): Promise<AcceptResult> {
  const inv = await db.invitation.findUnique({ where: { token } });
  if (!inv || inv.status !== "pending") return { ok: false, reason: "not-found" };
  if (inv.expiresAt < new Date()) {
    await db.invitation.update({ where: { id: inv.id }, data: { status: "revoked" } });
    return { ok: false, reason: "expired" };
  }
  const existing = await db.membership.findFirst({ where: { userId, orgId: inv.orgId } });
  if (existing) {
    await db.invitation.update({ where: { id: inv.id }, data: { status: "accepted" } });
    return { ok: false, reason: "already" };
  }
  await db.membership.create({ data: { userId, orgId: inv.orgId, role: inv.role } });
  await db.invitation.update({ where: { id: inv.id }, data: { status: "accepted" } });
  return { ok: true, orgId: inv.orgId };
}

export async function revokeInvitation(orgId: string, invitationId: string) {
  await db.invitation.updateMany({
    where: { id: invitationId, orgId },
    data: { status: "revoked" },
  });
}

export async function removeMember(orgId: string, membershipId: string) {
  // Never remove the last owner.
  const m = await db.membership.findFirst({ where: { id: membershipId, orgId } });
  if (!m) return;
  if (m.role === "owner") {
    const owners = await db.membership.count({ where: { orgId, role: "owner" } });
    if (owners <= 1) return;
  }
  await db.membership.delete({ where: { id: m.id } });
}

export async function changeMemberRole(orgId: string, membershipId: string, role: AssignableRole) {
  const m = await db.membership.findFirst({ where: { id: membershipId, orgId } });
  if (!m || m.role === "owner") return; // owners aren't demoted here
  await db.membership.update({ where: { id: m.id }, data: { role } });
}

/** The current user's primary org (creating it on first use). */
export async function primaryOrg(userId: string, email?: string | null) {
  return ensureOrg(userId, email);
}

// --- Domain allowlist (auto-join) ---

export async function getOrgDomains(orgId: string): Promise<{ domains: string[]; joinRole: string }> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { allowedDomains: true, domainJoinRole: true },
  });
  return { domains: org?.allowedDomains ?? [], joinRole: org?.domainJoinRole ?? "viewer" };
}

export async function addAllowedDomain(orgId: string, domain: string) {
  const d = normalizeDomain(domain);
  if (!d || !d.includes(".")) return;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { allowedDomains: true },
  });
  if (!org) return;
  if (org.allowedDomains.includes(d)) return;
  await db.organization.update({
    where: { id: orgId },
    data: { allowedDomains: { set: [...org.allowedDomains, d] } },
  });
}

export async function removeAllowedDomain(orgId: string, domain: string) {
  const d = normalizeDomain(domain);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { allowedDomains: true },
  });
  if (!org) return;
  await db.organization.update({
    where: { id: orgId },
    data: { allowedDomains: { set: org.allowedDomains.filter((x) => x !== d) } },
  });
}

export async function setDomainJoinRole(orgId: string, role: AssignableRole) {
  if (!isAssignableRole(role)) return;
  await db.organization.update({ where: { id: orgId }, data: { domainJoinRole: role } });
}

/**
 * Auto-join: when a user signs in, grant them membership in every org that has
 * whitelisted their email domain (at the org's configured role) if they aren't a
 * member yet. Idempotent - safe to call on every sign-in. Returns orgs joined.
 */
export async function autoJoinByDomain(userId: string, email?: string | null): Promise<string[]> {
  const domain = emailDomain(email);
  if (!domain) return [];
  const orgs = await db.organization.findMany({
    where: { allowedDomains: { has: domain } },
    select: { id: true, domainJoinRole: true },
  });
  const joined: string[] = [];
  for (const org of orgs) {
    const existing = await db.membership.findFirst({ where: { userId, orgId: org.id } });
    if (existing) continue;
    const role = isAssignableRole(org.domainJoinRole) ? org.domainJoinRole : "viewer";
    await db.membership.create({ data: { userId, orgId: org.id, role } });
    joined.push(org.id);
  }
  return joined;
}
