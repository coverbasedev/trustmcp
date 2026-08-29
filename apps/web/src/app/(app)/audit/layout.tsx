import Link from "next/link";
import { AuditTabs } from "@/components/mcp-audit/AuditTabs";

// Workspace-level MCP Audit section (not tied to a single trust center). Scans,
// the new-scan wizard, and the org's controls/credentials live under here.
export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ui-90 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-xs text-slate-400 hover:text-slate-600">
            Workspace
          </Link>
          <h1 className="mt-0.5 text-2xl font-semibold">MCP Audit</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Scan an MCP server for integration risk. TrustMCP reads its tools, researches the vendor,
            generates dynamic probes, evaluates your controls, and produces a standardized risk
            scorecard across every dimension that matters — data, privacy, autonomy, financial,
            compliance, reputational, and liability exposure.
          </p>
        </div>
        <Link href="/audit/new" className="btn-primary whitespace-nowrap">
          New scan
        </Link>
      </div>

      <AuditTabs />
      <div>{children}</div>
    </div>
  );
}
