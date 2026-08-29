"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveClause, type ClauseFormState } from "@/app/(app)/audit/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add clause"}
    </button>
  );
}

export function ClauseForm({ dimensions }: { dimensions: { id: string; name: string }[] }) {
  const [state, action] = useActionState<ClauseFormState, FormData>(saveClause, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <div className="banner-error">{state.error}</div>}
      {state.ok && <div className="banner-success">{state.ok}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Risk dimension</label>
          <select name="dimension" className="input" defaultValue={dimensions[0]?.id}>
            {dimensions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Clause title</label>
          <input name="title" className="input" placeholder="No production-data deletion without confirmation" />
        </div>
      </div>
      <div>
        <label className="label">What a compliant server looks like</label>
        <textarea
          name="intent"
          className="input min-h-20"
          placeholder="No tool can delete records in a production system without a confirmation argument or a dry-run mode."
        />
      </div>
      <Submit />
    </form>
  );
}
