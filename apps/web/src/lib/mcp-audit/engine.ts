// The audit engine. Given a persisted McpAuditScan row, it runs the pipeline that
// turns an opaque MCP server into a standardized risk scorecard:
//
//   1. inspect   — read-only MCP handshake, enumerate tools/resources/prompts.
//   2. classify  — deterministic action/data-class/injection classification.
//   3. research  — the model researches the vendor/company behind the server,
//                  using the operator's intended-use context.
//   4. probe     — the model generates *dynamic*, server-specific probes (fuzzing
//                  hypotheses). Read-only probes are executed live; anything that
//                  could change state is recorded as review-only, never auto-run.
//   5. controls  — evaluate the static controls + the org's custom clauses.
//   6. score     — the model synthesizes the scorecard across the risk taxonomy,
//                  tailored to each integration point the operator described.
//   7. evidence  — package raw evidence and (optionally) attest it via Corsair.
//
// The engine runs detached from the request that starts it (mirroring the AI
// migration flow) and persists progress to the row after each phase, so the UI can
// poll. Every phase degrades rather than aborts: a failed research step still
// yields a scorecard, just a less informed one.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { classifyTool, isAutoProbeSafe } from "./classify";
import { STATIC_CONTROLS } from "./controls";
import { attestWithCorsair, buildEvidenceBundle } from "./corsair";
import { completeJson, type LlmConfig } from "./llm";
import { callReadOnlyTool, inspectServer, type InspectAuth } from "./mcp-inspect";
import { controlsForOrg, decodeTargetAuth, llmConfigForScan } from "./store";
import {
  RISK_DIMENSIONS,
  scoreToGrade,
  scoreToSeverity,
  type DimensionId,
} from "./taxonomy";
import {
  SCAN_SCHEMA_VERSION,
  type ControlResult,
  type DimensionScore,
  type DynamicProbe,
  type Finding,
  type IntegrationAnalysis,
  type Scorecard,
  type ScanLogEntry,
  type ToolRecord,
  type VendorResearch,
} from "./types";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function readLog(id: string): Promise<ScanLogEntry[]> {
  const row = await db.mcpAuditScan.findUnique({ where: { id }, select: { log: true } });
  return Array.isArray(row?.log) ? (row!.log as unknown as ScanLogEntry[]) : [];
}

async function persist(id: string, data: Prisma.McpAuditScanUpdateInput) {
  await db.mcpAuditScan.update({ where: { id }, data });
}

async function step(id: string, log: ScanLogEntry[], phase: string, detail: string) {
  log.push({ at: new Date().toISOString(), phase, detail });
  await persist(id, { log: log as unknown as Prisma.InputJsonValue });
}

async function setStatus(
  id: string,
  log: ScanLogEntry[],
  status: string,
  detail: string,
) {
  log.push({ at: new Date().toISOString(), phase: status, detail });
  await persist(id, { status, statusDetail: detail, log: log as unknown as Prisma.InputJsonValue });
}

// ---------------------------------------------------------------------------
// Phase 3 — vendor research
// ---------------------------------------------------------------------------

