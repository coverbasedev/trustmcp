import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const client = trustmcp();

  const [vendor, artifacts, requests, insights] = await Promise.all([
    client.getVendor(vendorId, tc.ownerToken),
    client.listArtifacts(vendorId, tc.ownerToken),
    client.listKeyRequests(vendorId, tc.ownerToken),
    client.getInsights(vendorId, tc.ownerToken),
  ]);

  const steps = [
    ["Brand your trust center", !!vendor.branding?.headline, `/tc/${vendorId}/branding`],
    ["Upload evidence", artifacts.length > 0, `/tc/${vendorId}/artifacts`],
    ["Declare attestations", insights ? true : false, `/tc/${vendorId}/attestations`],
    ["Verify a domain", vendor.mark_status === "agent-ready", `/tc/${vendorId}/domains`],
    ["Publish", !!vendor.published_at, `/tc/${vendorId}/setup`],
  ] as const;
  const done = steps.filter((s) => s[1]).length;
  const pct = Math.round((done / steps.length) * 100);
  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      {pending > 0 && (
        <Link
          href={`/tc/${vendorId}/requests`}
          className="banner-warning block hover:bg-amber-100"
        >
          {pending} request{pending === 1 ? "" : "s"} awaiting review →
        </Link>
      )}

      {pct < 100 && (
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Finish setting up ({done}/{steps.length})</h2>
            <Link href={`/tc/${vendorId}/setup`} className="text-sm text-slate-900 hover:underline">Open guided setup →</Link>
          </div>
          <div className="progress mt-3">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {steps.filter((s) => !s[1]).map(([label, , href]) => (
              <li key={label}>
                <Link href={href} className="text-slate-900 hover:underline">○ {label}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Artifacts" value={`${artifacts.length}`} href={`/tc/${vendorId}/artifacts`} />
        <Stat label="Active keys" value={`${insights.keys.active}`} href={`/tc/${vendorId}/requests`} />
        <Stat label="Pending" value={`${pending}`} href={`/tc/${vendorId}/requests`} />
        <Stat label="Total reads" value={`${insights.reads.total}`} href={`/tc/${vendorId}/insights`} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Recent activity</h2>
          <Link href={`/tc/${vendorId}/audit`} className="text-sm text-slate-900 hover:underline">Full audit log →</Link>
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {insights.recent_activity.length === 0 && <li className="text-slate-400">No activity yet.</li>}
          {insights.recent_activity.slice(0, 8).map((e, i) => (
            <li key={i} className="flex justify-between text-slate-600">
              <span>{e.action}{e.target ? ` · ${e.target}` : ""}</span>
              <span className="text-slate-400">{new Date(e.at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="card hover:border-slate-400">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Link>
  );
}
