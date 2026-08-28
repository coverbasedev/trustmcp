import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listTrustCenters } from "@/lib/trustcenter";
import { trustmcp } from "@/lib/trustmcp";
import type { ArtifactOut } from "@trustmcp/sdk";
import NewTrustCenterModal from "@/components/new-trust-center-modal";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const REFRESH_WINDOW_DAYS = 60;
const DAY = 86_400_000;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; new?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { error, new: openNew } = await searchParams;
  const centers = await listTrustCenters(session.user.id);

  // ---- Empty state: guide first-time creation. ----
  if (centers.length === 0) {
    return (
      <div className="space-y-6">
        {error && <div className="banner-error">{error}</div>}
        <div className="panel flex flex-col items-center justify-center px-6 py-20 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-900 text-white" aria-hidden>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Create your first trust center</h1>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            A trust center publishes your security evidence to the TrustMCP Network so agents (and the
            people behind them) can assess you in seconds. Set one up to start approving access requests.
          </p>
          <div className="mt-5">
            <NewTrustCenterModal defaultOpen={openNew === "1"} />
          </div>
        </div>
      </div>
    );
  }

  // ---- Resolve the active center (cookie -> first). ----
  const cookieId = (await cookies()).get("tmcp_tc")?.value ?? null;
  const active = centers.find((c) => c.vendorId === cookieId) ?? centers[0];

  const client = trustmcp();
  const [vendor, artifacts, requests, insights] = await Promise.all([
    client.getVendor(active.vendorId, active.ownerToken),
    client.listArtifacts(active.vendorId, active.ownerToken),
    client.listKeyRequests(active.vendorId, active.ownerToken),
    client.getInsights(active.vendorId, active.ownerToken),
  ]);

  const name = vendor.branding?.display_name || active.legalName;
  const pending = requests.filter((r) => r.status === "pending").length;
  const isPublished = !!vendor.published_at;

  // "View public" opens the connected custom domain once verified, else the
  // trustmcp.app/trust/… URL (both are the chrome-free public trust center).
  const customDomain = (
    vendor.branding as { custom_domain?: { domain?: string; status?: string } } | undefined
  )?.custom_domain;
  const publicHref =
    customDomain?.domain && (customDomain.status === "verified" || customDomain.status === "active")
      ? `https://${customDomain.domain}`
      : `/trust/${active.vendorId}`;

  // Docs coming up for refresh: anything expired or expiring within the window,
  // soonest first.
  const now = Date.now();
  const refreshDue = artifacts
    .filter((a) => a.valid_until)
    .map((a) => ({ a, until: new Date(a.valid_until as string).getTime() }))
    .filter(({ until }) => Number.isFinite(until) && until - now < REFRESH_WINDOW_DAYS * DAY)
    .sort((x, y) => x.until - y.until)
    .slice(0, 6);

  const recent = insights.recent_activity.slice(0, 8);

  return (
    <div className="ui-90 space-y-7">
      {error && <div className="banner-error">{error}</div>}

      {/* Header: which center + primary actions. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Trust center</p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold">{name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`badge ${vendor.mark_status === "agent-ready" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {vendor.mark_status === "agent-ready" ? "● verified" : "● unverified"}
            </span>
            <span className={`badge ${isPublished ? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-500"}`}>
              {isPublished ? "published" : "draft"}
            </span>
            <span className="font-mono text-xs text-slate-400">{active.vendorId}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NewTrustCenterModal className="btn-ghost" defaultOpen={openNew === "1"} />
          <Link href={publicHref} target="_blank" rel="noreferrer" className="btn-ghost">
            View public ↗
          </Link>
          <Link href={`/tc/${active.vendorId}`} className="btn-primary">
            Configure trust center
          </Link>
        </div>
      </div>

      {/* Primary use case: requests awaiting a decision. */}
      {pending > 0 ? (
        <Link
          href={`/tc/${active.vendorId}/requests`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 transition hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/15 text-amber-700" aria-hidden>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M12 9v4" /><path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </span>
            <div>
              <div className="font-semibold text-amber-900">
                {pending} access request{pending === 1 ? "" : "s"} awaiting your decision
              </div>
              <div className="text-sm text-amber-700">Review and approve or deny requesters →</div>
            </div>
          </div>
          <span className="btn-primary !bg-amber-600 hover:!bg-amber-700">Review requests</span>
        </Link>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-500">
          No access requests are awaiting a decision. New requests will appear here.
        </div>
      )}

      {/* At-a-glance stats. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Documents" value={`${artifacts.length}`} hint="in this trust center" href={`/tc/${active.vendorId}/artifacts`} />
        <Stat label="Pending requests" value={`${pending}`} hint="to approve / deny" href={`/tc/${active.vendorId}/requests`} accent={pending > 0} />
        <Stat label="Active keys" value={`${insights.keys.active}`} hint="issued to requesters" href={`/tc/${active.vendorId}/requests`} />
        <Stat label="Total reads" value={`${insights.reads.total}`} hint="via the MCP" href={`/tc/${active.vendorId}/insights`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coming up for refresh. */}
        <section className="panel">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold">Coming up for refresh</h2>
            <Link href={`/tc/${active.vendorId}/artifacts`} className="text-sm text-slate-500 hover:text-slate-900">
              All documents →
            </Link>
          </div>
          {refreshDue.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">
              Nothing expiring in the next {REFRESH_WINDOW_DAYS} days. You&apos;re current.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {refreshDue.map(({ a, until }) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{a.title || a.type}</div>
                    <div className="truncate text-xs text-slate-400">{docLabel(a)}</div>
                  </div>
                  <RefreshBadge until={until} now={now} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent MCP access by requesters. */}
        <section className="panel">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold">Recent MCP access</h2>
            <Link href={`/tc/${active.vendorId}/audit`} className="text-sm text-slate-500 hover:text-slate-900">
              Audit log →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">No access yet. Reads by requesters show up here.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-700">
                      <span className="font-medium text-slate-900">{e.actor ?? "Someone"}</span>{" "}
                      <span className="text-slate-500">{e.action}</span>
                      {e.target ? <span className="text-slate-400"> · {e.target}</span> : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{new Date(e.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Minor use case: find vendors. */}
      <Link
        href="/directory"
        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-5 py-4 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500" aria-hidden>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <div>
            <div className="font-medium text-slate-900">Search the Trust Directory</div>
            <div className="text-sm text-slate-500">Find a vendor&apos;s trust center and request access.</div>
          </div>
        </div>
        <span className="text-slate-300">→</span>
      </Link>
    </div>
  );
}

function docLabel(a: ArtifactOut): string {
  const parts = [a.category || a.type];
  if (a.valid_until) parts.push(`valid until ${dateFmt.format(new Date(a.valid_until))}`);
  return parts.join(" · ");
}

function RefreshBadge({ until, now }: { until: number; now: number }) {
  const days = Math.ceil((until - now) / DAY);
  if (days < 0) return <span className="badge bg-red-50 text-red-600">expired</span>;
  if (days <= 14) return <span className="badge bg-amber-50 text-amber-700">{days}d left</span>;
  return <span className="badge bg-slate-100 text-slate-500">{days}d left</span>;
}

function Stat({
  label,
  value,
  hint,
  href,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`card transition hover:border-slate-400 ${accent ? "ring-1 ring-amber-200" : ""}`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${accent ? "text-amber-700" : "text-slate-900"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{hint}</div>
    </Link>
  );
}
