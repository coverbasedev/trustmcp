// AI labeling for migrated documents. Given a source document's filename and any
// hints scraped from the source trust center, Claude maps it onto TrustMCP's
// artifact taxonomy (type/title/category) so imported files are filed correctly.
//
// Uses the same Anthropic key as the rest of the platform and degrades to a
// heuristic fallback if the API is unavailable, so a migration never fails just
// because labeling hiccuped.

import Anthropic from "@anthropic-ai/sdk";

// Mirrors the artifact types offered in the Resources builder
// (apps/web/src/app/(app)/tc/[vendorId]/artifacts/page.tsx).
export const ARTIFACT_TYPES = [
  "soc2_type2",
  "soc2_type1",
  "iso_27001",
  "pentest",
  "insurance_coi",
  "financials",
  "dpa",
  "architecture",
  "subprocessor_list",
  "sbom",
  "policy",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface DocLabel {
  type: ArtifactType;
  title: string;
  category: string;
}

export interface LabelInput {
  apiKey: string;
  model: string;
  filename: string;
  hintTitle?: string | null;
  hintType?: string | null;
  sampleText?: string | null;
}

const SYSTEM_PROMPT = `You classify a security/compliance document for a vendor trust center.
Return ONLY a compact JSON object (no markdown, no prose) with exactly these keys:
- "type": one of ${ARTIFACT_TYPES.map((t) => `"${t}"`).join(", ")}
- "title": a short human-readable title (e.g. "SOC 2 Type II Report")
- "category": a grouping label such as "Compliance", "Penetration Testing", "Legal", "Security", or "Other"
Pick the single best "type". If unsure, use "policy".`;

/** Cheap heuristic used as a fallback and to seed the model with a sensible default. */
function heuristicType(text: string): ArtifactType {
  const t = text.toLowerCase();
  if (t.includes("soc 2") || t.includes("soc2")) return t.includes("type 1") || t.includes("type i ") ? "soc2_type1" : "soc2_type2";
  if (t.includes("iso") && t.includes("27001")) return "iso_27001";
  if (t.includes("pen test") || t.includes("pentest") || t.includes("penetration")) return "pentest";
  if (t.includes("insurance") || t.includes("coi") || t.includes("certificate of insurance")) return "insurance_coi";
  if (t.includes("dpa") || t.includes("data processing")) return "dpa";
  if (t.includes("sbom") || t.includes("bill of materials")) return "sbom";
  if (t.includes("subprocessor") || t.includes("sub-processor")) return "subprocessor_list";
  if (t.includes("architecture") || t.includes("network diagram")) return "architecture";
  if (t.includes("financial")) return "financials";
  return "policy";
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[._-]+/g, " ").trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Document";
}

/** Classify a document, falling back to heuristics when the model can't be reached. */
export async function labelDocument(input: LabelInput): Promise<DocLabel> {
  const hintText = [input.hintTitle, input.filename, input.hintType, input.sampleText]
    .filter(Boolean)
    .join("\n");
  const fallback: DocLabel = {
    type: heuristicType(hintText),
    title: input.hintTitle?.trim() || titleFromFilename(input.filename),
    category: "Compliance",
  };

  try {
    const client = new Anthropic({ apiKey: input.apiKey });
    const message = await client.messages.create({
      model: input.model,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Filename: ${input.filename}\n` +
            (input.hintTitle ? `Source title: ${input.hintTitle}\n` : "") +
            (input.hintType ? `Source type hint: ${input.hintType}\n` : "") +
            (input.sampleText ? `Sample text:\n${input.sampleText.slice(0, 2000)}\n` : ""),
        },
      ],
    });
    const text = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Partial<DocLabel>;
    const type = (ARTIFACT_TYPES as readonly string[]).includes(parsed.type ?? "")
      ? (parsed.type as ArtifactType)
      : fallback.type;
    return {
      type,
      title: (parsed.title ?? "").trim() || fallback.title,
      category: (parsed.category ?? "").trim() || fallback.category,
    };
  } catch {
    return fallback;
  }
}
