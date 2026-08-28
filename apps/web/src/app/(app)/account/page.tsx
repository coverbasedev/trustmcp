import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccountOverview } from "@/lib/account";
import { ROLE_LABEL, normalizeRole } from "@/lib/roles";
import { connectProvider, deleteMyAccount, disconnectProvider, saveProfile } from "./actions";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  sso: "Enterprise SSO",
  nodemailer: "Email sign-in link",
  dev: "Dev login",
};

const ERROR_COPY: Record<string, string> = {
  confirm: "Type “delete” to confirm account deletion.",
  "sole-owner":
    "You're the only owner of a workspace that still has other members. Transfer ownership or remove the other members first.",
  "not-found": "Account not found.",
  "link-failed": "Couldn't connect that sign-in method. Please try again.",
  "last-method": "That's your only way to sign in. Add another method before removing it.",
  "not-linked": "That method isn't linked to your account.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const account = await getAccountOverview(session.user.id);
  if (!account) redirect("/login");
  const { error, saved } = await searchParams;

  // Sign-in providers configured on this deployment that a user can link.
  const linkable = [
    { id: "google", show: !!process.env.AUTH_GOOGLE_ID },
    { id: "github", show: !!process.env.AUTH_GITHUB_ID },
    { id: "sso", show: !!process.env.SSO_ISSUER && !!process.env.SSO_CLIENT_ID },
  ].filter((p) => p.show);
  const connected = new Set(account.providers);
  const emailAvailable = !!process.env.EMAIL_SERVER && !!process.env.EMAIL_FROM;
  // A linked provider can be removed only if another sign-in path remains.
  const canUnlink = connected.size > 1 || emailAvailable;

  return (
    <div className="ui-90 mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your profile, sign-in methods, and workspace memberships.
        </p>
      </div>

      {error && ERROR_COPY[error] && <div className="banner-error">{ERROR_COPY[error]}</div>}
      {saved && <div className="banner-success">{saved === "linked" ? "Sign-in method linked." : "Saved."}</div>}

      {/* Profile */}
      <section className="card space-y-4">
        <div className="flex items-center gap-4">
          {account.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.image} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-xl font-semibold text-slate-600">
              {(account.name || account.email || "?").charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <h2 className="font-semibold">Profile</h2>
            <p className="text-sm text-slate-500">Member since {dateFmt.format(account.createdAt)}</p>
          </div>
        </div>
        <form action={saveProfile} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Display name</label>
            <input
              id="name"
              name="name"
              className="input"
              defaultValue={account.name ?? ""}
              placeholder="Your name"
              maxLength={120}
            />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              className="input bg-slate-50 text-slate-500"
              value={account.email ?? ""}
              disabled
            />
            <p className="mt-1 text-xs text-slate-400">
              Your email is managed by your sign-in provider.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Save profile</button>
          </div>
        </form>
      </section>

      {/* Sign-in methods */}
      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Sign-in methods</h2>
          <p className="text-sm text-slate-500">
            Connect more ways to sign in. Connecting runs the provider&apos;s sign-in and links it
            to this account. If that provider already has its own account, its workspaces and trust
            centers are merged into this one and the old account is removed.
          </p>
        </div>

        <div className="panel divide-y divide-slate-100">
          {emailAvailable && (
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-800">Email sign-in link</div>
                <div className="text-xs text-slate-400">Always available for {account.email}</div>
              </div>
              <span className="badge bg-emerald-50 text-emerald-700">Active</span>
            </div>
          )}
          {linkable.map((p) => {
            const isConnected = connected.has(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div className="text-sm font-medium text-slate-800">
                  {PROVIDER_LABEL[p.id] ?? p.id}
                </div>
                {isConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="badge bg-emerald-50 text-emerald-700">Connected</span>
                    {canUnlink && (
                      <form action={disconnectProvider}>
                        <input type="hidden" name="provider" value={p.id} />
                        <button className="btn-ghost text-xs" type="submit">Disconnect</button>
                      </form>
                    )}
                  </div>
                ) : (
                  <form action={connectProvider}>
                    <input type="hidden" name="provider" value={p.id} />
                    <button className="btn-ghost text-xs" type="submit">Connect</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
        {connected.size === 0 && !emailAvailable && (
          <p className="text-sm text-slate-400">No sign-in methods configured on this deployment.</p>
        )}
      </section>

      {/* Workspaces */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Workspaces</h2>
            <p className="text-sm text-slate-500">Organizations you belong to.</p>
          </div>
          <Link href="/team" className="btn-ghost">Manage team</Link>
        </div>
        <div className="panel">
          {account.memberships.map((m) => (
            <div
              key={m.orgId}
              className="flex items-center justify-between border-b border-slate-100 px-5 py-3 last:border-b-0"
            >
              <span className="text-sm font-medium text-slate-800">{m.orgName}</span>
              <span className="badge bg-slate-100 text-slate-600">{ROLE_LABEL[normalizeRole(m.role)]}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-red-200 bg-red-50/40 p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-red-700">Delete account</h2>
          <p className="text-sm text-slate-600">
            Permanently remove your account, profile, and personal workspace memberships. This
            cannot be undone.
          </p>
        </div>
        {account.blockingOrgs.length > 0 ? (
          <p className="text-sm text-red-700">
            You're the only owner of{" "}
            <span className="font-medium">
              {account.blockingOrgs.map((o) => o.orgName).join(", ")}
            </span>
            . Transfer ownership or remove the other members before deleting your account.
          </p>
        ) : (
          <form action={deleteMyAccount} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="confirm">
                Type <span className="font-mono">delete</span> to confirm
              </label>
              <input id="confirm" name="confirm" className="input" placeholder="delete" autoComplete="off" />
            </div>
            <button className="btn-danger" type="submit">Delete my account</button>
          </form>
        )}
      </section>
    </div>
  );
}
