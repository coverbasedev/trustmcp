// Deterministic, cheap classification of a tool from its name/description/schema.
// This runs before any model call so the engine can (a) decide which tools are
// safe to auto-probe (read-only only) and (b) seed the model with a structured
// view instead of raw JSON. The model later refines these, but the heuristics are
// the safety floor: a tool the heuristic flags as write/destructive is NEVER
// auto-invoked, even if the model disagrees.

import type { RawTool } from "./mcp-inspect";
import type { ToolRecord } from "./types";

const DESTRUCTIVE = /\b(delete|remove|destroy|drop|purge|wipe|revoke|cancel|terminate|archive|trash)\b/i;
const OUTWARD = /\b(send|email|post|publish|share|message|notify|invite|reply|forward|tweet|broadcast|dispatch)\b/i;
const EXECUTE = /\b(execute|run|exec|shell|command|query|sql|eval|invoke|trigger|deploy)\b/i;
const WRITE = /\b(create|update|write|set|add|edit|modify|upsert|save|put|patch|move|rename|assign|approve|pay|transfer|refund|charge|order|schedule|book)\b/i;
const READ = /\b(get|list|search|read|find|fetch|lookup|query|show|describe|view|discover|check|export|download)\b/i;

const DATA_CLASS_PATTERNS: [string, RegExp][] = [
  ["pii", /\b(name|email|phone|address|contact|person|user|customer|employee|profile|ssn|dob|birth)\b/i],
  ["financial", /\b(payment|invoice|payroll|salary|bank|card|account|payout|charge|refund|transaction|revenue|price|deduction|paystub)\b/i],
  ["credentials", /\b(token|secret|password|credential|key|apikey|oauth|session)\b/i],
  ["health", /\b(health|patient|medical|diagnosis|prescription|phi|clinical)\b/i],
  ["messages", /\b(message|email|chat|thread|conversation|inbox|dm|comment)\b/i],
  ["files", /\b(file|document|attachment|drive|blob|upload|download|content)\b/i],
  ["calendar", /\b(calendar|event|meeting|schedule|availability)\b/i],
  ["code", /\b(repo|repository|code|commit|branch|pull request|pr|source)\b/i],
  ["location", /\b(location|geo|coordinate|address|region|ip)\b/i],
];

// Instruction-like phrasing in a tool description is a tool-poisoning signal:
// the description is trying to steer the calling agent rather than describe a tool.
const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above)/i,
  /\byou must (always|never)\b/i,
  /\balways call\b/i,
  /\bdo not (tell|mention|inform)\b/i,
  /<\s*(system|instructions?)\s*>/i,
  /\bregardless of\b.*\b(instruction|policy)\b/i,
  /\bprepend\b|\bappend\b.*\b(to (the|your) (response|output))\b/i,
];

export function classifyAction(tool: RawTool): ToolRecord["action"] {
  const text = `${tool.name} ${tool.description ?? ""}`;
  // Order matters: the most powerful capability wins.
  if (EXECUTE.test(tool.name) || /\b(shell|exec|eval|arbitrary)\b/i.test(text)) return "execute";
  if (DESTRUCTIVE.test(text)) return "destructive";
  if (OUTWARD.test(text)) return "outward";
  if (WRITE.test(text)) return "write";
  if (READ.test(text)) return "read";
  return "unknown";
}

export function classifyDataClasses(tool: RawTool): string[] {
  const text = `${tool.name} ${tool.description ?? ""} ${JSON.stringify(tool.inputSchema ?? {})}`;
  const classes = DATA_CLASS_PATTERNS.filter(([, re]) => re.test(text)).map(([c]) => c);
  return [...new Set(classes)];
}

export function detectInjection(tool: RawTool): boolean {
  const text = `${tool.name} ${tool.description ?? ""}`;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

export function hasOutputSchema(tool: RawTool): boolean {
  return tool.outputSchema !== undefined && tool.outputSchema !== null;
}

export function classifyTool(tool: RawTool): ToolRecord {
  return {
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    hasOutputSchema: hasOutputSchema(tool),
    action: classifyAction(tool),
    dataClasses: classifyDataClasses(tool),
    injectionSuspected: detectInjection(tool),
  };
}

/** A tool is safe to auto-probe only if the heuristic says read (never unknown). */
export function isAutoProbeSafe(tool: ToolRecord): boolean {
  return tool.action === "read";
}
