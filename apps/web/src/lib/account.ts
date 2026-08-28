import "server-only";
import { db } from "@/lib/db";
import { roleRank } from "@/lib/roles";

export type AccountOverview = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  createdAt: Date;
  // Connected sign-in methods (OAuth/OIDC providers linked to this user).
  providers: string[];
  // Workspaces the user belongs to, with their role.
  memberships: { orgId: string; orgName: string; role: string }[];
  // Orgs where the user is the only owner AND other members exist - deleting the
  // account would orphan them, so deletion is blocked until ownership is handed off.
  blockingOrgs: { orgId: string; orgName: string }[];
};

export async function getAccountOverview(userId: string): Promise<AccountOverview | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      accounts: { select: { provider: true } },
      memberships: { include: { org: { select: { id: true, name: true } } } },
    },
  });
  if (!user) return null;

  const blockingOrgs: { orgId: string; orgName: string }[] = [];
  for (const m of user.memberships) {
    if (m.role !== "owner") continue;
    const [owners, total] = await Promise.all([
      db.membership.count({ where: { orgId: m.orgId, role: "owner" } }),
      db.membership.count({ where: { orgId: m.orgId } }),
    ]);
    if (owners <= 1 && total > 1) {
      blockingOrgs.push({ orgId: m.orgId, orgName: m.org.name });
    }
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    createdAt: user.createdAt,
    providers: [...new Set(user.accounts.map((a) => a.provider))],
    memberships: user.memberships.map((m) => ({
      orgId: m.orgId,
      orgName: m.org.name,
      role: m.role,
    })),
    blockingOrgs,
  };
}

export async function updateUserName(userId: string, name: string) {
  const trimmed = name.trim().slice(0, 120);
  await db.user.update({ where: { id: userId }, data: { name: trimmed || null } });
}

export type DeleteResult = { ok: true } | { ok: false; reason: "sole-owner" | "not-found" };

/**
 * Permanently delete the user. Refuses if they're the last owner of a workspace
 * that still has other members (they must transfer ownership first). Cascades
 * remove memberships, linked accounts, and sessions via the schema relations.
 */
export async function deleteAccount(userId: string): Promise<DeleteResult> {
  const overview = await getAccountOverview(userId);
  if (!overview) return { ok: false, reason: "not-found" };
  if (overview.blockingOrgs.length > 0) return { ok: false, reason: "sole-owner" };
  await db.user.delete({ where: { id: userId } });
  return { ok: true };
}

/**
 * Merge the `source` account into `target`, then delete `source`. Used when a
 * user connects a second sign-in provider (e.g. GitHub) that resolved to a
 * different, pre-existing account: everything tied to that account — its
 * workspaces and trust centers — is joined into the account they're signed into,
 * and the now-empty source account is removed.
 *
 * Concretely: the source's workspace memberships are added to the target (keeping
 * the higher role on overlap), trust centers it created are re-pointed to the
 * target, the source's linked provider accounts (including the one just
 * connected) move to the target, and finally the source user is deleted. Safe to
 * call when the source is a brand-new empty account (different-email link): it
 * just moves the provider link over and deletes the empty shell. No-ops if either
 * id is missing or they're the same. Returns whether a merge happened.
 */
export async function mergeAccounts(sourceId: string, targetId: string): Promise<boolean> {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const [source, target] = await Promise.all([
    db.user.findUnique({ where: { id: sourceId } }),
    db.user.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target) return false;

  // Join the source's workspaces into the target (highest role wins on overlap).
  const srcMemberships = await db.membership.findMany({ where: { userId: sourceId } });
  for (const m of srcMemberships) {
    const existing = await db.membership.findFirst({
      where: { userId: targetId, orgId: m.orgId },
    });
    if (!existing) {
      await db.membership.create({ data: { userId: targetId, orgId: m.orgId, role: m.role } });
    } else if (roleRank(m.role) > roleRank(existing.role)) {
      await db.membership.update({ where: { id: existing.id }, data: { role: m.role } });
    }
  }

  // Trust centers record their creator as a bare user id (no FK cascade), so
  // re-point them at the surviving account to avoid a dangling reference.
  await db.trustCenter.updateMany({
    where: { createdById: sourceId },
    data: { createdById: targetId },
  });

  // Move linked provider accounts to the target, skipping any that would collide
  // with one the target already has (unique on provider + providerAccountId).
  const srcAccounts = await db.account.findMany({ where: { userId: sourceId } });
  for (const acc of srcAccounts) {
    const clash = await db.account.findFirst({
      where: {
        provider: acc.provider,
        providerAccountId: acc.providerAccountId,
        NOT: { userId: sourceId },
      },
    });
    if (!clash) {
      await db.account.update({ where: { id: acc.id }, data: { userId: targetId } });
    }
  }

  // Remove the now-emptied source account (cascades any leftover rows).
  await db.user.delete({ where: { id: sourceId } });
  return true;
}

export type UnlinkResult = { ok: true } | { ok: false; reason: "last-method" | "not-linked" };

/**
 * Remove a linked OAuth/OIDC provider from the user. Refuses if it's their only
 * remaining way to sign in (no other linked provider and email sign-in is off),
 * so a user can't lock themselves out.
 */
export async function unlinkProvider(
  userId: string,
  provider: string,
  emailAvailable: boolean,
): Promise<UnlinkResult> {
  const accounts = await db.account.findMany({ where: { userId }, select: { provider: true } });
  if (!accounts.some((a) => a.provider === provider)) return { ok: false, reason: "not-linked" };
  const remaining = new Set(accounts.map((a) => a.provider));
  remaining.delete(provider);
  if (remaining.size === 0 && !emailAvailable) return { ok: false, reason: "last-method" };
  await db.account.deleteMany({ where: { userId, provider } });
  return { ok: true };
}
