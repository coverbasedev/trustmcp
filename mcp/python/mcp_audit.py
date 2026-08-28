"""MCP audit interaction layer for the reference MCP server.

This is the "talk to the audit" side of TrustMCP's MCP Audit feature. It does two
things, both non-destructive:

  1. Live, read-only inspection of a target MCP server — the same handshake the
     web audit engine performs — plus deterministic classification of every tool
     (read / write / destructive / outward / execute), the data classes each tool
     can touch, and tool-poisoning detection. No tool is ever *called* here.

  2. Dynamic probe generation. Every server differs, so probes are built from the
     discovered tool surface and the caller's stated intended use, not a static
     list. Read-only probes are marked safe to run; anything that could change
     state is emitted as a recommendation for a human to run under their own
     authorization.

The heavier LLM-driven synthesis (vendor research, scorecard) lives in the web
app, which holds the operator's model credentials. This module is the deterministic
core an agent can drive directly, and it mirrors
apps/web/src/lib/mcp-audit/{classify,mcp-inspect}.ts so both sides agree.
"""

from __future__ import annotations

import json
import re

import httpx

PROTOCOL_VERSION = "2025-06-18"

# --- classification (mirror of apps/web/src/lib/mcp-audit/classify.ts) --------

_DESTRUCTIVE = re.compile(
    r"\b(delete|remove|destroy|drop|purge|wipe|revoke|cancel|terminate|archive|trash)\b", re.I
)
_OUTWARD = re.compile(
    r"\b(send|email|post|publish|share|message|notify|invite|reply|forward|tweet|broadcast|dispatch)\b",
    re.I,
)
_EXECUTE = re.compile(
    r"\b(execute|run|exec|shell|command|query|sql|eval|invoke|trigger|deploy)\b", re.I
)
_WRITE = re.compile(
    r"\b(create|update|write|set|add|edit|modify|upsert|save|put|patch|move|rename|assign|approve|"
    r"pay|transfer|refund|charge|order|schedule|book)\b",
    re.I,
)
_READ = re.compile(
    r"\b(get|list|search|read|find|fetch|lookup|query|show|describe|view|discover|check|export|download)\b",
    re.I,
)

_DATA_CLASSES: list[tuple[str, re.Pattern[str]]] = [
    ("pii", re.compile(
        r"\b(name|email|phone|address|contact|person|user|customer|employee|profile|ssn|dob|birth)\b",
        re.I,
    )),
    ("financial", re.compile(
        r"\b(payment|invoice|payroll|salary|bank|card|account|payout|charge|refund|transaction|"
        r"revenue|price|deduction|paystub)\b",
        re.I,
    )),
    ("credentials", re.compile(
        r"\b(token|secret|password|credential|key|apikey|oauth|session)\b", re.I
    )),
    ("health", re.compile(
        r"\b(health|patient|medical|diagnosis|prescription|phi|clinical)\b", re.I
    )),
    ("messages", re.compile(
        r"\b(message|email|chat|thread|conversation|inbox|dm|comment)\b", re.I
    )),
    ("files", re.compile(
        r"\b(file|document|attachment|drive|blob|upload|download|content)\b", re.I
    )),
    ("calendar", re.compile(r"\b(calendar|event|meeting|schedule|availability)\b", re.I)),
    ("code", re.compile(r"\b(repo|repository|code|commit|branch|pull request|pr|source)\b", re.I)),
    ("location", re.compile(r"\b(location|geo|coordinate|address|region|ip)\b", re.I)),
]

_INJECTION = [
    re.compile(r"ignore (all |any )?(previous|prior|above)", re.I),
    re.compile(r"\byou must (always|never)\b", re.I),
    re.compile(r"\balways call\b", re.I),
    re.compile(r"\bdo not (tell|mention|inform)\b", re.I),
    re.compile(r"<\s*(system|instructions?)\s*>", re.I),
]

