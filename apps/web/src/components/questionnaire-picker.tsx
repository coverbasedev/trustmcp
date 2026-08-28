"use client";

import { useEffect, useState } from "react";
import { QUESTIONNAIRE_TEMPLATES } from "@/lib/questionnaire-templates";

/**
 * "Add standardized questionnaire" — a modal of template cards (CAIQ, SIG Lite,
 * VSA, HECVAT, …). Selecting one or more creates a "Questionnaires"-category
 * artifact for each via the addQuestionnaires action; the owner then uploads the
 * completed copy from the resource list below. A custom questionnaire takes a
 * free-form name.
 */
export default function QuestionnairePicker({
  action,
}: {
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  // Selected standard templates by code, plus any custom-named entries.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customs, setCustoms] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  const standard = QUESTIONNAIRE_TEMPLATES.filter((q) => q.code !== "custom");
  const customTemplate = QUESTIONNAIRE_TEMPLATES.find((q) => q.code === "custom")!;
  const count = selected.size + customs.filter((c) => c.trim()).length;

  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        <span aria-hidden>+</span> Add standardized questionnaire
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="ui-90 my-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Add a standardized questionnaire</h2>
                <p className="text-sm text-slate-500">
                  Pick from common templates. Each is added under “Questionnaires”; upload your
                  completed copy from the list afterward.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form action={action}>
              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                <div className="grid gap-2 sm:grid-cols-2">
                  {standard.map((q) => {
                    const on = selected.has(q.code);
                    return (
                      <button
                        key={q.code}
                        type="button"
                        onClick={() => toggle(q.code)}
                        className={
                          "flex items-start gap-2.5 rounded-lg border p-3 text-left transition " +
                          (on
                            ? "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200"
                            : "border-slate-200 hover:border-slate-400 hover:bg-slate-50")
                        }
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                          {q.short}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800">{q.name}</span>
                          <span className="block text-xs text-slate-400">{q.description}</span>
                        </span>
                        <span className={"mt-0.5 text-sm " + (on ? "text-emerald-600" : "text-slate-300")} aria-hidden>
                          {on ? "✓" : "+"}
                        </span>
                        {on && <input type="hidden" name="code" value={q.code} />}
                        {on && <input type="hidden" name="name" value={q.name} />}
                      </button>
                    );
                  })}
                </div>

                {/* Custom questionnaires */}
                <div className="rounded-lg border border-dashed border-slate-300 p-3">
                  <div className="text-sm font-medium text-slate-700">{customTemplate.name}</div>
                  <p className="mb-2 text-xs text-slate-400">{customTemplate.description}</p>
                  {customs.map((c, i) => (
                    <div key={i} className="mb-2 flex items-center gap-2">
                      <input
                        value={c}
                        onChange={(e) =>
                          setCustoms((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                        }
                        placeholder="Questionnaire name (e.g. Acme Control Framework)"
                        className="input"
                      />
                      {c.trim() && <input type="hidden" name="code" value="custom" />}
                      {c.trim() && <input type="hidden" name="name" value={c.trim()} />}
                      <button
                        type="button"
                        onClick={() => setCustoms((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label="Remove"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustoms((prev) => [...prev, ""])}
                    className="text-sm font-medium text-brand-600 hover:text-brand-500"
                  >
                    + Add custom questionnaire
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-sm text-slate-400">{count} selected</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={count === 0}>
                    Add {count > 0 ? count : ""} questionnaire{count === 1 ? "" : "s"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
