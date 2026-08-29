import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GradeBadge } from "@/components/mcp-audit/ui";
import { hasCredential } from "@/lib/mcp-audit/store";
import { listScansForUser, primaryOrgId } from "@/lib/mcp-audit/store";

export const dynamic = "force-dynamic";

const ACTIVE = new Set(["pending", "inspecting", "researching", "probing", "scoring"]);

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function AuditListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [scans, orgId] = await Promise.all([
    listScansForUser(session.user.id),
    primaryOrgId(session.user.id),
  ]);
  const creds = orgId ? await hasCredential(orgId) : false;

  return (
    <div className="space-y-5">
      {!creds && (
        <div className="banner-warning">
          Add an OpenAI or Anthropic credential under{" "}
          <Link href="/audit/settings" className="underline">
            Controls &amp; credentials
          </Link>{" "}
          before running a scan.
        </div>
      )}

      {scans.length === 0 ? (
        <div className="card text-center">
          <h2 className="text-lg font-semibold">No scans yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Point TrustMCP at any MCP server and it will read the tools, research the vendor, probe it
            safely, and grade the integration risk.
          </p>
          <Link href="/audit/new" className="btn-primary mt-4 inline-block">
            Run your first scan
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {scans.map((s) => {
            const active = ACTIVE.has(s.status);
            return (
              <Link
                key={s.id}
                href={`/audit/${s.id}`}
                className="card flex items-center justify-between gap-4 transition hover:border-brand-300"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    {s.published && <span className="badge bg-brand-50 text-brand-700">published</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{s.targetUrl}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {dateFmt.format(s.createdAt)} · {s.model}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {active ? (
                    <span className="badge animate-pulse bg-amber-50 text-amber-700">{s.status}…</span>
                  ) : s.status === "failed" ? (
                    <span className="badge bg-red-50 text-red-700">failed</span>
                  ) : (
                    <GradeBadge grade={s.grade} score={s.overallScore} />
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
