// The MCP risk taxonomy — the shared nomenclature every audit scores against.
//
// APIs are self-describing: a customer knows the fields, formats, and schemas a
// REST/GraphQL integration exchanges before wiring it in. MCP servers are not.
// A tool description is prose, the data an agent chooses to pass is unbounded, and
// the server can act on the caller's behalf against real systems. This taxonomy is
// how TrustMCP turns that open surface into something an integrator can reason
// about: a fixed set of risk *dimensions*, each scored 0–100 (higher = more risk)
// with a rationale, so a scorecard is comparable across servers even though the
// findings behind it are always server-specific.
//
// The dimensions are deliberately broad — they cover not just "is this server
// secure" but "what does integrating it expose me to": operational, data, privacy,
// financial, compliance, reputational, and liability exposure, plus the two
// dimensions unique to agent tooling (autonomy and supply chain). The audit engine
// (engine.ts) maps concrete findings onto these dimensions; the report groups by
// them; the MCP interaction layer lets a consumer interrogate a single dimension.

export type RiskSeverity = "info" | "low" | "medium" | "high" | "critical";

/** Ordered so a numeric score bucket always resolves to one band. */
export const SEVERITY_ORDER: RiskSeverity[] = ["info", "low", "medium", "high", "critical"];

export interface RiskDimension {
  /** Stable machine id — findings, scores, and clauses reference this. */
  id: string;
  /** Short display name. */
  name: string;
  /** One-liner shown under the name on the scorecard. */
  summary: string;
  /** What this dimension is actually asking, in plain terms. */
  description: string;
  /** The concrete questions an auditor answers to score this dimension. */
  auditQuestions: string[];
  /** Observable signals (in tools, docs, or research) that raise the score. */
  riskSignals: string[];
  /** How to read a score in this dimension (anchors for the 0–100 scale). */
  scoringGuidance: string;
  /** Whether this dimension is dominated by what the server *can do* vs. what it
   *  *holds*. Used to weight servers that are read-only vs. action-taking. */
  emphasis: "capability" | "data" | "both";
}

