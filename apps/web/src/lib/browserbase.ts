// Browserbase + Stagehand wrapper for the Trust Center AI Migration.
//
// Stagehand drives a real Chrome running on Browserbase and uses Claude (the
// Anthropic key we already configure for the network's "Ask" assistant) to act
// on and read pages. We keep the session alive across the human-in-the-loop
// pause (request docs / sign NDA -> owner releases docs -> Resume) so the second
// phase can reconnect to the very same browser via its session id.
//
// Stagehand is a heavy, browser-bound dependency, so it is loaded lazily and is
// only ever imported from server code (server actions / background phases).

import type { V3 as Stagehand } from "@browserbasehq/stagehand";

export type { Stagehand };

export interface MigrationEnv {
  browserbaseApiKey: string;
  browserbaseProjectId: string;
  anthropicApiKey: string;
  model: string;
}

/**
 * Reads the migration credentials from the environment, or returns null when the
 * feature isn't configured (so the UI can degrade gracefully like the network's
 * Ask widget does, instead of throwing).
 */
export function migrationEnv(): MigrationEnv | null {
  const browserbaseApiKey = process.env.BROWSERBASE_API_KEY ?? "";
  const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID ?? "";
  // Reuse the same Anthropic key the network already uses for the Ask widget.
  const anthropicApiKey = process.env.TRUSTMCP_ANTHROPIC_API_KEY ?? "";
  if (!browserbaseApiKey || !browserbaseProjectId || !anthropicApiKey) return null;
  return {
    browserbaseApiKey,
    browserbaseProjectId,
    anthropicApiKey,
    model: process.env.TRUSTMCP_MIGRATION_MODEL ?? "claude-opus-4-8",
  };
}

export interface SessionHandle {
  sh: Stagehand;
  sessionId?: string;
  replayUrl?: string;
}

async function loadStagehand(): Promise<typeof Stagehand> {
  const mod = await import("@browserbasehq/stagehand");
  return mod.Stagehand;
}

function baseOptions(env: MigrationEnv) {
  return {
    env: "BROWSERBASE" as const,
    apiKey: env.browserbaseApiKey,
    projectId: env.browserbaseProjectId,
    // Configure the LLM with our Anthropic key so act/extract/observe and the
    // agent all authenticate without relying on ambient env vars.
    model: { modelName: env.model, apiKey: env.anthropicApiKey },
    verbose: 0 as const,
  };
}

/** Start a fresh Browserbase session that survives the resume pause. */
export async function startSession(env: MigrationEnv): Promise<SessionHandle> {
  const StagehandCtor = await loadStagehand();
  const sh = new StagehandCtor({
    ...baseOptions(env),
    // Keep the browser alive while we wait for the source owner to release
    // documents; Resume reconnects to this same session by id.
    keepAlive: true,
  });
  await sh.init();
  return { sh, sessionId: sh.browserbaseSessionID, replayUrl: sh.browserbaseSessionURL };
}

/**
 * Reconnect to an existing Browserbase session (created in the request phase).
 * If the session has since expired, the caller should fall back to startSession.
 */
export async function resumeSession(env: MigrationEnv, sessionId: string): Promise<SessionHandle> {
  const StagehandCtor = await loadStagehand();
  const sh = new StagehandCtor({
    ...baseOptions(env),
    browserbaseSessionID: sessionId,
  });
  await sh.init();
  return { sh, sessionId: sh.browserbaseSessionID, replayUrl: sh.browserbaseSessionURL };
}

/** Close a session without letting cleanup errors mask the real outcome. */
export async function closeSession(sh: Stagehand): Promise<void> {
  try {
    await sh.close();
  } catch {
    /* best-effort */
  }
}
