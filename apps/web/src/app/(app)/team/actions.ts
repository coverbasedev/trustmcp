"use server";

import { revalidatePath } from "next/cache";
import { sendMail } from "@/lib/mail";
import { canManageTeam, isAssignableRole, normalizeRole, ROLE_LABEL, type Role } from "@/lib/roles";
import {
  activeOrg,
  addAllowedDomain,
  changeMemberRole,
  createInvitation,
  getRole,
  isMemberByEmail,
  removeAllowedDomain,
  removeMember,
  renameOrg,
  revokeInvitation,
  setActiveOrgCookie,
  setDomainJoinRole,
} from "@/lib/team";
import { requireUser } from "@/lib/trustcenter";

async function manageCtx() {
  const user = await requireUser();
  const org = await activeOrg(user.id, user.email);
  const role = await getRole(user.id, org.id);
  if (!canManageTeam(role)) throw new Error("FORBIDDEN: requires admin or owner role");
  return { user, org };
}

export async function renameWorkspace(formData: FormData) {
  const user = await requireUser();
  const org = await activeOrg(user.id, user.email);
  const role = await getRole(user.id, org.id);
  // Only the workspace owner can rename it.
  if (normalizeRole(role) !== "owner") throw new Error("FORBIDDEN: only the owner can rename the workspace");
  const name = String(formData.get("name") ?? "");
  await renameOrg(org.id, name);
  revalidatePath("/team");
  revalidatePath("/", "layout"); // workspace name shows in the team header + switcher
}

export async function setActiveOrg(orgId: string) {
  const user = await requireUser();
  const m = await getRole(user.id, orgId);
  if (m) await setActiveOrgCookie(orgId);
  revalidatePath("/", "layout");
}

export async function inviteMember(formData: FormData) {
  const { user, org } = await manageCtx();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "viewer");
  if (!email.includes("@") || !isAssignableRole(role)) return;
  if (await isMemberByEmail(org.id, email)) return; // already on the team
  const inv = await createInvitation(org.id, email, role, user.id);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await sendMail({
    to: email,
    subject: `You're invited to ${org.name} on TrustMCP`,
    text:
      `${user.email ?? "A teammate"} invited you to join ${org.name} as ${ROLE_LABEL[role]}.\n\n` +
      `Accept: ${base}/invite/${inv.token}\n\nThis link expires in 14 days.`,
  });
  revalidatePath("/team");
}

export async function addDomain(formData: FormData) {
  const { org } = await manageCtx();
  const domain = String(formData.get("domain") ?? "");
  await addAllowedDomain(org.id, domain);
  revalidatePath("/team");
}

export async function removeDomain(domain: string) {
  const { org } = await manageCtx();
  await removeAllowedDomain(org.id, domain);
  revalidatePath("/team");
}

export async function setJoinRole(formData: FormData) {
  const { org } = await manageCtx();
  const role = String(formData.get("role") ?? "viewer") as Role;
  if (!isAssignableRole(role)) return;
  await setDomainJoinRole(org.id, role);
  revalidatePath("/team");
}

export async function revokeInvite(invitationId: string) {
  const { org } = await manageCtx();
  await revokeInvitation(org.id, invitationId);
  revalidatePath("/team");
}

export async function removeMemberAction(membershipId: string) {
  const { org } = await manageCtx();
  await removeMember(org.id, membershipId);
  revalidatePath("/team");
}

export async function updateMemberRole(formData: FormData) {
  const { org } = await manageCtx();
  const membershipId = String(formData.get("membershipId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!isAssignableRole(role)) return;
  await changeMemberRole(org.id, membershipId, role);
  revalidatePath("/team");
}
