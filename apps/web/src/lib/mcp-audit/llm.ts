// Provider abstraction for the audit engine. The operator brings their own LLM
// credentials (stored per-org, encrypted) and picks a model; the engine talks to
// whichever provider that model belongs to. Anthropic and OpenAI are the two
// first-class providers, matching what most teams already have keys for.
//
// The engine only ever asks for a JSON object back, so this exposes a single
// `completeJson` that both providers implement and that parses/repairs the JSON.

import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "anthropic" | "openai";

export interface ModelOption {
  id: string;
  label: string;
  /** Rough capability tier, so the UI can hint which to pick for a deep audit. */
  tier: "frontier" | "balanced" | "fast";
}

// Curated catalogs. Kept small and current; the credential form also allows a
// free-form model id so a newer model can be used without a code change.
export const MODEL_CATALOG: Record<LlmProvider, ModelOption[]> = {
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", tier: "frontier" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", tier: "balanced" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "fast" },
  ],
  openai: [
    { id: "gpt-5.1", label: "GPT-5.1", tier: "frontier" },
    { id: "gpt-5.1-mini", label: "GPT-5.1 mini", tier: "balanced" },
    { id: "gpt-5.1-nano", label: "GPT-5.1 nano", tier: "fast" },
  ],
};

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  /** OpenAI-compatible base URL override (e.g. Azure/OpenRouter). Optional. */
  baseUrl?: string;
}

export interface JsonCompletionInput {
  system: string;
  user: string;
  maxTokens?: number;
}

/** A minimal shape for the OpenAI chat-completions response we consume. */
interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
}

/** Extract the first balanced JSON object/array from a model's text. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  // Strip code fences if the model wrapped the JSON.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.search(/[{[]/);
  if (start === -1) return body;
  // Walk to the matching close so trailing prose is dropped.
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start);
}

async function anthropicJson(cfg: LlmConfig, input: JsonCompletionInput): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  const message = await client.messages.create({
    model: cfg.model,
    max_tokens: input.maxTokens ?? 4096,
    system: input.system + "\n\nRespond with ONLY a single JSON value. No prose, no markdown.",
    messages: [{ role: "user", content: input.user }],
  });
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function openaiJson(cfg: LlmConfig, input: JsonCompletionInput): Promise<string> {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_completion_tokens: input.maxTokens ?? 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system + "\n\nRespond with ONLY a single JSON object." },
        { role: "user", content: input.user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as OpenAiChatResponse;
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Ask the configured model for a JSON value and parse it. Throws on a hard API
 * failure; callers decide whether to degrade. Returns `T` after a best-effort
 * extraction so a little surrounding prose doesn't break parsing.
 */
export async function completeJson<T = unknown>(
  cfg: LlmConfig,
  input: JsonCompletionInput,
): Promise<T> {
  const raw = cfg.provider === "anthropic" ? await anthropicJson(cfg, input) : await openaiJson(cfg, input);
  const json = extractJson(raw);
  return JSON.parse(json) as T;
}

/** Provider that owns a model id, inferred for display when not stored. */
export function providerForModel(model: string): LlmProvider {
  return model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")
    ? "openai"
    : "anthropic";
}

/** Lightweight credential check: can we reach the provider with this key/model? */
export async function verifyCredential(cfg: LlmConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await completeJson(cfg, {
      system: "You are a connectivity check.",
      user: 'Return {"ok": true}.',
      maxTokens: 32,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