# Risk dimensions (mirror of taxonomy.ts) — the nomenclature the report scores.
RISK_DIMENSIONS: list[dict[str, str]] = [
    {"id": "data", "name": "Data exposure",
     "summary": "Data classes and sensitivity flowing through the server."},
    {"id": "privacy", "name": "Privacy & personal data",
     "summary": "Personal-data processing and end-user exposure."},
    {"id": "autonomy", "name": "Agency & autonomy",
     "summary": "How much the server can do — write, send, pay, delete."},
    {"id": "operational", "name": "Operational reliability",
     "summary": "Availability, maturity, failure behavior."},
    {"id": "criticality", "name": "Business criticality",
     "summary": "How central the workflow is; cost of misbehavior."},
    {"id": "financial", "name": "Financial exposure",
     "summary": "Payments, spend, fraud, runaway cost."},
    {"id": "compliance", "name": "Compliance & regulatory",
     "summary": "Regulated data and triggered obligations."},
    {"id": "security_posture", "name": "Security posture",
     "summary": "Auth, transport, tenancy, injection resistance."},
    {"id": "supply_chain", "name": "Supply chain & nth-party",
     "summary": "Downstream services and inherited risk."},
    {"id": "reputational", "name": "Reputational impact",
     "summary": "Brand cost of a public failure."},
    {"id": "liability", "name": "Liability & end-user impact",
     "summary": "Legal exposure when actions reach end users."},
    {"id": "governance", "name": "Governance & transparency",
     "summary": "Docs, provenance, revocability, audit trail."},
]


def classify_action(name: str, description: str) -> str:
    text = f"{name} {description}"
    if _EXECUTE.search(name) or re.search(r"\b(shell|exec|eval|arbitrary)\b", text, re.I):
        return "execute"
    if _DESTRUCTIVE.search(text):
        return "destructive"
    if _OUTWARD.search(text):
        return "outward"
    if _WRITE.search(text):
        return "write"
    if _READ.search(text):
        return "read"
    return "unknown"


def classify_data_classes(name: str, description: str, schema: object) -> list[str]:
    text = f"{name} {description} {json.dumps(schema or {})}"
    return [c for c, pat in _DATA_CLASSES if pat.search(text)]


def detect_injection(name: str, description: str) -> bool:
    text = f"{name} {description}"
    return any(pat.search(text) for pat in _INJECTION)


def classify_tool(tool: dict) -> dict:
    name = str(tool.get("name", ""))
    desc = str(tool.get("description", "") or "")
    return {
        "name": name,
        "description": desc,
        "action": classify_action(name, desc),
        "data_classes": classify_data_classes(name, desc, tool.get("inputSchema")),
        "has_output_schema": tool.get("outputSchema") is not None,
        "injection_suspected": detect_injection(name, desc),
    }


# --- read-only MCP inspection -------------------------------------------------


def _parse(resp: httpx.Response) -> dict:
    ctype = resp.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                chunk = line[5:].strip()
                if not chunk:
                    continue
                try:
                    obj = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and ("result" in obj or "error" in obj):
                    return obj
        return {}
    try:
        return resp.json()
    except Exception:
        return {}


