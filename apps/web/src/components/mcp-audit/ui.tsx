// Small presentational helpers shared across the audit report views. Pure server
// components — no client state.

import type { RiskSeverity } from "@/lib/mcp-audit/taxonomy";

const GRADE_STYLE: Record<string, string> = {
  A: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  B: "bg-lime-50 text-lime-700 ring-lime-200",
  C: "bg-amber-50 text-amber-700 ring-amber-200",
  D: "bg-orange-50 text-orange-700 ring-orange-200",
  F: "bg-red-50 text-red-700 ring-red-200",
};

export function GradeBadge({ grade, score }: { grade?: string | null; score?: number | null }) {
  const g = grade ?? "—";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ${
        GRADE_STYLE[g] ?? "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      <span className="text-lg leading-none">{g}</span>
      {typeof score === "number" && <span className="text-xs font-medium opacity-80">{score}/100 risk</span>}
    </div>
  );
}

const SEVERITY_STYLE: Record<RiskSeverity, string> = {
  info: "bg-slate-100 text-slate-600",
  low: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

export function SeverityChip({ severity }: { severity: RiskSeverity }) {
  return (
    <span className={`badge ${SEVERITY_STYLE[severity]}`}>{severity}</span>
  );
}

/** A 0–100 risk meter (higher = worse), colored by band. */
export function RiskMeter({ score }: { score: number }) {
  const color =
    score >= 85 ? "bg-red-500" : score >= 60 ? "bg-orange-500" : score >= 35 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, score)}%` }} />
    </div>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  pass: "bg-emerald-50 text-emerald-700",
  fail: "bg-red-50 text-red-700",
  needs_review: "bg-amber-50 text-amber-700",
  not_applicable: "bg-slate-100 text-slate-500",
};

export function OutcomeChip({ outcome }: { outcome: string }) {
  return <span className={`badge ${OUTCOME_STYLE[outcome] ?? "bg-slate-100 text-slate-600"}`}>{outcome.replace("_", " ")}</span>;
}
