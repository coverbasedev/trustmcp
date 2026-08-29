// Shared shapes for an MCP audit scan. These are the JSON blobs persisted on the
// McpAuditScan row (toolInventory, findings, scorecard) and the contract the
// report UI, the public published page, and the MCP interaction layer all read.
//
// Versioned: SCAN_SCHEMA_VERSION lets a published scorecard declare which engine
// produced it, so a vendor can pin a version when they publish and the reader
// knows how to interpret it.

import type { ControlOutcome } from "./controls";
import type { DimensionId, RiskSeverity } from "./taxonomy";

export const SCAN_SCHEMA_VERSION = "1.0";

/** MCP transport we know how to speak to. */
export type McpTransport = "http" | "sse" | "stdio";

/** Auth the operator configured for the target (secrets are never persisted in the
 *  scan blob — only the shape, so the report can say "OAuth" without holding a key). */
export interface TargetAuthShape {
  kind: "none" | "bearer" | "oauth_client_credentials" | "header";
  /** For display only: e.g. "Authorization: Bearer ***" or the token URL host. */
  detail?: string;
}

/** A single tool as discovered, plus the engine's classification of it. */
export interface ToolRecord {
  name: string;
  description: string;
  /** Raw JSON schema of the arguments, as declared by the server. */
  inputSchema?: unknown;
  hasOutputSchema: boolean;
  /** Engine classification (from name/description/schema). */
  action: "read" | "write" | "destructive" | "outward" | "execute" | "unknown";
  /** Data classes the tool can plausibly touch (pii, financial, credentials, …). */
  dataClasses: string[];
  /** True if the description contains instruction-like text (possible poisoning). */
  injectionSuspected: boolean;
}

/** What we learned about the vendor/company behind the server. */
export interface VendorResearch {
  companyName?: string;
  whatItDoes?: string;
  /** Primary product/API this server fronts. */
  productContext?: string;
  headquarters?: string;
  knownIncidents?: string;
  complianceEvidence?: string;
  /** Free-text notes, and the sources the model used (URLs/claims). */
  notes?: string;
  sources?: string[];
  /** True when research is model-knowledge only (no live web fetch). */
  fromModelKnowledge: boolean;
}

/** One dynamic probe the engine generated for this specific server. Probes are
 *  prompts an agent (or a human) runs against the live server to confirm a
 *  hypothesis. Read-only probes may be executed automatically; anything that could
 *  change state is generated as a recommendation only and never auto-run. */
export interface DynamicProbe {
  id: string;
  dimension: DimensionId;
  hypothesis: string;
  /** The prompt/tool-call the probe would run. */
  prompt: string;
  targetTool?: string;
  /** Safe to auto-execute (read-only, non-mutating) vs. review-only. */
  safety: "read_only" | "review_only";
  /** Result if executed, else null. */
  executed: boolean;
  observation?: string;
  outcome?: ControlOutcome;
}

/** Evaluation of one static or org-custom control. */
export interface ControlResult {
  controlId: string;
  /** True when this came from an org AuditClause rather than the static set. */
  custom: boolean;
  title: string;
  dimension: DimensionId;
  outcome: ControlOutcome;
  rationale: string;
  evidence?: string;
}

/** A finding: something worth flagging, mapped to a dimension and severity. */
export interface Finding {
  id: string;
  dimension: DimensionId;
  severity: RiskSeverity;
  title: string;
  detail: string;
  /** What the integrator should do about it. */
  recommendation?: string;
  /** Tool names / probe ids / control ids that evidence this finding. */
  evidence: string[];
}

/** Per-dimension score with its supporting narrative. */
export interface DimensionScore {
  dimension: DimensionId;
  score: number; // 0–100, higher = more risk
  severity: RiskSeverity;
  summary: string;
  /** Safe / unsafe factors specific to this dimension. */
  safeFactors: string[];
  unsafeFactors: string[];
}

/** The full scorecard — the standardized report structure. */
export interface Scorecard {
  schemaVersion: string;
  overallScore: number; // 0–100 risk
  grade: "A" | "B" | "C" | "D" | "F";
  headline: string;
  /** One-paragraph executive summary. */
  executiveSummary: string;
  /** How the server is typically used. */
  typicalUse: string;
  /** The security + threat model, written for the integrator's intended use. */
  securityModel: string;
  threatModel: string;
  /** What to audit / pay attention to / look for — actionable guidance. */
  whatToAudit: string[];
  whatToWatch: string[];
  dimensions: DimensionScore[];
  findings: Finding[];
  /** The integration points the operator described, each with tailored analysis. */
  integrationAnalysis: IntegrationAnalysis[];
}

/** Analysis tailored to one integration point the operator described. */
export interface IntegrationAnalysis {
  description: string;
  likelyDataTypes: string[];
  interactionPattern: string;
  keyRisks: string[];
  recommendation: string;
}

/** The complete persisted result set for a scan (mirrors the JSON columns). */
export interface ScanResultBundle {
  tools: ToolRecord[];
  research: VendorResearch;
  probes: DynamicProbe[];
  controls: ControlResult[];
  scorecard: Scorecard;
}

export interface ScanLogEntry {
  at: string;
  phase: string;
  detail: string;
}
