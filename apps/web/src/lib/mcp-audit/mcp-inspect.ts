// Read-only MCP client used by the audit engine to inspect a target server.
//
// Safety is the whole design here. Auditing means *fuzzing* a server we may not
// own, so this client is deliberately non-destructive: it performs the MCP
// handshake and enumerates the surface (tools/list, resources/list, prompts/list),
// and it will call a tool ONLY when the caller has classified it read-only and
// explicitly opts in. It never calls a write/destructive/outward tool. Anything
// that could change state is turned into a *recommended* probe (DynamicProbe with
// safety: "review_only") for a human to run under their own authorization, not
// executed here.
//
// Streamable HTTP + SSE responses are both handled. Auth is optional and, when
// present, uses a scoped bearer the operator supplied; it is used only against the
// target host and never logged.

const PROTOCOL_VERSION = "2025-06-18";

export interface InspectAuth {
  kind: "none" | "bearer" | "oauth_client_credentials" | "header";
  bearer?: string;
  header?: { name: string; value: string };
  oauth?: { tokenUrl: string; clientId: string; clientSecret: string };
}

export interface RawTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface InspectResult {
  ok: boolean;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  tools: RawTool[];
  resources: { uri: string; name?: string; description?: string }[];
  prompts: { name: string; description?: string }[];
  capabilities?: Record<string, unknown>;
  error?: string;
}

interface RpcOk {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function parseBody(contentType: string, text: string): RpcOk {
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        const chunk = line.slice(5).trim();
        if (!chunk) continue;
        try {
          const obj = JSON.parse(chunk);
          if (obj && (obj.result !== undefined || obj.error !== undefined)) return obj;
        } catch {
          /* keep scanning */
        }
      }
    }
    return {};
  }
  try {
    return JSON.parse(text) as RpcOk;
  } catch {
    return {};
  }
}

async function oauthToken(auth: InspectAuth, timeoutMs: number): Promise<string | null> {
  if (auth.kind !== "oauth_client_credentials" || !auth.oauth) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(auth.oauth.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization:
          "Basic " + Buffer.from(`${auth.oauth.clientId}:${auth.oauth.clientSecret}`).toString("base64"),
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

/** Build the transport headers, including any operator-supplied auth. */
async function buildHeaders(auth: InspectAuth, timeoutMs: number): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (auth.kind === "bearer" && auth.bearer) headers.Authorization = `Bearer ${auth.bearer}`;
  if (auth.kind === "header" && auth.header) headers[auth.header.name] = auth.header.value;
  if (auth.kind === "oauth_client_credentials") {
    const token = await oauthToken(auth, timeoutMs);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Handshake with an MCP server over Streamable HTTP and enumerate its surface.
 * Never calls a tool. Returns ok:false with a message on any failure.
 */
export async function inspectServer(
  url: string,
  auth: InspectAuth = { kind: "none" },
  opts: { timeoutMs?: number } = {},
): Promise<InspectResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const empty: InspectResult = { ok: false, tools: [], resources: [], prompts: [] };

  let headers: Record<string, string>;
  try {
    headers = await buildHeaders(auth, timeoutMs);
  } catch (e) {
    return { ...empty, error: `auth setup failed: ${errMsg(e)}` };
  }

  const call = async (method: string, params: unknown, id: number | null): Promise<Response> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const body: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (id !== null) body.id = id;
    if (params !== undefined) body.params = params;
    try {
      return await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(t);
    }
  };

  try {
    const initRes = await call(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "trustmcp-audit", version: "1.0" },
      },
      1,
    );
    if (!initRes.ok) return { ...empty, error: `initialize returned HTTP ${initRes.status}` };
    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const initParsed = parseBody(
      initRes.headers.get("content-type") ?? "",
      await initRes.text(),
    );
    const initResult = initParsed.result ?? {};

    // Acknowledge init (notification: no id, response body ignored).
    await call("notifications/initialized", {}, null);

    const [toolsRes, resourcesRes, promptsRes] = await Promise.all([
      call("tools/list", {}, 2),
      call("resources/list", {}, 3).catch(() => null),
      call("prompts/list", {}, 4).catch(() => null),
    ]);

    const tools = extractTools(await readParsed(toolsRes));
    const resources = extractResources(resourcesRes ? await readParsed(resourcesRes) : {});
    const prompts = extractPrompts(promptsRes ? await readParsed(promptsRes) : {});

    return {
      ok: true,
      serverInfo: (initResult.serverInfo as InspectResult["serverInfo"]) ?? undefined,
      protocolVersion: (initResult.protocolVersion as string) ?? undefined,
      capabilities: (initResult.capabilities as Record<string, unknown>) ?? undefined,
      tools,
      resources,
      prompts,
    };
  } catch (e) {
    return { ...empty, error: errMsg(e) };
  }
}

/**
 * Call a single tool that the caller has already classified read-only. This is the
 * ONLY path that invokes a tool, and callers must never pass a write/destructive
 * tool here. Returns the text/structured content or an error string.
 */
export async function callReadOnlyTool(
  url: string,
  auth: InspectAuth,
  toolName: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; text: string; isError: boolean }> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const headers = await buildHeaders(auth, timeoutMs);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Re-handshake so we hold a valid session for the call.
    const initRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "trustmcp-audit", version: "1.0" },
        },
      }),
      signal: controller.signal,
    });
    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    });

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    const parsed = parseBody(res.headers.get("content-type") ?? "", await res.text());
    if (parsed.error) return { ok: false, text: parsed.error.message, isError: true };
    const result = parsed.result ?? {};
    const isError = Boolean((result as { isError?: boolean }).isError);
    const parts: string[] = [];
    for (const item of ((result as { content?: unknown[] }).content ?? []) as Array<
      Record<string, unknown>
    >) {
      if (item?.type === "text") parts.push(String(item.text ?? ""));
    }
    if ((result as { structuredContent?: unknown }).structuredContent !== undefined) {
      parts.push(JSON.stringify((result as { structuredContent?: unknown }).structuredContent));
    }
    return { ok: true, text: parts.join("\n").slice(0, 4000), isError };
  } catch (e) {
    return { ok: false, text: errMsg(e), isError: true };
  } finally {
    clearTimeout(t);
  }
}

async function readParsed(res: Response | null): Promise<RpcOk> {
  if (!res || !res.ok) return {};
  return parseBody(res.headers.get("content-type") ?? "", await res.text());
}

function extractTools(parsed: RpcOk): RawTool[] {
  const raw = ((parsed.result?.tools as unknown[]) ?? []) as Array<Record<string, unknown>>;
  return raw.map((t) => ({
    name: String(t.name ?? ""),
    description: t.description ? String(t.description) : "",
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
  }));
}

function extractResources(parsed: RpcOk): InspectResult["resources"] {
  const raw = ((parsed.result?.resources as unknown[]) ?? []) as Array<Record<string, unknown>>;
  return raw.map((r) => ({
    uri: String(r.uri ?? ""),
    name: r.name ? String(r.name) : undefined,
    description: r.description ? String(r.description) : undefined,
  }));
}

function extractPrompts(parsed: RpcOk): InspectResult["prompts"] {
  const raw = ((parsed.result?.prompts as unknown[]) ?? []) as Array<Record<string, unknown>>;
  return raw.map((p) => ({
    name: String(p.name ?? ""),
    description: p.description ? String(p.description) : undefined,
  }));
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
