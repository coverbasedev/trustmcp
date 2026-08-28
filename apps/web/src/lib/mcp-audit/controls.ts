// Static controls the audit engine always checks, regardless of which server is
// scanned. These are the deterministic, rule-based half of the audit: an LLM does
// the open-ended research and dynamic probing, but these controls are fixed
// assertions with a clear pass/fail/needs-review outcome, so two scans of the same
// server are comparable and a regression is visible.
//
// Each control maps to one risk dimension (taxonomy.ts) so a failed control raises
// the score of a specific dimension. Organizations extend this set with their own
// clauses (the AuditClause model) — those are merged in at scan time and evaluated
// the same way, letting a team encode "we never integrate a server that can delete
// production data without confirmation" as a first-class, reusable check.

import type { DimensionId } from "./taxonomy";

export type ControlOutcome = "pass" | "fail" | "needs_review" | "not_applicable";

export interface StaticControl {
  id: string;
  dimension: DimensionId;
  title: string;
  /** What a compliant server looks like. */
  intent: string;
  /** How the engine evaluates it: a deterministic heuristic over the tool
   *  inventory, or a judgement the model must make from evidence. */
  evaluation: "heuristic" | "model" | "hybrid";
  /** Weight applied to its dimension when this control fails (0–1). */
  weight: number;
}