async function researchVendor(
  cfg: LlmConfig,
  input: { target: string; serverName?: string; tools: ToolRecord[]; intendedUse: string },
): Promise<VendorResearch> {
  const toolSummary = input.tools
    .map((t) => `- ${t.name} [${t.action}]: ${t.description.slice(0, 160)}`)
    .join("\n");
  const system =
    "You are a third-party risk analyst researching the company behind an MCP (Model Context " +
    "Protocol) server, to inform a security audit. Use what you know about this vendor and its " +
    "product. Be specific and factual; if you are not sure, say so rather than inventing details.";
  const user =
    `MCP server endpoint: ${input.target}\n` +
    (input.serverName ? `Server identifies as: ${input.serverName}\n` : "") +
    `Intended use by the integrator: ${input.intendedUse || "(not specified)"}\n\n` +
    `Tools it exposes:\n${toolSummary}\n\n` +
    "Return a JSON object with keys: companyName, whatItDoes, productContext (the primary product/API " +
    "this server fronts), headquarters, knownIncidents (any notable public security/privacy incidents, " +
    'or "none known"), complianceEvidence (known certifications/trust posture), notes, sources (array of ' +
    "the claims/URLs you are drawing on). Keep each string concise.";
  try {
    const parsed = await completeJson<Partial<VendorResearch>>(cfg, { system, user, maxTokens: 1500 });
    return { ...parsed, fromModelKnowledge: true } as VendorResearch;
  } catch (e) {
    return { notes: `Research unavailable: ${errMsg(e)}`, fromModelKnowledge: true };
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — dynamic probe generation + safe execution
// ---------------------------------------------------------------------------

async function generateProbes(
  cfg: LlmConfig,
  input: { tools: ToolRecord[]; research: VendorResearch; intendedUse: string },
): Promise<DynamicProbe[]> {
  const toolSummary = input.tools
    .map(
      (t) =>
        `- ${t.name} [${t.action}${t.injectionSuspected ? ", injection?" : ""}] data:{${t.dataClasses.join(",")}}: ${t.description.slice(0, 200)}`,
    )
    .join("\n");
  const system =
    "You are an MCP security auditor generating DYNAMIC probes for one specific server. Every server " +
    "differs, so tailor probes to THIS tool surface and vendor — do not emit generic checks. A probe is " +
    "a concrete hypothesis plus the exact prompt/tool-call that would confirm it. Mark each probe's " +
    'safety: "read_only" ONLY if running it cannot change state, send anything, or affect data; use ' +
    '"review_only" for anything that writes, sends, deletes, pays, or is destructive — those are ' +
    "recommendations for a human to run under their own authorization, never executed automatically.";
  const user =
    `Vendor: ${input.research.companyName ?? "unknown"} — ${input.research.whatItDoes ?? ""}\n` +
    `Intended integrator use: ${input.intendedUse || "(not specified)"}\n\n` +
    `Tools:\n${toolSummary}\n\n` +
    "Generate 6–12 probes that would most reduce uncertainty about this server's risk. Return a JSON " +
    "array; each item: { dimension (one of: " +
    RISK_DIMENSIONS.map((d) => d.id).join(", ") +
    "), hypothesis, prompt, targetTool (a tool name or null), safety (read_only|review_only) }.";
  try {
    const parsed = await completeJson<
      Array<{
        dimension: string;
        hypothesis: string;
        prompt: string;
        targetTool?: string | null;
        safety?: string;
      }>
    >(cfg, { system, user, maxTokens: 3000 });
    return parsed.slice(0, 14).map((p, i) => ({
      id: `probe_${i + 1}`,
      dimension: (RISK_DIMENSIONS.find((d) => d.id === p.dimension)?.id ?? "operational") as DimensionId,
      hypothesis: String(p.hypothesis ?? ""),
      prompt: String(p.prompt ?? ""),
      targetTool: p.targetTool ?? undefined,
      safety: p.safety === "read_only" ? "read_only" : "review_only",
      executed: false,
    }));
  } catch {
    return [];
  }
}

/** Execute only the read-only probes whose target tool the heuristic also deems
 *  read-only. Double gate: both the model AND the heuristic must agree. */
async function executeSafeProbes(
  target: string,
  auth: InspectAuth,
  tools: ToolRecord[],
  probes: DynamicProbe[],
): Promise<DynamicProbe[]> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const out: DynamicProbe[] = [];
  for (const probe of probes) {
    const tool = probe.targetTool ? byName.get(probe.targetTool) : undefined;
    const safe = probe.safety === "read_only" && tool && isAutoProbeSafe(tool);
    if (!safe || !tool) {
      out.push(probe);
      continue;
    }
    // Call with empty args first; the goal is to confirm the tool exists, is
    // reachable, and what shape it returns — not to enumerate data.
    const res = await callReadOnlyTool(target, auth, tool.name, {});
    out.push({
      ...probe,
      executed: true,
      observation: res.ok
        ? `Reachable. isError=${res.isError}. Sample: ${res.text.slice(0, 400)}`
        : `Call failed: ${res.text.slice(0, 200)}`,
      outcome: res.ok && !res.isError ? "pass" : "needs_review",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 5 — control evaluation
// ---------------------------------------------------------------------------

async function evaluateControls(
  cfg: LlmConfig,
  input: {
    tools: ToolRecord[];
    research: VendorResearch;
    probes: DynamicProbe[];
    orgId: string;
  },
): Promise<ControlResult[]> {
  const { clauses } = await controlsForOrg(input.orgId);
  const controlList = [
    ...STATIC_CONTROLS.map((c) => ({
      id: c.id,
      custom: false,
      dimension: c.dimension,
      title: c.title,
      intent: c.intent,
    })),
    ...clauses.map((c) => ({
      id: c.id,
      custom: true,
      dimension: c.dimension,
      title: c.title,
      intent: c.intent,
    })),
  ];
  const toolSummary = input.tools
    .map((t) => `- ${t.name} [${t.action}] schema:${t.hasOutputSchema ? "yes" : "no"} inj:${t.injectionSuspected}`)
    .join("\n");
  const system =
    "You evaluate specific controls against an MCP server. For each control return an outcome of " +
    '"pass", "fail", "needs_review", or "not_applicable" with a one-sentence rationale grounded in the ' +
    "evidence. Prefer needs_review over guessing when the evidence is silent.";
  const user =
    `Tools:\n${toolSummary}\n\n` +
    `Vendor: ${JSON.stringify(input.research).slice(0, 1200)}\n\n` +
    `Probe observations: ${input.probes
      .filter((p) => p.executed)
      .map((p) => p.observation)
      .join(" | ")
      .slice(0, 800)}\n\n` +
    `Controls:\n${controlList.map((c) => `[${c.id}] ${c.title}: ${c.intent}`).join("\n")}\n\n` +
    'Return a JSON array of { controlId, outcome, rationale, evidence }.';
  try {
    const parsed = await completeJson<
      Array<{ controlId: string; outcome: string; rationale: string; evidence?: string }>
    >(cfg, { system, user, maxTokens: 3500 });
    const byId = new Map(controlList.map((c) => [c.id, c]));
    return parsed
      .filter((r) => byId.has(r.controlId))
      .map((r) => {
        const c = byId.get(r.controlId)!;
        const outcome = (["pass", "fail", "needs_review", "not_applicable"].includes(r.outcome)
          ? r.outcome
          : "needs_review") as ControlResult["outcome"];
        return {
          controlId: c.id,
          custom: c.custom,
          title: c.title,
          dimension: c.dimension as DimensionId,
          outcome,
          rationale: String(r.rationale ?? ""),
          evidence: r.evidence,
        };
      });
  } catch {
    // Degrade: mark everything needs_review so the scan still completes.
    return controlList.map((c) => ({
      controlId: c.id,
      custom: c.custom,
      title: c.title,
      dimension: c.dimension as DimensionId,
      outcome: "needs_review" as const,
      rationale: "Control evaluation unavailable.",
    }));
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — scorecard synthesis
// ---------------------------------------------------------------------------

async function synthesizeScorecard(
  cfg: LlmConfig,
  input: {
    target: string;
    tools: ToolRecord[];
    research: VendorResearch;
    probes: DynamicProbe[];
    controls: ControlResult[];
    intendedUse: string;
    integrationPoints: string[];
  },
): Promise<Scorecard> {
  const dimensionRef = RISK_DIMENSIONS.map(
    (d) => `- ${d.id} (${d.name}): ${d.summary} Scoring: ${d.scoringGuidance}`,
  ).join("\n");
  const system =
    "You are the lead auditor writing a standardized MCP risk scorecard. Score each risk dimension 0–100 " +
    "where HIGHER MEANS MORE RISK. Ground every score in the tools, probes, controls, and research " +
    "provided. Write for an integrator deciding whether to wire this server into the described use. Be " +
    "concrete about how the server is safe AND unsafe; do not inflate or downplay. Tailor the " +
    "integration analysis to the data likely present in each described integration point.";
  const user =
    `Server: ${input.target}\n` +
    `Intended use: ${input.intendedUse || "(not specified)"}\n` +
    `Integration points described by the operator:\n${
      input.integrationPoints.length
        ? input.integrationPoints.map((p, i) => `  ${i + 1}. ${p}`).join("\n")
        : "  (none described)"
    }\n\n` +
    `Risk dimensions to score:\n${dimensionRef}\n\n` +
    `Tools (${input.tools.length}):\n${input.tools
      .map((t) => `- ${t.name} [${t.action}] data:{${t.dataClasses.join(",")}} inj:${t.injectionSuspected}: ${t.description.slice(0, 160)}`)
      .join("\n")}\n\n` +
    `Vendor research: ${JSON.stringify(input.research).slice(0, 1500)}\n\n` +
    `Control outcomes: ${input.controls.map((c) => `${c.controlId}=${c.outcome}`).join(", ")}\n\n` +
    `Executed probe observations: ${input.probes
      .filter((p) => p.executed)
      .map((p) => `${p.targetTool}: ${p.observation}`)
      .join(" | ")
      .slice(0, 1000)}\n\n` +
    "Return a JSON object: { headline, executiveSummary, typicalUse, securityModel, threatModel, " +
    "whatToAudit (string[]), whatToWatch (string[]), dimensions (array of { dimension, score, summary, " +
    "safeFactors (string[]), unsafeFactors (string[]) }), findings (array of { dimension, severity " +
    "(info|low|medium|high|critical), title, detail, recommendation, evidence (string[]) }), " +
    "integrationAnalysis (array of { description, likelyDataTypes (string[]), interactionPattern, " +
    "keyRisks (string[]), recommendation }) }. Include one dimensions entry per risk dimension id.";

  let parsed: Partial<Scorecard> & { dimensions?: Array<Partial<DimensionScore>> };
  try {
    parsed = await completeJson(cfg, { system, user, maxTokens: 6000 });
  } catch (e) {
    // Fall back to a control-derived scorecard so the scan still produces output.
    return controlDerivedScorecard(input, `Model synthesis unavailable: ${errMsg(e)}`);
  }

  const dimensions: DimensionScore[] = RISK_DIMENSIONS.map((d) => {
    const m = (parsed.dimensions ?? []).find((x) => x.dimension === d.id);
    const score = clampScore(m?.score);
    return {
      dimension: d.id as DimensionId,
      score,
      severity: scoreToSeverity(score),
      summary: m?.summary ?? "Not assessed.",
      safeFactors: (m?.safeFactors as string[]) ?? [],
      unsafeFactors: (m?.unsafeFactors as string[]) ?? [],
    };
  });

  const overall = weightedOverall(dimensions);
  const findings: Finding[] = ((parsed.findings as Finding[]) ?? []).map((f, i) => ({
    id: `finding_${i + 1}`,
    dimension: (RISK_DIMENSIONS.find((d) => d.id === f.dimension)?.id ?? "operational") as DimensionId,
    severity: ["info", "low", "medium", "high", "critical"].includes(f.severity) ? f.severity : "medium",
    title: f.title ?? "Finding",
    detail: f.detail ?? "",
    recommendation: f.recommendation,
    evidence: Array.isArray(f.evidence) ? f.evidence : [],
  }));

  const integrationAnalysis: IntegrationAnalysis[] = (
    (parsed.integrationAnalysis as IntegrationAnalysis[]) ?? []
  ).map((a) => ({
    description: a.description ?? "",
    likelyDataTypes: Array.isArray(a.likelyDataTypes) ? a.likelyDataTypes : [],
    interactionPattern: a.interactionPattern ?? "",
    keyRisks: Array.isArray(a.keyRisks) ? a.keyRisks : [],
    recommendation: a.recommendation ?? "",
  }));

  return {
    schemaVersion: SCAN_SCHEMA_VERSION,
    overallScore: overall,
    grade: scoreToGrade(overall),
    headline: parsed.headline ?? "MCP server risk scorecard",
    executiveSummary: parsed.executiveSummary ?? "",
    typicalUse: parsed.typicalUse ?? "",
    securityModel: parsed.securityModel ?? "",
    threatModel: parsed.threatModel ?? "",
    whatToAudit: (parsed.whatToAudit as string[]) ?? [],
    whatToWatch: (parsed.whatToWatch as string[]) ?? [],
    dimensions,
    findings,
    integrationAnalysis,
  };
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(v)) return 40;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Overall risk = capability-weighted mean; autonomy/data/liability count double
 *  because they dominate real-world MCP integration risk. */
function weightedOverall(dims: DimensionScore[]): number {
  const heavy = new Set(["autonomy", "data", "liability", "security_posture"]);
  let sum = 0;
  let w = 0;
  for (const d of dims) {
    const weight = heavy.has(d.dimension) ? 2 : 1;
    sum += d.score * weight;
    w += weight;
  }
  return w ? Math.round(sum / w) : 0;
}

/** A minimal scorecard derived purely from control outcomes, used when the model
 *  synthesis step is unavailable so a scan never dead-ends. */
function controlDerivedScorecard(
  input: { controls: ControlResult[]; integrationPoints: string[] },
  note: string,
): Scorecard {
  const dimensions: DimensionScore[] = RISK_DIMENSIONS.map((d) => {
    const rel = input.controls.filter((c) => c.dimension === d.id);
    const failed = rel.filter((c) => c.outcome === "fail").length;
    const review = rel.filter((c) => c.outcome === "needs_review").length;
    const score = rel.length ? clampScore((failed * 80 + review * 45) / rel.length) : 40;
    return {
      dimension: d.id as DimensionId,
      score,
      severity: scoreToSeverity(score),
      summary: `${failed} failed / ${review} to review of ${rel.length} controls.`,
      safeFactors: [],
      unsafeFactors: [],
    };
  });
  const overall = weightedOverall(dimensions);
  return {
    schemaVersion: SCAN_SCHEMA_VERSION,
    overallScore: overall,
    grade: scoreToGrade(overall),
    headline: "MCP server risk scorecard (control-derived)",
    executiveSummary: note,
    typicalUse: "",
    securityModel: "",
    threatModel: "",
    whatToAudit: [],
    whatToWatch: [],
    dimensions,
    findings: [],
    integrationAnalysis: input.integrationPoints.map((p) => ({
      description: p,
      likelyDataTypes: [],
      interactionPattern: "",
      keyRisks: [],
      recommendation: "",
    })),
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runScan(scanId: string): Promise<void> {
  const scan = await db.mcpAuditScan.findUnique({ where: { id: scanId } });
  if (!scan) return;
  const log = await readLog(scanId);

  const cfg = await llmConfigForScan(scan);
  if (!cfg) {
    await setStatus(
      scanId,
      log,
      "failed",
      "No LLM credential for this scan's provider. Add one under Model credentials and retry.",
    );
    return;
  }

  const intendedUse = scan.intendedUse ?? "";
  const integrationPoints = Array.isArray(scan.integrationPoints)
    ? (scan.integrationPoints as unknown as string[])
    : [];

  try {
    // --- Phase 1: inspect ---
    await setStatus(scanId, log, "inspecting", "Handshaking with the MCP server and enumerating tools…");
    const auth = decodeTargetAuth(scan.authSecretEnc) as InspectAuth;
    const inspected = await inspectServer(scan.targetUrl, auth);
    if (!inspected.ok) {
      await setStatus(scanId, log, "failed", `Could not inspect the server: ${inspected.error}`);
      return;
    }
    const tools: ToolRecord[] = inspected.tools.map(classifyTool);
    await persist(scanId, { toolInventory: tools as unknown as Prisma.InputJsonValue });
    await step(
      scanId,
      log,
      "inspecting",
      `Found ${tools.length} tool(s), ${inspected.resources.length} resource(s), ${inspected.prompts.length} prompt(s).`,
    );

    // --- Phase 3: research ---
    await setStatus(scanId, log, "researching", "Researching the vendor behind the server…");
    const research = await researchVendor(cfg, {
      target: scan.targetUrl,
      serverName: inspected.serverInfo?.name,
      tools,
      intendedUse,
    });
    await persist(scanId, { research: research as unknown as Prisma.InputJsonValue });
    await step(scanId, log, "researching", research.companyName ? `Identified vendor: ${research.companyName}.` : "Vendor research complete.");

    // --- Phase 4: probe ---
    await setStatus(scanId, log, "probing", "Generating dynamic probes and running read-only checks…");
    const generated = await generateProbes(cfg, { tools, research, intendedUse });
    const probes = await executeSafeProbes(scan.targetUrl, auth, tools, generated);
    await persist(scanId, { probes: probes as unknown as Prisma.InputJsonValue });
    const ran = probes.filter((p) => p.executed).length;
    await step(scanId, log, "probing", `Generated ${probes.length} probe(s); ran ${ran} read-only, ${probes.length - ran} flagged review-only.`);

    // --- Phase 5: controls ---
    await setStatus(scanId, log, "scoring", "Evaluating controls and clauses…");
    const controls = await evaluateControls(cfg, { tools, research, probes, orgId: scan.orgId });
    await persist(scanId, { controls: controls as unknown as Prisma.InputJsonValue });
    const failed = controls.filter((c) => c.outcome === "fail").length;
    await step(scanId, log, "scoring", `Evaluated ${controls.length} control(s); ${failed} failed.`);

    // --- Phase 6: scorecard ---
    const scorecard = await synthesizeScorecard(cfg, {
      target: scan.targetUrl,
      tools,
      research,
      probes,
      controls,
      intendedUse,
      integrationPoints,
    });

    // --- Phase 7: evidence + Corsair ---
    const bundle = buildEvidenceBundle({
      target: scan.targetUrl,
      transport: scan.transport,
      serverInfo: inspected.serverInfo,
      protocolVersion: inspected.protocolVersion,
      tools,
      probes,
    });
    const attestation = await attestWithCorsair(bundle);

    await persist(scanId, {
      scorecard: scorecard as unknown as Prisma.InputJsonValue,
      evidence: { bundle, attestation } as unknown as Prisma.InputJsonValue,
      overallScore: scorecard.overallScore,
      grade: scorecard.grade,
    });
    await setStatus(
      scanId,
      log,
      "completed",
      `Scan complete. Overall risk ${scorecard.overallScore}/100 (grade ${scorecard.grade}).`,
    );
  } catch (e) {
    await setStatus(scanId, log, "failed", `Scan failed: ${errMsg(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Interrogation — the MCP interaction layer asks a follow-up against a completed
// scan, optionally generating fresh dynamic probes for direct re-inspection.
// ---------------------------------------------------------------------------

export interface InterrogationTurn {
  at: string;
  question: string;
  answer: string;
  newProbes?: DynamicProbe[];
}

export async function interrogateScan(
  scanId: string,
  question: string,
): Promise<InterrogationTurn> {
  const scan = await db.mcpAuditScan.findUnique({ where: { id: scanId } });
  if (!scan) throw new Error("NOT_FOUND");
  const cfg = await llmConfigForScan(scan);
  if (!cfg) throw new Error("No LLM credential configured for this scan's provider.");

  const tools = (scan.toolInventory as unknown as ToolRecord[]) ?? [];
  const scorecard = (scan.scorecard as unknown as Scorecard) ?? null;
  const research = (scan.research as unknown as VendorResearch) ?? null;

  const system =
    "You are the TrustMCP audit assistant answering a follow-up question about a completed MCP audit. " +
    "Answer from the scan evidence. If confirming the answer would require running the live server, " +
    "propose fresh dynamic probes (never claim to have run them).";
  const user =
    `Question: ${question}\n\n` +
    `Server: ${scan.targetUrl}\n` +
    `Scorecard: ${JSON.stringify(scorecard).slice(0, 3000)}\n` +
    `Tools: ${tools.map((t) => `${t.name}[${t.action}]`).join(", ")}\n` +
    `Research: ${JSON.stringify(research).slice(0, 800)}\n\n` +
    'Return JSON: { answer, newProbes (array of { dimension, hypothesis, prompt, targetTool, safety }) }.';
  const parsed = await completeJson<{
    answer: string;
    newProbes?: Array<{ dimension: string; hypothesis: string; prompt: string; targetTool?: string; safety?: string }>;
  }>(cfg, { system, user, maxTokens: 2500 });

  const newProbes: DynamicProbe[] = (parsed.newProbes ?? []).map((p, i) => ({
    id: `iprobe_${Date.now()}_${i}`,
    dimension: (RISK_DIMENSIONS.find((d) => d.id === p.dimension)?.id ?? "operational") as DimensionId,
    hypothesis: p.hypothesis,
    prompt: p.prompt,
    targetTool: p.targetTool ?? undefined,
    safety: p.safety === "read_only" ? "read_only" : "review_only",
    executed: false,
  }));

  const turn: InterrogationTurn = {
    at: new Date().toISOString(),
    question,
    answer: parsed.answer ?? "",
    newProbes: newProbes.length ? newProbes : undefined,
  };

  const prior = Array.isArray(scan.interactions)
    ? (scan.interactions as unknown as InterrogationTurn[])
    : [];
  await persist(scanId, {
    interactions: [...prior, turn] as unknown as Prisma.InputJsonValue,
  });
  return turn;
}