// The twelve dimensions. Order is the order they render in the scorecard.
export const RISK_DIMENSIONS: RiskDimension[] = [
  {
    id: "data",
    name: "Data exposure",
    summary: "What data classes flow through the server, and how sensitive they are.",
    description:
      "The types and sensitivity of data an agent can read or write through this server: " +
      "the specific fields, records, and objects the tools expose. Because MCP arguments are " +
      "unbounded prose, this dimension estimates the *widest* data an integration could exchange, " +
      "not just the happy path — a 'search' tool that returns full records is a broad data surface " +
      "even if a caller only wanted one field.",
    auditQuestions: [
      "Which data classes (PII, credentials, financial, health, source code, internal docs) can tool outputs contain?",
      "Do any tools return whole records/objects rather than the specific fields requested?",
      "Can free-text arguments cause the server to exfiltrate or forward data to a third party?",
      "Is there any field-level scoping, redaction, or output schema, or is the response shape open-ended?",
    ],
    riskSignals: [
      "search/list/export tools that return full objects",
      "tools that read file contents, emails, messages, or database rows",
      "arguments that accept arbitrary queries, URLs, or destinations",
      "no declared output schema (structuredContent absent)",
    ],
    scoringGuidance:
      "0–20: read-only metadata or clearly non-sensitive data. 30–50: business data, no special " +
      "categories. 60–80: PII, credentials, or financial/customer records exposed. 85–100: special-" +
      "category data (health, biometric, gov-id) or unrestricted read of arbitrary records.",
    emphasis: "data",
  },
  {
    id: "privacy",
    name: "Privacy & personal data",
    summary: "Personal-data processing, data-subject exposure, and cross-border flow.",
    description:
      "Whether integrating this server causes personal data to be processed, whose data it is " +
      "(employees, customers, or the customers' end users — third parties who never consented to " +
      "this integration), and where it goes. End-user data is the highest-stakes case: the " +
      "integrator becomes a processor/controller for people who are not their user.",
    auditQuestions: [
      "Does the server process personal data of end users (not just the operator)?",
      "Are there onward transfers to subprocessors or other regions?",
      "Is there a lawful basis / DPA path, or does the integration create an unpapered processing relationship?",
      "Can the tools be used to profile, track, or re-identify individuals?",
    ],
    riskSignals: [
      "tools acting on contacts, customers, patients, or end-user records",
      "email/calendar/messaging access spanning multiple people",
      "location, device, or behavioral data",
      "no stated data residency or retention",
    ],
    scoringGuidance:
      "0–20: no personal data. 30–50: operator's own personal data only. 60–80: end-user personal " +
      "data at scale. 85–100: special-category or children's data, or profiling with no consent path.",
    emphasis: "data",
  },
  {
    id: "autonomy",
    name: "Agency & autonomy",
    summary: "How much the server can *do* — write, send, pay, delete — not just read.",
    description:
      "The defining MCP risk. Unlike a documented API a developer wires up deliberately, an agent " +
      "chooses which MCP tools to call and with what arguments. This dimension measures the blast " +
      "radius of the most powerful tool: state-changing, irreversible, or outward-facing actions the " +
      "agent can trigger — sending messages, moving money, deleting records, granting access.",
    auditQuestions: [
      "Which tools change state, and which of those are irreversible (delete, send, pay, publish)?",
      "Can the server take outward-facing actions (email, post, message a third party) on the operator's behalf?",
      "Are destructive actions gated by confirmation, scopes, or dry-run modes, or immediate?",
      "Could a prompt-injected instruction in returned content cause the agent to call a dangerous tool?",
    ],
    riskSignals: [
      "send/create/update/delete/execute/pay/transfer tools",
      "tools that post publicly or message external parties",
      "shell/code-execution, admin, or permission-granting tools",
      "no confirmation or scoping on destructive actions",
    ],
    scoringGuidance:
      "0–20: read-only. 30–50: reversible writes to the operator's own workspace. 60–80: outward-" +
      "facing or hard-to-reverse actions. 85–100: irreversible/financial/destructive actions with no gating.",
    emphasis: "capability",
  },
  {
    id: "operational",
    name: "Operational reliability",
    summary: "Availability, maturity, and how the integration behaves under failure.",
    description:
      "Whether this server can be depended on in a workflow: uptime and SLA posture, transport and " +
      "protocol maturity, error handling, rate limits, and versioning. An agent that silently gets a " +
      "wrong or empty answer is an operational risk even when nothing is 'insecure'.",
    auditQuestions: [
      "Is there a stated SLA, status page, or uptime history?",
      "Does the server version its protocol and tools, or can behavior change silently?",
      "How does it fail — clear errors, or ambiguous/empty results an agent may misread?",
      "Are there rate limits or quotas that will throttle an integrated workflow?",
    ],
    riskSignals: [
      "no versioning or changelog",
      "unstable/beta transport, frequent breaking changes",
      "errors returned as ambiguous text rather than isError",
      "single-region, single-tenant, or hobby-grade hosting",
    ],
    scoringGuidance:
      "0–20: mature, versioned, SLA-backed. 30–50: production but thinly documented. 60–80: beta, " +
      "no SLA, breaking changes. 85–100: unversioned, unmaintained, or no failure semantics.",
    emphasis: "capability",
  },
  {
    id: "criticality",
    name: "Business criticality",
    summary: "How central the integrated workflow is, and the cost if it misbehaves.",
    description:
      "The dependency the integrator takes on. A server wired into a revenue, customer-facing, or " +
      "safety-relevant workflow carries risk out of proportion to its technical surface: the same " +
      "server is low-stakes in a scratch project and high-stakes in a system of record. Scored " +
      "against the intended-use context the integrator provides.",
    auditQuestions: [
      "Is the integrated workflow revenue-generating, customer-facing, or safety-relevant?",
      "Is the server a system of record, or is its output advisory/replaceable?",
      "What is the cost of a wrong action or a wrong answer in this context?",
      "How hard is it to switch off or replace this server if it fails?",
    ],
    riskSignals: [
      "intended use in production customer workflows",
      "server is the authoritative source for a decision",
      "tight coupling with no fallback",
      "actions that touch money, contracts, or compliance records",
    ],
    scoringGuidance:
      "0–20: experimentation/internal-only. 30–50: internal operational workflow. 60–80: customer-" +
      "facing or revenue-linked. 85–100: system of record for money, safety, or legal obligations.",
    emphasis: "both",
  },
  {
    id: "financial",
    name: "Financial exposure",
    summary: "Direct monetary risk: payments, spend, fraud, and cost blow-ups.",
    description:
      "Whether the server can move or commit money, incur metered cost, or enable fraud. Includes " +
      "both intended financial actions (payments, refunds, purchasing) and the runaway-cost failure " +
      "mode of an agent calling a metered tool in a loop.",
    auditQuestions: [
      "Can any tool move money, issue refunds, place orders, or commit spend?",
      "Are there per-transaction or aggregate limits the operator controls?",
      "Could a compromised or looping agent run up metered cost or fraudulent charges?",
      "Is there an audit trail for financial actions?",
    ],
    riskSignals: [
      "payment, invoice, payout, order, or subscription tools",
      "no transaction limits or approval step",
      "metered/per-call pricing with no ceiling",
      "no audit log of money-moving actions",
    ],
    scoringGuidance:
      "0: no financial surface. 30–50: metered cost only. 60–80: can commit spend within limits. " +
      "85–100: can move arbitrary money or issue payouts with no cap or approval.",
    emphasis: "capability",
  },
  {
    id: "compliance",
    name: "Compliance & regulatory",
    summary: "Regulated data and the obligations the integration triggers.",
    description:
      "Whether wiring in this server pulls the integrator into a regulatory regime — GDPR/CCPA " +
      "(personal data), HIPAA (health), PCI-DSS (cardholder), SOX (financial reporting), GLBA, or " +
      "sector rules — and whether the server's own posture (certifications, DPA, residency) supports " +
      "meeting those obligations.",
    auditQuestions: [
      "What regulated data classes does the server touch (health, cardholder, financial, biometric)?",
      "Does the vendor hold relevant certifications (SOC 2, ISO 27001, HIPAA, PCI) with current evidence?",
      "Is a DPA / BAA available, and are subprocessors and residency disclosed?",
      "Does the integration create record-keeping or notification duties the operator must own?",
    ],
    riskSignals: [
      "health, cardholder, or financial-reporting data",
      "no published compliance evidence or trust center",
      "subprocessors or residency undisclosed",
      "regulated action (e-sign, KYC, health record) with no attestations",
    ],
    scoringGuidance:
      "0–20: no regulated data, evidence published. 30–50: personal data with DPA available. 60–80: " +
      "regulated data with thin/expired evidence. 85–100: regulated data, no certifications, no DPA.",
    emphasis: "both",
  },
  {
    id: "security_posture",
    name: "Security posture",
    summary: "Auth, transport, tenancy, and injection resistance of the server itself.",
    description:
      "The server's own defensive posture: how it authenticates callers, whether transport is " +
      "encrypted and scoped, tenant isolation, secret handling, and — specific to MCP — resistance " +
      "to tool-poisoning and prompt-injection, where malicious text in a tool description or a " +
      "returned result steers the calling agent.",
    auditQuestions: [
      "How is the caller authenticated (OAuth scopes, per-tenant keys, or a shared bearer)?",
      "Is transport TLS, and are tokens scoped and revocable?",
      "Do tool descriptions or results contain instruction-like text that could poison the agent?",
      "Is there tenant isolation, or can one caller's arguments reach another tenant's data?",
    ],
    riskSignals: [
      "shared/static bearer tokens, no per-tenant scoping",
      "tool descriptions containing imperative instructions to the agent",
      "unauthenticated tools or overly broad OAuth scopes",
      "no rate limiting or anomaly detection",
    ],
    scoringGuidance:
      "0–20: scoped OAuth, TLS, tenant isolation, clean descriptions. 30–50: sound but broad scopes. " +
      "60–80: shared tokens or injection-prone descriptions. 85–100: unauthenticated or actively poisoned tools.",
    emphasis: "capability",
  },
  {
    id: "supply_chain",
    name: "Supply chain & nth-party",
    summary: "Who the server itself calls, and the risk inherited from them.",
    description:
      "An MCP server is rarely a leaf: it fronts other APIs, SaaS, models, and infrastructure. This " +
      "dimension captures inherited (nth-party) risk — the subprocessors and downstream services the " +
      "server depends on, the provenance of the server code itself, and whether a compromise upstream " +
      "flows through to the integrator.",
    auditQuestions: [
      "What downstream services/APIs does the server call to fulfill its tools?",
      "Is the server first-party to the vendor whose data it exposes, or a third-party bridge?",
      "Is the server code open-source and auditable, or an opaque hosted endpoint?",
      "Are subprocessors disclosed, and do they have their own assurance?",
    ],
    riskSignals: [
      "third-party 'bridge' server reselling access to another vendor's API",
      "undisclosed downstream dependencies",
      "closed-source hosted server with no provenance",
      "chained MCP servers (server calls other MCP servers)",
    ],
    scoringGuidance:
      "0–20: first-party, open-source, disclosed deps. 30–50: first-party hosted, some disclosure. " +
      "60–80: third-party bridge or undisclosed deps. 85–100: opaque bridge chaining untrusted upstreams.",
    emphasis: "both",
  },
  {
    id: "reputational",
    name: "Reputational impact",
    summary: "What a failure would do to the integrator's brand and trust.",
    description:
      "The brand and trust cost of this integration going wrong in public: an agent that sends a " +
      "wrong message to a customer, posts publicly, leaks data, or takes an offensive action under " +
      "the operator's name. Scored higher when the server can act outward-facing under the operator's identity.",
    auditQuestions: [
      "Can the server act in public or toward customers under the operator's brand/identity?",
      "Would a failure be visible to third parties, not just internal?",
      "Is the vendor itself reputable, or has it had public security/privacy incidents?",
      "Could misuse produce content attributed to the operator?",
    ],
    riskSignals: [
      "public posting, outbound customer messaging, or content publishing",
      "vendor with prior breaches or poor security reputation",
      "actions attributable to the operator's brand",
      "no content moderation or send-time review",
    ],
    scoringGuidance:
      "0–20: internal, no brand exposure. 30–50: limited external visibility. 60–80: customer-facing " +
      "actions under the operator's name. 85–100: public, unmoderated, brand-attributed actions.",
    emphasis: "capability",
  },
  {
    id: "liability",
    name: "Liability & end-user impact",
    summary: "Legal and duty-of-care exposure when actions reach the operator's end users.",
    description:
      "Where the operator becomes answerable for what the integration does to *their* end users — " +
      "the people who use the operator's product. When an MCP server can affect end users (message " +
      "them, change their records, make decisions about them), the operator inherits duty-of-care, " +
      "contractual, and legal liability, independent of the server's own security.",
    auditQuestions: [
      "Can the server take actions that reach or affect the operator's end users?",
      "Could an automated action create contractual, consumer-protection, or discrimination liability?",
      "Is there a human-in-the-loop before end-user-affecting actions, or is it fully automated?",
      "Does the operator's terms/DPA with its own users even permit this processing?",
    ],
    riskSignals: [
      "tools that write to or message the operator's end users",
      "automated decisions affecting end users (pricing, eligibility, moderation)",
      "no human review before end-user-facing actions",
      "processing not covered by the operator's own user agreements",
    ],
    scoringGuidance:
      "0: no end-user reach. 30–50: end-user data read, no action. 60–80: automated actions affecting " +
      "end users with review. 85–100: automated, unreviewed decisions or messages to end users.",
    emphasis: "both",
  },
  {
    id: "governance",
    name: "Governance & transparency",
    summary: "Documentation, provenance, and revocability of the integration.",
    description:
      "Whether the integrator can actually govern this dependency over time: quality of documentation, " +
      "clarity of the tool contract, ability to scope and revoke access, observability of what the " +
      "agent did, and a path to offboard cleanly. Poor governance turns every other risk into an " +
      "un-monitorable one.",
    auditQuestions: [
      "Is the tool surface documented, or must it be discovered by probing?",
      "Can access be scoped down and revoked without vendor involvement?",
      "Is there an audit log of tool calls the operator can review?",
      "Is there a clean offboarding / data-deletion path?",
    ],
    riskSignals: [
      "sparse or missing tool documentation",
      "no per-tool scoping or revocation",
      "no call-level audit trail",
      "no data-deletion or offboarding guarantee",
    ],
    scoringGuidance:
      "0–20: documented, scopable, logged, revocable. 30–50: mostly documented, coarse controls. " +
      "60–80: thin docs, no logs. 85–100: opaque, unrevocable, no audit trail.",
    emphasis: "both",
  },
];

export const DIMENSION_IDS = RISK_DIMENSIONS.map((d) => d.id);
export type DimensionId = (typeof RISK_DIMENSIONS)[number]["id"];

export function getDimension(id: string): RiskDimension | undefined {
  return RISK_DIMENSIONS.find((d) => d.id === id);
}

/** Map a 0–100 dimension score to a severity band. */
export function scoreToSeverity(score: number): RiskSeverity {
  if (score >= 85) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  if (score >= 15) return "low";
  return "info";
}

/** Map a severity band to an overall letter grade input (lower risk = better). */
export function scoreToGrade(overall: number): "A" | "B" | "C" | "D" | "F" {
  if (overall < 15) return "A";
  if (overall < 35) return "B";
  if (overall < 60) return "C";
  if (overall < 85) return "D";
  return "F";
}
