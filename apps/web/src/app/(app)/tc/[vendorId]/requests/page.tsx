import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import type { KeyRequestItem, Recommendation } from "@trustmcp/sdk";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { applyRecommendation, approveKey, denyKey, revokeKey } from "../actions";

export const dynamic = "force-dynamic";

type Key = {
  id: string;
  requester: { name: string; domain: string };
  scope: string[];
  status: string;
  display_hint: string;
  expires_at: string;
  last_used_at: string | null;
};

const REC_STYLE: Record<string, string> = {
  approve: "bg-emerald-50 text-emerald-700",
  review: "bg-slate-100 text-slate-600",
  caution: "bg-red-50 text-red-600",
};

export default async function RequestsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const [requests, keys, artifacts] = await Promise.all([
    trustmcp().listKeyRequests(vendorId, tc.ownerToken),
    trustmcp().listKeys(vendorId, tc.ownerToken) as Promise<Key[]>,
    trustmcp().listArtifacts(vendorId, tc.ownerToken),
  ]);

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Requests</h1>
        <p className="text-sm text-slate-600">
          Review access requests with an automated recommendation, manage issued keys, and see
          past decisions.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Pending ({pending.length})</h2>
        {pending.length === 0 && <div className="card text-sm text-slate-500">Nothing awaiting review.</div>}
        {pending.map((r) => (
          <div key={r.id} className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  {r.requester.name} <span className="text-slate-400">({r.requester.domain})</span>
                  <RecBadge rec={r.recommendation} />
                </div>
                <div className="text-xs text-slate-400">
                  {r.requester.contact} · scope: {r.scope.join(", ")}
                  {r.nda_accepted ? " · NDA accepted" : ""}
                  {r.has_contract ? " · contract attached" : ""}
                </div>
                {r.recommendation && (
                  <ul className="mt-1 text-xs text-slate-500">
                    {r.recommendation.reasons.map((reason, i) => (
                      <li key={i}>• {reason}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-start gap-2">
                <form action={approveKey.bind(null, vendorId, r.id)} className="space-y-2">
                  {artifacts.length > 0 && r.scope.includes("artifacts") && (
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer">Limit to specific artifacts</summary>
                      <div className="mt-2 space-y-1">
                        {artifacts.map((a) => (
                          <label key={a.id} className="flex items-center gap-2">
                            <input type="checkbox" name="artifact_ids" value={a.id} />
                            {a.title || a.type} <span className="text-slate-400">({a.id})</span>
                          </label>
                        ))}
                        <p className="text-slate-400">Leave unchecked for full access.</p>
                      </div>
                    </details>
                  )}
                  <button className="btn-primary" type="submit">Approve</button>
                </form>
                <form action={denyKey.bind(null, vendorId, r.id)}>
                  <button className="btn-ghost" type="submit">Deny</button>
                </form>
                {r.recommendation && r.recommendation.level !== "review" && (
                  <form action={applyRecommendation.bind(null, vendorId, r.id, r.recommendation.level)}>
                    <button
                      className={r.recommendation.level === "approve" ? "btn-primary" : "btn-danger"}
                      type="submit"
                      title={r.recommendation.reasons.join("; ")}
                    >
                      Apply: {r.recommendation.level === "approve" ? "approve" : "deny"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Issued keys</h2>
        {keys.length === 0 && <div className="card text-sm text-slate-500">No keys issued yet.</div>}
        {keys.map((k) => (
          <div key={k.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">
                {k.requester.name} <span className="text-slate-400">({k.requester.domain})</span>{" "}
                <span className="badge bg-slate-100 text-slate-500">…{k.display_hint}</span>
              </div>
              <div className="text-xs text-slate-400">
                scope: {k.scope.join(", ")} · expires {new Date(k.expires_at).toLocaleDateString()} ·{" "}
                {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleString()}` : "never used"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${k.status === "granted" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {k.status}
              </span>
              {k.status === "granted" && (
                <form action={revokeKey.bind(null, vendorId, k.id)}>
                  <button className="btn-danger" type="submit">Revoke</button>
                </form>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">History</h2>
        {decided.length === 0 && <div className="card text-sm text-slate-500">No past decisions yet.</div>}
        {decided.length > 0 && (
          <div className="panel overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Requester</th>
                  <th>Outcome</th>
                  <th>How</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r: KeyRequestItem) => (
                  <tr key={r.id}>
                    <td>
                      {r.requester.name} <span className="text-slate-400">({r.requester.domain})</span>
                    </td>
                    <td>
                      <span className={`badge ${r.status === "granted" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="text-slate-500">
                      {r.auto_approved ? `auto (${r.decision_reason ?? "policy"})` : "manual"}
                    </td>
                    <td className="text-slate-400">
                      {r.decided_at ? new Date(r.decided_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RecBadge({ rec }: { rec?: Recommendation }) {
  if (!rec) return null;
  const label = rec.level === "approve" ? "recommend approve" : rec.level;
  return <span className={`badge ${REC_STYLE[rec.level] ?? "bg-slate-100"}`}>{label}</span>;
}
