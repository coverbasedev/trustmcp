import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CopyInviteLink } from "@/components/CopyInviteLink";
import { Select } from "@/components/select";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  canManageTeam,
  normalizeRole,
} from "@/lib/roles";
import {
  activeOrg,
  getOrgDomains,
  getRole,
  listMembers,
  listPendingInvites,
  listUserOrgs,
} from "@/lib/team";
import {
  addDomain,
  inviteMember,
  removeDomain,
  removeMemberAction,
  renameWorkspace,
  revokeInvite,
  setActiveOrg,
  setJoinRole,
  updateMemberRole,
} from "./actions";

export const dynamic = "force-dynamic";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await activeOrg(session.user.id, session.user.email);
  const [members, invites, myRole, orgs, domains] = await Promise.all([
    listMembers(org.id),
    listPendingInvites(org.id),
    getRole(session.user.id, org.id),
    listUserOrgs(session.user.id),
    getOrgDomains(org.id),
  ]);
  const manage = canManageTeam(myRole);
  const isOwner = normalizeRole(myRole) === "owner";

  return (
    <div className="ui-90 space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">{org.name} · Team</h1>
        <p className="mt-1 text-sm text-slate-500">
          Members access every trust center in this workspace. Assign roles to control who can
          edit evidence, review access requests, or just read along.
        </p>
        {orgs.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-400">Workspace:</span>
            {orgs.map((o) => (
              <form key={o.id} action={setActiveOrg.bind(null, o.id)}>
                <button
                  className={
                    o.id === org.id
                      ? "badge bg-brand-600 text-white"
                      : "badge bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }
                  type="submit"
                >
                  {o.name}
                </button>
              </form>
            ))}
          </div>
        )}
      </div>

      {/* Workspace name (owner only) */}
      {isOwner && (
        <section className="space-y-3">
          <h2 className="font-semibold">Workspace name</h2>
          <form action={renameWorkspace} className="card flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <label className="label" htmlFor="workspace-name">Name</label>
              <input
                id="workspace-name"
                name="name"
                required
                maxLength={80}
                className="input"
                defaultValue={org.name}
                placeholder="Acme Inc"
              />
            </div>
            <button className="btn-primary" type="submit">Save name</button>
          </form>
        </section>
      )}

      {/* Members */}
      <section className="space-y-3">
        <h2 className="font-semibold">Members ({members.length})</h2>
        <div className="panel">
          {members.map((m) => {
            const role = normalizeRole(m.role);
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {(m.name || m.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{m.name || m.email}</div>
                    <div className="truncate text-xs text-slate-400">{m.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {manage && role !== "owner" ? (
                    <form action={updateMemberRole} className="flex items-center gap-2">
                      <input type="hidden" name="membershipId" value={m.id} />
                      <Select
                        name="role"
                        defaultValue={role}
                        className="input h-9 py-0 text-sm"
                        ariaLabel="Member role"
                        options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                      />
                      <button className="btn-ghost" type="submit">Save</button>
                    </form>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-600">{ROLE_LABEL[role]}</span>
                  )}
                  {manage && role !== "owner" && (
                    <form action={removeMemberAction.bind(null, m.id)}>
                      <button className="btn-danger" type="submit">Remove</button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {manage && (
        <>
          {/* Invite */}
          <section className="space-y-3">
            <h2 className="font-semibold">Invite a teammate</h2>
            <form action={inviteMember} className="card flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <label className="label" htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="input"
                  placeholder="teammate@company.com"
                />
              </div>
              <div>
                <label className="label" htmlFor="role">Role</label>
                <Select
                  id="role"
                  name="role"
                  defaultValue="viewer"
                  ariaLabel="Role"
                  options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                />
              </div>
              <button className="btn-primary" type="submit">Send invite</button>
            </form>
            <p className="text-xs text-slate-400">
              If email isn&apos;t configured, copy the invite link from the pending list below and
              send it to your teammate directly.
            </p>

            {invites.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-600">Pending invites</h3>
                <div className="panel">
                  {invites.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-center justify-between border-b border-slate-100 px-5 py-3 last:border-b-0"
                    >
                      <div className="text-sm">
                        {i.email}{" "}
                        <span className="text-slate-400">· {ROLE_LABEL[normalizeRole(i.role)]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CopyInviteLink url={`${appUrl}/invite/${i.token}`} />
                        <form action={revokeInvite.bind(null, i.id)}>
                          <button className="btn-ghost" type="submit">Revoke</button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Domain allowlist */}
          <section className="space-y-3">
            <h2 className="font-semibold">Domain allowlist</h2>
            <p className="text-sm text-slate-500">
              Anyone who signs in with an email at a verified company domain automatically joins
              this workspace - no invite needed. New auto-joiners are added as{" "}
              <span className="font-medium text-slate-700">{ROLE_LABEL[normalizeRole(domains.joinRole)]}</span>.
            </p>
            <div className="card space-y-4">
              {domains.domains.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {domains.domains.map((d) => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-700"
                    >
                      <span className="font-mono">{d}</span>
                      <form action={removeDomain.bind(null, d)}>
                        <button
                          type="submit"
                          aria-label={`Remove ${d}`}
                          className="grid h-5 w-5 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        >
                          ×
                        </button>
                      </form>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No domains yet. Add one to enable auto-join.</p>
              )}

              <form action={addDomain} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                <div className="flex-1">
                  <label className="label" htmlFor="domain">Add domain</label>
                  <input id="domain" name="domain" className="input" placeholder="company.com" />
                </div>
                <button className="btn-primary" type="submit">Add</button>
              </form>

              <form action={setJoinRole} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                <div>
                  <label className="label" htmlFor="join-role">Auto-join role</label>
                  <Select
                    id="join-role"
                    name="role"
                    defaultValue={normalizeRole(domains.joinRole)}
                    ariaLabel="Auto-join role"
                    options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  />
                </div>
                <button className="btn-ghost" type="submit">Update role</button>
              </form>
              <p className="text-xs text-amber-600">
                Only add domains your organization controls. Everyone with an inbox at these
                domains can read this workspace.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
