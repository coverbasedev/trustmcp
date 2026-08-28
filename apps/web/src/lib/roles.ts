// Role model for organization membership. Pure helpers (unit-tested).
//
// Standard roles, highest privilege first:
//   owner     - billing + everything an admin can do; cannot be demoted via the UI.
//   admin     - full management: edit evidence, publish, review access, manage the team.
//   reviewer  - "request reviewer": approve/deny/revoke access requests, but cannot
//               edit trust-center content or manage the team.
//   viewer    - read-only access to every trust center in the workspace.
//
// "member" is the legacy name for "viewer" and is still accepted from older rows.

export type Role = "owner" | "admin" | "reviewer" | "viewer";

export const ROLES: Role[] = ["owner", "admin", "reviewer", "viewer"];

// Roles a teammate can be invited as or moved to (owner is assigned only at org
// creation and is transferred, never handed out through the invite/role UI).
export const ASSIGNABLE_ROLES: Exclude<Role, "owner">[] = ["admin", "reviewer", "viewer"];

// Human-facing copy for the role pickers and badges. Single source of truth so
// the team UI and invite emails stay consistent.
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  reviewer: "Request reviewer",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: "Full control of the workspace, billing, and ownership transfer.",
  admin: "Manage evidence, publish, review access, and manage the team.",
  reviewer: "Approve, deny, and revoke access requests. No editing or team changes.",
  viewer: "Read-only access to every trust center in the workspace.",
};

// Normalize a stored role string, folding the legacy "member" value into "viewer"
// and anything unrecognized into the safest (lowest-privilege) role.
export function normalizeRole(role?: string | null): Role {
  if (role === "member") return "viewer";
  return isValidRole(role ?? "") ? (role as Role) : "viewer";
}

// Roles allowed to manage a trust center (edit, publish, configure, delete).
export function canManage(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === "owner" || r === "admin";
}

// Roles allowed to review access requests (approve/deny/revoke keys).
export function canReviewRequests(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === "owner" || r === "admin" || r === "reviewer";
}

// Only owners/admins can administer the team (invite, remove, change roles,
// manage the domain allowlist); only owners can change owners.
export function canManageTeam(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === "owner" || r === "admin";
}

export function isAssignableRole(role: string): role is "admin" | "reviewer" | "viewer" {
  // The "owner" role is assigned only at org creation, not via invites/changes.
  return role === "admin" || role === "reviewer" || role === "viewer";
}

export function isValidRole(role: string): role is Role {
  return (ROLES as string[]).includes(role);
}

// Higher rank = more privilege. Used to prevent lower roles outranking higher
// ones. Unlike the permission checks, an absent/unknown role ranks 0 (below every
// real role) rather than folding into "viewer"; only the legacy "member" maps in.
export function roleRank(role?: string | null): number {
  switch (role === "member" ? "viewer" : role) {
    case "owner":
      return 4;
    case "admin":
      return 3;
    case "reviewer":
      return 2;
    case "viewer":
      return 1;
    default:
      return 0;
  }
}

export function outranks(a?: string | null, b?: string | null): boolean {
  return roleRank(a) > roleRank(b);
}
