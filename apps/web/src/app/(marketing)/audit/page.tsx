import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { RISK_DIMENSIONS } from "@/lib/mcp-audit/taxonomy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MCP Audit — TrustMCP",
  description:
    "Scan any MCP server for integration risk. TrustMCP reads its tools, researches the vendor, probes it safely, and grades the risk across every dimension that matters.",
};

export default async function AuditLandingPage() {
  // Signed-in users go straight to their audit console.
  const session = await auth();
  if (session?.user?.id) redirect("/audit/scans");

  return (
    <div className="mx-auto max-w-4xl space-y-12 px-4 py-12">
      <header className="space-y-4 text-center">
        <span className="badge bg-brand-50 text-brand-700">Open MCP risk scanning</span>
        <h1 className="text-4xl font-semibold tracking-tight">Audit an MCP server before you trust it</h1>
        <p className="mx-auto max-w-2xl text-lg text-slate-600">
          An API tells you the fields, formats, and schemas you&apos;re exchanging. An MCP server
          doesn&apos;t — and agents lean on exactly that open-endedness to be powerful. TrustMCP reads a
          server&apos;s tools, researches the company behind it, generates dynamic probes tailored to
          that specific server, and produces a standardized risk scorecard.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/audit/new" className="btn-primary">
            Run a scan
          </Link>
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Read the tools", "Handshake with the server (read-only) and enumerate every tool, resource, and prompt — then classify each as read, write, destructive, or outward-facing."],
          ["Research the vendor", "Identify the company, what it does, its compliance posture, and any public incidents — using your intended-use context to weight what matters."],
          ["Probe dynamically", "Every server is different, so probes are generated for this one. Read-only probes run live; anything that could change state is a recommendation, never auto-run."],
        ].map(([title, body]) => (
          <div key={title} className="card">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="text-center">
          <h2 className="text-2xl font-semibold">The risk dimensions we score</h2>
          <p className="mx-auto mt-1 max-w-2xl text-sm text-slate-600">
            A shared nomenclature so scorecards are comparable across servers, even though the findings
            behind them are always server-specific. Each dimension is scored 0–100 with a rationale.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {RISK_DIMENSIONS.map((d) => (
            <div key={d.id} className="rounded-lg border border-slate-200 p-4">
              <div className="font-medium">{d.name}</div>
              <p className="mt-1 text-sm text-slate-600">{d.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-xl font-semibold">What you get</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>A letter-graded scorecard with an executive summary and per-dimension risk.</li>
          <li>A security model and threat model written for your specific intended use.</li>
          <li>Per-integration-point analysis of the data likely present and how the server interacts with it.</li>
          <li>Static controls plus your own reusable clauses, validated on every scan.</li>
          <li>A content-hashed evidence bundle, optionally attested with Corsair.</li>
          <li>An interaction layer to interrogate the audit and re-inspect the live server.</li>
        </ul>
        <div>
          <Link href="/audit/new" className="btn-primary">
            Start your first scan
          </Link>
        </div>
      </section>

      <p className="text-center text-xs text-slate-400">
        Only scan MCP servers you are authorized to assess. TrustMCP never invokes write or destructive
        tools automatically.
      </p>
    </div>
  );
}
