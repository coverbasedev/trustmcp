"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveCredential, type CredentialFormState } from "@/app/(app)/audit/actions";

const CATALOG: Record<string, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-5.1", label: "GPT-5.1" },
    { id: "gpt-5.1-mini", label: "GPT-5.1 mini" },
    { id: "gpt-5.1-nano", label: "GPT-5.1 nano" },
  ],
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Verifying…" : "Save credential"}
    </button>
  );
}

export function CredentialForm() {
  const [state, action] = useActionState<CredentialFormState, FormData>(saveCredential, {});
  const [provider, setProvider] = useState("anthropic");

  return (
    <form action={action} className="space-y-4">
      {state.error && <div className="banner-error">{state.error}</div>}
      {state.ok && <div className="banner-success">{state.ok}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Provider</label>
          <select
            name="provider"
            className="input"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div>
          <label className="label">Default model</label>
          <select name="model" className="input" defaultValue={CATALOG[provider][0].id}>
            {CATALOG[provider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">API key</label>
        <input name="api_key" type="password" className="input" placeholder="sk-… / sk-ant-…" required />
        <p className="mt-1 text-xs text-slate-500">
          Encrypted at rest and used only server-side by the scan engine. Never returned to the browser.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Label (optional)</label>
          <input name="label" className="input" placeholder="Team OpenAI key" />
        </div>
        <div>
          <label className="label">Base URL override (optional)</label>
          <input name="base_url" className="input" placeholder="https://api.openai.com/v1" />
        </div>
      </div>
      <Submit />
    </form>
  );
}
