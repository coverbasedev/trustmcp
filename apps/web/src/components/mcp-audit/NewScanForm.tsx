"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { startScan, type ScanFormState } from "@/app/(app)/audit/actions";

export interface ModelChoice {
  id: string;
  label: string;
  provider: string;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Starting scan…" : "Start scan"}
    </button>
  );
}

export function NewScanForm({ models }: { models: ModelChoice[] }) {
  const [state, action] = useActionState<ScanFormState, FormData>(startScan, {});
  const [authKind, setAuthKind] = useState("none");

  return (
    <form action={action} className="space-y-6">
      {state.error && <div className="banner-error">{state.error}</div>}

      <section className="card space-y-4">
        <div>
          <label className="label">Scan name</label>
          <input name="name" className="input" placeholder="Acme MCP — production integration review" required />
        </div>
        <div>
          <label className="label">MCP server URL</label>
          <input name="target_url" className="input" placeholder="https://mcp.vendor.com/mcp" required />
          <p className="mt-1 text-xs text-slate-500">
            The Streamable HTTP or SSE endpoint. Only scan servers you are authorized to assess.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Transport</label>
            <select name="transport" className="input" defaultValue="http">
              <option value="http">Streamable HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </div>
          <div>
            <label className="label">Model</label>
            <select name="model" className="input" required defaultValue={models[0]?.id ?? ""}>
              {models.length === 0 && <option value="">No credentials — add one first</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.provider})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Authentication</h2>
        <p className="text-xs text-slate-500">
          If the server requires login, provide credentials. They are encrypted at rest and used only
          server-side during the scan. TrustMCP never invokes write or destructive tools automatically.
        </p>
        <div>
          <label className="label">Auth method</label>
          <select
            name="auth_kind"
            className="input"
            value={authKind}
            onChange={(e) => setAuthKind(e.target.value)}
          >
            <option value="none">None (public server)</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
            <option value="oauth_client_credentials">OAuth client credentials</option>
          </select>
        </div>
        {authKind === "bearer" && (
          <div>
            <label className="label">Bearer token</label>
            <input name="auth_bearer" type="password" className="input" placeholder="tmcp_live_…" />
          </div>
        )}
        {authKind === "header" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Header name</label>
              <input name="auth_header_name" className="input" placeholder="X-API-Key" />
            </div>
            <div>
              <label className="label">Header value</label>
              <input name="auth_header_value" type="password" className="input" />
            </div>
          </div>
        )}
        {authKind === "oauth_client_credentials" && (
          <div className="space-y-3">
            <div>
              <label className="label">Token URL</label>
              <input name="auth_token_url" className="input" placeholder="https://vendor.com/oauth/token" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Client ID</label>
                <input name="auth_client_id" className="input" />
              </div>
              <div>
                <label className="label">Client secret</label>
                <input name="auth_client_secret" type="password" className="input" />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Context</h2>
        <div>
          <label className="label">What will you use this server for?</label>
          <textarea
            name="intended_use"
            className="input min-h-24"
            placeholder="Powering a customer-support agent that reads and replies to tickets on our behalf."
          />
          <p className="mt-1 text-xs text-slate-500">
            The audit is tailored to your intended use — the same server is low-stakes in a prototype
            and high-stakes in a customer-facing workflow.
          </p>
        </div>
        <div>
          <label className="label">Integration points (one per line)</label>
          <textarea
            name="integration_points"
            className="input min-h-24"
            placeholder={"Our support inbox (customer PII)\nOur billing system (payment records)\nSlack alerts to the on-call channel"}
          />
          <p className="mt-1 text-xs text-slate-500">
            Each point gets a tailored analysis of the data likely present and how the server will
            interact with it.
          </p>
        </div>
      </section>

      <Submit />
    </form>
  );
}
