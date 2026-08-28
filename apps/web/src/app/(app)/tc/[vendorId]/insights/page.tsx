import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const i = await trustmcp().getInsights(vendorId, tc.ownerToken);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Insights</h1>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Total requests" value={i.requests.total} />
        <Stat label="Granted" value={i.requests.granted} sub={`${i.requests.auto_approved} auto`} />
        <Stat label="Active keys" value={i.keys.active} sub={`${i.keys.revoked} revoked`} />
        <Stat label="Total reads" value={i.reads.total} />
      </div>

      <div className="card">
        <h2 className="font-semibold">Request funnel</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Funnel label="Pending" value={i.requests.pending} dot="bg-amber-500" />
          <Funnel label="Granted" value={i.requests.granted} dot="bg-emerald-500" />
          <Funnel label="Denied" value={i.requests.denied} dot="bg-red-500" />
          <Funnel label="Auto" value={i.requests.auto_approved} dot="bg-slate-400" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">Most-read artifacts</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {i.reads.by_artifact.length === 0 && <li className="text-slate-400">No reads yet.</li>}
            {i.reads.by_artifact.map((a) => (
              <li key={a.artifact_id} className="flex justify-between">
                <span className="text-slate-600">{a.artifact_id}</span>
                <span className="font-medium">{a.reads}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="font-semibold">Most active readers</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {i.reads.by_requester.length === 0 && <li className="text-slate-400">No reads yet.</li>}
            {i.reads.by_requester.map((a) => (
              <li key={a.requester} className="flex justify-between">
                <span className="text-slate-600">{a.requester}</span>
                <span className="font-medium">{a.reads}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Recent activity</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {i.recent_activity.map((e, idx) => (
            <li key={idx} className="flex justify-between text-slate-600">
              <span>{e.action}{e.target ? ` · ${e.target}` : ""}{e.actor ? ` · ${e.actor}` : ""}</span>
              <span className="text-slate-400">{new Date(e.at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="text-xs text-slate-400">{sub}</div> : null}
    </div>
  );
}

function Funnel({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        {label}
      </div>
    </div>
  );
}
