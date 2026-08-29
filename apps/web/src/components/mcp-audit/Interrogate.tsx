"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { interrogate, type InterrogateState } from "@/app/(app)/audit/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Thinking…" : "Ask"}
    </button>
  );
}

/** The interaction layer: ask a follow-up against a completed scan. The engine
 *  answers from the evidence and may propose fresh dynamic probes to run live. */
export function Interrogate({ scanId }: { scanId: string }) {
  const [state, action] = useActionState<InterrogateState, FormData>(
    interrogate.bind(null, scanId),
    {},
  );
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input
          name="question"
          className="input flex-1"
          placeholder="e.g. Could the search tool leak another tenant's records?"
        />
        <Submit />
      </form>
      {state.error && <div className="banner-error">{state.error}</div>}
      {state.answer && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="whitespace-pre-wrap text-slate-800">{state.answer}</p>
          {state.probes && state.probes.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-xs font-medium uppercase text-slate-400">Suggested probes</div>
              {state.probes.map((p, i) => (
                <div key={i} className="rounded border border-slate-200 bg-white p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700">{p.hypothesis}</span>
                    <span className={`badge ${p.safety === "read_only" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {p.safety === "read_only" ? "read-only" : "review only"}
                    </span>
                  </div>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-600">{p.prompt}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
