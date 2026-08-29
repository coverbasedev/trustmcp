// Corsair evidence integration.
//
// A scorecard is a judgement; Corsair is about the *proof* underneath it. This
// module packages the raw, verifiable evidence a scan produced — the exact MCP
// handshake, the enumerated tool contract, and the transcript of every read-only
// probe that was actually executed — into a content-addressed bundle, then (when a
// Corsair endpoint is configured) submits it to obtain an authentication proof
// that "this MCP server, at this URL, actually exposed these tools and returned
// this output at this time." The integrator can re-verify the bundle hash against
// the attestation independently.
//
// Corsair (https://github.com/) is the open-source attestation project; this is a
// thin, optional client. With no CORSAIR_URL set, we still produce and hash the
// evidence bundle locally so the raw evidence is recorded and tamper-evident — the
// scan just carries an un-attested bundle instead of a Corsair-signed one.

import { createHash } from "node:crypto";
import type { DynamicProbe, ToolRecord } from "./types";

export interface EvidenceBundle {
  target: string;
  transport: string;
  capturedAt: string;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  /** The tool contract exactly as enumerated (name + description + schema). */
  toolContract: { name: string; description: string; action: string; inputSchema?: unknown }[];
  /** Transcript of the read-only probes that were run and their observed output. */
  probeTranscript: { prompt: string; tool?: string; observation: string }[];
  /** sha256 over the canonical JSON of everything above. */
  contentHash: string;
}

export interface CorsairAttestation {
  submitted: boolean;
  /** Corsair proof id, if the endpoint accepted the bundle. */
  proofId?: string;
  /** Verification URL for the proof. */
  verifyUrl?: string;
  /** Echo of the content hash so the reader can re-verify. */
  contentHash: string;
  /** Reason we didn't submit (no endpoint configured, or the error). */
  note?: string;
}

/** Stable-key JSON so the same evidence always hashes the same. */
function canonical(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => v, 0);
}

export function buildEvidenceBundle(input: {
  target: string;
  transport: string;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  tools: ToolRecord[];
  probes: DynamicProbe[];
}): EvidenceBundle {
  const toolContract = input.tools.map((t) => ({
    name: t.name,
    description: t.description,
    action: t.action,
    inputSchema: t.inputSchema,
  }));
  const probeTranscript = input.probes
    .filter((p) => p.executed && p.observation)
    .map((p) => ({ prompt: p.prompt, tool: p.targetTool, observation: p.observation ?? "" }));

  const capturedAt = new Date().toISOString();
  const core = {
    target: input.target,
    transport: input.transport,
    capturedAt,
    serverInfo: input.serverInfo,
    protocolVersion: input.protocolVersion,
    toolContract,
    probeTranscript,
  };
  const contentHash = createHash("sha256").update(canonical(core)).digest("hex");
  return { ...core, contentHash };
}

/**
 * Submit an evidence bundle to Corsair for an attestation. No-ops (returns an
 * un-submitted result carrying the local hash) when CORSAIR_URL is unset.
 */
export async function attestWithCorsair(
  bundle: EvidenceBundle,
  opts: { timeoutMs?: number } = {},
): Promise<CorsairAttestation> {
  const endpoint = process.env.CORSAIR_URL;
  if (!endpoint) {
    return {
      submitted: false,
      contentHash: bundle.contentHash,
      note: "Corsair not configured (set CORSAIR_URL). Evidence bundle hashed locally and stored.",
    };
  }
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.CORSAIR_TOKEN) headers.Authorization = `Bearer ${process.env.CORSAIR_TOKEN}`;
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/attestations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "mcp_audit_evidence",
        subject: bundle.target,
        content_hash: bundle.contentHash,
        evidence: bundle,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        submitted: false,
        contentHash: bundle.contentHash,
        note: `Corsair returned HTTP ${res.status}. Evidence stored un-attested.`,
      };
    }
    const json = (await res.json()) as { id?: string; verify_url?: string };
    return {
      submitted: true,
      proofId: json.id,
      verifyUrl: json.verify_url,
      contentHash: bundle.contentHash,
    };
  } catch (e) {
    return {
      submitted: false,
      contentHash: bundle.contentHash,
      note: `Corsair submission failed: ${e instanceof Error ? e.message : String(e)}. Evidence stored un-attested.`,
    };
  } finally {
    clearTimeout(t);
  }
}

export function corsairConfigured(): boolean {
  return Boolean(process.env.CORSAIR_URL);
}
