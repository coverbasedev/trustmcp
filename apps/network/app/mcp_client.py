"""Minimal synchronous MCP (Streamable HTTP) client used to check a CRM
relationship against a customer's *own* MCP server.

When a trust center connects its CRM via MCP (rather than a pasted API token),
relationship checks call the customer's MCP endpoint instead of HubSpot/Salesforce
directly. This client performs the MCP handshake, discovers a "search companies /
accounts by domain" tool heuristically, calls it, and decides whether the domain
corresponds to an existing account.

It is intentionally small and best-effort: CRM MCP servers are not standardized,
so tool and argument selection are heuristic, and any failure degrades to
``found=None`` ("unknown") rather than raising - callers treat unknown as
"don't auto-release", never as a grant.
"""

from __future__ import annotations

import json
import logging

import httpx

log = logging.getLogger("trustmcp.mcp")

_PROTOCOL_VERSION = "2025-06-18"

# Tool-name/description keywords, highest-signal first. Used to pick the tool most
# likely to look up an account/company by domain on an arbitrary CRM MCP server.
_TOOL_KEYWORDS = ("company", "account", "customer", "search", "find", "lookup", "contact", "crm")
# Preferred argument names for passing the domain to the chosen tool.
_ARG_NAMES = ("domain", "website", "query", "q", "search", "name", "keyword", "email")
# Substrings that indicate an empty result (so a successful call with no match is
# treated as found=False rather than found=True).
_NEGATIVE = ("no result", "not found", "no match", "no compan", "no account", "0 result", "empty")


def oauth_client_credentials_token(
    token_url: str, client_id: str, client_secret: str, *, timeout: float = 20.0
) -> str | None:
    """Fetch an access token via the OAuth 2.0 client-credentials grant. MCP servers
    commonly sit behind OAuth, so this lets a vendor connect one without minting a
    static bearer token. Returns None on any failure (caller proceeds unauthenticated)."""
    try:
        r = httpx.post(
            token_url,
            data={"grant_type": "client_credentials"},
            auth=(client_id, client_secret),
            headers={"Accept": "application/json"},
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json().get("access_token")
    except Exception as e:  # pragma: no cover - network dependent
        log.warning("mcp oauth token fetch failed: %s", e)
        return None


def _parse(resp: httpx.Response) -> dict:
    """Parse a JSON-RPC response that may be a plain JSON body or an SSE stream."""
    ctype = resp.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                chunk = line[5:].strip()
                if not chunk:
                    continue
                obj = json.loads(chunk)
                if isinstance(obj, dict) and ("result" in obj or "error" in obj):
                    return obj
        return {}
    return resp.json()


def _pick_tool(tools: list[dict]) -> dict | None:
    def score(tool: dict) -> int:
        text = f"{tool.get('name', '')} {tool.get('description', '')}".lower()
        return sum(len(_TOOL_KEYWORDS) - i for i, kw in enumerate(_TOOL_KEYWORDS) if kw in text)

    ranked = sorted(((score(t), t) for t in tools), key=lambda x: x[0], reverse=True)
    return ranked[0][1] if ranked and ranked[0][0] > 0 else None


def _build_args(tool: dict, domain: str) -> dict:
    schema = tool.get("inputSchema") or {}
    props = list((schema.get("properties") or {}).keys())
    for name in _ARG_NAMES:
        if name in props:
            return {name: domain}
    # No recognizable property - fall back to the first declared one, else "query".
    return {props[0] if props else "query": domain}


def _looks_found(result: dict) -> bool | None:
    if result.get("isError"):
        return None
    parts: list[str] = []
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(str(item.get("text", "")))
    if result.get("structuredContent") is not None:
        parts.append(json.dumps(result["structuredContent"]))
    text = " ".join(parts).strip()
    if not text:
        return False
    lowered = text.lower()
    if any(neg in lowered for neg in _NEGATIVE):
        return False
    return True


def query_company(
    url: str,
    token: str | None,
    domain: str,
    *,
    timeout: float = 20.0,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """Look up `domain` on a CRM MCP server. Returns {found: bool|None, detail}.

    `transport` is an injection seam for tests (e.g. httpx.MockTransport)."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": _PROTOCOL_VERSION,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    def rpc(client: httpx.Client, method: str, params: dict | None = None, rpc_id: int | None = 1):
        body: dict = {"jsonrpc": "2.0", "method": method}
        if rpc_id is not None:
            body["id"] = rpc_id
        if params is not None:
            body["params"] = params
        return client.post(url, headers=headers, json=body, timeout=timeout)

    try:
        with httpx.Client(transport=transport) as client:
            init = rpc(
                client,
                "initialize",
                {
                    "protocolVersion": _PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "trustmcp-network", "version": "0.1"},
                },
            )
            init.raise_for_status()
            session_id = init.headers.get("mcp-session-id")
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            # Acknowledge initialization (notification: no id, no response body).
            rpc(client, "notifications/initialized", {}, rpc_id=None)

            listed = _parse(rpc(client, "tools/list", {}, rpc_id=2))
            tools = ((listed.get("result") or {}).get("tools")) or []
            tool = _pick_tool(tools)
            if tool is None:
                return {"found": None, "detail": "no suitable CRM tool on MCP server"}

            called = _parse(
                rpc(
                    client,
                    "tools/call",
                    {"name": tool["name"], "arguments": _build_args(tool, domain)},
                    rpc_id=3,
                )
            )
            if "error" in called:
                return {"found": None, "detail": str(called["error"])[:200]}
            return {"found": _looks_found(called.get("result") or {}), "detail": tool["name"]}
    except Exception as e:  # pragma: no cover - network dependent
        return {"found": None, "detail": str(e)[:200]}