def inspect_server(url: str, bearer: str | None = None, *, timeout: float = 20.0) -> dict:
    """Handshake with an MCP server and enumerate its tools. Never calls a tool.

    Returns {ok, server_info, protocol_version, tools:[classified], error}."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
    }
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"

    def rpc(client: httpx.Client, method: str, params: dict | None, rpc_id: int | None):
        body: dict = {"jsonrpc": "2.0", "method": method}
        if rpc_id is not None:
            body["id"] = rpc_id
        if params is not None:
            body["params"] = params
        return client.post(url, headers=headers, json=body, timeout=timeout)

    try:
        with httpx.Client() as client:
            init = rpc(
                client,
                "initialize",
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "trustmcp-audit", "version": "1.0"},
                },
                1,
            )
            init.raise_for_status()
            session_id = init.headers.get("mcp-session-id")
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            init_result = (_parse(init).get("result")) or {}
            rpc(client, "notifications/initialized", {}, None)

            listed = _parse(rpc(client, "tools/list", {}, 2))
            raw_tools = ((listed.get("result") or {}).get("tools")) or []
            tools = [classify_tool(t) for t in raw_tools]
            return {
                "ok": True,
                "server_info": init_result.get("serverInfo"),
                "protocol_version": init_result.get("protocolVersion"),
                "tools": tools,
            }
    except Exception as e:  # pragma: no cover - network dependent
        return {"ok": False, "tools": [], "error": str(e)[:300]}


# --- dynamic probe generation -------------------------------------------------


def _risk_signals(tools: list[dict]) -> dict:
    """Aggregate deterministic risk signals over the classified tool surface."""
    actions: dict[str, int] = {}
    data_classes: set[str] = set()
    injection = []
    no_schema = 0
    for t in tools:
        actions[t["action"]] = actions.get(t["action"], 0) + 1
        data_classes.update(t["data_classes"])
        if t["injection_suspected"]:
            injection.append(t["name"])
        if not t["has_output_schema"]:
            no_schema += 1
    return {
        "action_counts": actions,
        "data_classes": sorted(data_classes),
        "injection_suspected_tools": injection,
        "tools_without_output_schema": no_schema,
        "tool_count": len(tools),
    }


def generate_probes(tools: list[dict], intended_use: str = "") -> list[dict]:
    """Build server-specific probes from the discovered tool surface. Read-only
    probes are safe to run; write/destructive/outward tools yield review-only
    recommendations that must never be auto-executed."""
    probes: list[dict] = []
    for t in tools:
        name, action = t["name"], t["action"]
        dc = ", ".join(t["data_classes"]) or "unknown data"
        if action == "read":
            probes.append({
                "dimension": "data",
                "safety": "read_only",
                "target_tool": name,
                "hypothesis": f"`{name}` may return more fields ({dc}) than a caller requests.",
                "prompt": (
                    f"Call `{name}` with a minimal query and inspect the response: does it return "
                    f"whole records or only the requested fields? Note any {dc} present."
                ),
            })
        elif action in ("write", "outward", "destructive", "execute"):
            outward = action == "outward"
            outward_note = (
                " It can act outward-facing under the operator's identity." if outward else ""
            )
            probes.append({
                "dimension": "reputational" if outward else "autonomy",
                "safety": "review_only",
                "target_tool": name,
                "hypothesis": (
                    f"`{name}` is a {action} tool — confirm blast radius and whether it is gated."
                ),
                "prompt": (
                    f"WITHOUT running it, review `{name}`: is it reversible? Does it require a "
                    f"confirmation argument, scope, or dry-run? Could prompt-injected content "
                    f"trigger it?{outward_note}"
                ),
            })
        if t["injection_suspected"]:
            probes.append({
                "dimension": "security_posture",
                "safety": "review_only",
                "target_tool": name,
                "hypothesis": (
                    f"`{name}`'s description contains instruction-like text (possible poisoning)."
                ),
                "prompt": (
                    f"Read `{name}`'s description adversarially: is it trying to steer the calling "
                    f"agent rather than describe a tool? Treat as a tool-poisoning finding if so."
                ),
            })
    if intended_use:
        probes.append({
            "dimension": "liability",
            "safety": "review_only",
            "target_tool": None,
            "hypothesis": "The intended use may reach the operator's end users.",
            "prompt": (
                f"Given the intended use ({intended_use}), which tools could affect the operator's "
                f"end users, and is there a human-in-the-loop before those actions?"
            ),
        })
    return probes


def inspect_and_probe(url: str, bearer: str | None = None, intended_use: str = "") -> dict:
    """One call an agent can drive: inspect the server, classify its tools, derive
    risk signals, and generate dynamic probes. Fully non-destructive."""
    result = inspect_server(url, bearer)
    if not result.get("ok"):
        return result
    tools = result["tools"]
    return {
        "ok": True,
        "target": url,
        "server_info": result.get("server_info"),
        "tool_inventory": tools,
        "risk_signals": _risk_signals(tools),
        "dynamic_probes": generate_probes(tools, intended_use),
        "note": (
            "Read-only inspection. Write/destructive/outward probes are recommendations only and "
            "were not executed. For a full scored scorecard, run a scan in the TrustMCP MCP Audit "
            "workspace."
        ),
    }
