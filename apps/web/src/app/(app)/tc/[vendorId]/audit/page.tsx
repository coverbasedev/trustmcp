import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";

export const dynamic = "force-dynamic";

type Entry = {
  action: string;
  actor: string | null;
  target: string | null;
  detail: string | null;
  access_key_id: string | null;
  at: string;
};

export default async function AuditPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const entries = (await trustmcp().getAudit(vendorId, tc.ownerToken)) as Entry[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <div className="flex gap-2">
          <a href={`/api/tc/${vendorId}/audit?format=csv`} className="btn-ghost">Export CSV</a>
          <a href={`/api/tc/${vendorId}/audit?format=json`} className="btn-ghost">Export JSON</a>
        </div>
      </div>
      <p className="text-sm text-slate-600">
        Every read and every management action is recorded - including which customer key read which
        artifact.
      </p>
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No activity yet.</td>
              </tr>
            )}
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-slate-500">
                  {new Date(e.at).toLocaleString()}
                </td>
                <td className="font-medium">{e.action}</td>
                <td className="text-slate-500">{e.actor ?? "-"}</td>
                <td className="text-slate-500">{e.target ?? "-"}</td>
                <td className="text-slate-400">{e.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