export const STATIC_CONTROLS: StaticControl[] = [
  // --- Agency & autonomy ---
  {
    id: "ctl.autonomy.destructive_gated",
    dimension: "autonomy",
    title: "Destructive tools require confirmation or scoping",
    intent:
      "Delete/send/pay/execute tools are gated by a confirmation argument, a dry-run mode, or an " +
      "explicit scope — not callable in a single unconfirmed step.",
    evaluation: "hybrid",
    weight: 1,
  },
  {
    id: "ctl.autonomy.no_arbitrary_execution",
    dimension: "autonomy",
    title: "No arbitrary code or shell execution",
    intent: "The server exposes no tool that runs arbitrary code, shell commands, or SQL from free text.",
    evaluation: "heuristic",
    weight: 1,
  },
  {
    id: "ctl.autonomy.write_scope_declared",
    dimension: "autonomy",
    title: "State-changing tools are clearly labeled",
    intent: "Every tool that changes state says so in its description; read and write are distinguishable.",
    evaluation: "model",
    weight: 0.5,
  },

  // --- Data exposure ---
  {
    id: "ctl.data.output_schema",
    dimension: "data",
    title: "Tools declare an output schema",
    intent:
      "Tools return structuredContent / a declared output shape rather than open-ended text, so the " +
      "data surface is bounded and predictable.",
    evaluation: "heuristic",
    weight: 0.6,
  },
  {
    id: "ctl.data.no_bulk_export",
    dimension: "data",
    title: "No unbounded bulk export",
    intent: "No tool returns entire tables/mailboxes/record sets without a caller-supplied limit or filter.",
    evaluation: "hybrid",
    weight: 0.8,
  },
  {
    id: "ctl.data.field_minimization",
    dimension: "data",
    title: "Field minimization on reads",
    intent: "Read tools return the fields requested, not whole records including unrelated sensitive fields.",
    evaluation: "model",
    weight: 0.6,
  },

  // --- Privacy ---
  {
    id: "ctl.privacy.personal_data_disclosed",
    dimension: "privacy",
    title: "Personal-data processing is disclosed",
    intent: "If tools touch personal data, the vendor documents what, whose, and the lawful basis / DPA path.",
    evaluation: "model",
    weight: 0.7,
  },
  {
    id: "ctl.privacy.residency_declared",
    dimension: "privacy",
    title: "Data residency and retention stated",
    intent: "The vendor states where data is processed and how long it is retained.",
    evaluation: "model",
    weight: 0.5,
  },

  // --- Security posture ---
  {
    id: "ctl.sec.tls",
    dimension: "security_posture",
    title: "Transport is TLS",
    intent: "The server endpoint is https / TLS; no plaintext transport for tokens or data.",
    evaluation: "heuristic",
    weight: 1,
  },
  {
    id: "ctl.sec.scoped_auth",
    dimension: "security_posture",
    title: "Scoped, revocable authentication",
    intent: "Access uses per-tenant OAuth scopes or revocable keys, not a shared static bearer.",
    evaluation: "hybrid",
    weight: 0.9,
  },
  {
    id: "ctl.sec.no_tool_poisoning",
    dimension: "security_posture",
    title: "Tool descriptions free of injected instructions",
    intent:
      "No tool name/description/result contains imperative text aimed at the calling agent " +
      "(\"ignore previous\", \"always call\", hidden instructions) — i.e. no tool poisoning.",
    evaluation: "hybrid",
    weight: 1,
  },
  {
    id: "ctl.sec.tenant_isolation",
    dimension: "security_posture",
    title: "Tenant isolation on multi-tenant tools",
    intent: "A caller cannot reach another tenant's data by manipulating tool arguments.",
    evaluation: "model",
    weight: 0.8,
  },

  // --- Compliance ---
  {
    id: "ctl.comp.evidence_published",
    dimension: "compliance",
    title: "Assurance evidence is published",
    intent: "The vendor publishes current compliance evidence (SOC 2 / ISO / trust center) for the service.",
    evaluation: "model",
    weight: 0.7,
  },
  {
    id: "ctl.comp.dpa_available",
    dimension: "compliance",
    title: "DPA / BAA available for regulated data",
    intent: "Where regulated data is processed, a DPA (and BAA for PHI) is available and subprocessors listed.",
    evaluation: "model",
    weight: 0.7,
  },

  // --- Financial ---
  {
    id: "ctl.fin.transaction_limits",
    dimension: "financial",
    title: "Money-moving tools have limits or approval",
    intent: "Payment/payout/order tools enforce per-transaction or aggregate limits, or an approval step.",
    evaluation: "hybrid",
    weight: 1,
  },

  // --- Supply chain ---
  {
    id: "ctl.supply.provenance",
    dimension: "supply_chain",
    title: "Server provenance is verifiable",
    intent: "The server is first-party or open-source with disclosed downstream dependencies.",
    evaluation: "model",
    weight: 0.6,
  },

  // --- Operational ---
  {
    id: "ctl.ops.versioned",
    dimension: "operational",
    title: "Protocol and tools are versioned",
    intent: "The server declares a protocol version and versions its tool contract; changes are visible.",
    evaluation: "heuristic",
    weight: 0.5,
  },
  {
    id: "ctl.ops.error_semantics",
    dimension: "operational",
    title: "Clear error semantics",
    intent: "Failures return isError with a clear message, not ambiguous empty/happy-looking results.",
    evaluation: "hybrid",
    weight: 0.5,
  },

  // --- Governance ---
  {
    id: "ctl.gov.documented",
    dimension: "governance",
    title: "Tool surface is documented",
    intent: "Every tool has a meaningful description; the surface is knowable without probing.",
    evaluation: "heuristic",
    weight: 0.6,
  },
  {
    id: "ctl.gov.auditable",
    dimension: "governance",
    title: "Tool calls are auditable and revocable",
    intent: "The operator can review a call-level audit log and revoke access independently.",
    evaluation: "model",
    weight: 0.6,
  },

  // --- Liability ---
  {
    id: "ctl.liab.human_in_loop",
    dimension: "liability",
    title: "Human-in-the-loop for end-user-affecting actions",
    intent: "Actions that reach the operator's end users are reviewable/confirmable, not fully automated.",
    evaluation: "model",
    weight: 0.8,
  },
];

export const CONTROL_IDS = STATIC_CONTROLS.map((c) => c.id);

export function getControl(id: string): StaticControl | undefined {
  return STATIC_CONTROLS.find((c) => c.id === id);
}
