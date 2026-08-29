import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GradeBadge } from "@/components/mcp-audit/ui";
import { db } from "@/lib/db";
import { canManage } from "@/lib/roles";
import { getRole } from "@/lib/team";
import { getTrustCenterForUser } from "@/lib/trustcenter";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function TrustCenterAuditsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const role = await getRole(session.user.id, tc.orgId);
  const manage = canManage(role);

  const published = await db.mcpAuditScan.findMany({
    where: { publishedVendorId: vendorId, published: true },
    orderBy: { publishedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">MCP audits</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Publish a TrustMCP risk scorecard for your own MCP server so customers can see how it scores
          before integrating. Run a scan in the{" "}
          <Link href="/audit/scans" className="underline">
            MCP Audit
          </Link>{" "}
          workspace, then publish it here — each publish records a version and appears on a dedicated
          page of your public trust center.
        </p>
      </div>

      {!manage && (
        <div className="banner-warning">You need admin or owner access to publish audits.</div>
      )}

      {published.length === 0 ? (
        <div className="card text-center">
          <h2 className="text-lg font-semibold">No published audits</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Scan your MCP server, then use “Publish to a trust center” on the scan to add its scorecard
            here.
          </p>
          <Link href="/audit/new" className="btn-primary mt-4 inline-block">
            Scan your server
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {published.map((s) => (
            <div key={s.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="badge bg-slate-100 text-slate-500">{s.publishedVersion}</span>
                </div>
                <div className="truncate text-xs text-slate-500">{s.targetUrl}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Published {s.publishedAt ? dateFmt.format(s.publishedAt) : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <GradeBadge grade={s.grade} score={s.overallScore} />
                <Link href={`/audit/${s.id}`} className="btn-ghost">
                  Manage
                </Link>
                {s.publishSlug && (
                  <Link
                    href={`/trust/${vendorId}/audit/${s.publishSlug}`}
                    className="btn-ghost"
                    target="_blank"
                  >
                    View ↗
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
