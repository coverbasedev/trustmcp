"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CONTROL_CATEGORIES,
  CONTROL_LIBRARY,
  type LibraryControl,
} from "@/lib/controls-library";

/**
 * "Add from controls library" — a searchable modal of standard security controls
 * grouped by category. Select any number and they're appended to the control list
 * (de-duped) via the addLibraryControls action, so owners don't have to hand-type
 * common controls. Mirrors the Compliance catalog and Questionnaire picker.
 */
export default function ControlsLibraryPicker({
  action,
}: {
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const byId = useMemo(() => new Map(CONTROL_LIBRARY.map((c) => [c.id, c])), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? CONTROL_LIBRARY.filter((c) =>
          `${c.name} ${c.category} ${c.description}`.toLowerCase().includes(q),
        )
      : CONTROL_LIBRARY;
    const groups = new Map<string, LibraryControl[]>();
    for (const c of matches) {
      const list = groups.get(c.category) ?? [];
      list.push(c);
      groups.set(c.category, list);
    }
    // Keep the canonical category order.
    return CONTROL_CATEGORIES.filter((cat) => groups.has(cat)).map((cat) => ({
      category: cat,
      items: groups.get(cat)!,
    }));
  }, [query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const g of filtered) for (const c of g.items) next.add(c.id);
      return next;
    });
  }

  const count = selected.size;

  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        <span aria-hidden>+</span> Add from controls library
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="ui-90 mt-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Controls library</h2>
                <p className="text-sm text-slate-500">
                  Search {CONTROL_LIBRARY.length} standard controls and add the ones you operate.
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

            <div className="mb-3 flex items-center gap-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input"
                placeholder="Search controls (e.g. encryption, MFA, backups)…"
              />
              <button type="button" className="btn-ghost whitespace-nowrap" onClick={selectAllVisible}>
                Select all
              </button>
            </div>

            <div className="-mx-2 flex-1 space-y-4 overflow-y-auto px-2">
              {filtered.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">No controls match “{query}”.</p>
              )}
              {filtered.map((group) => (
                <div key={group.category}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {group.category}
                  </h3>
                  <div className="space-y-1">
                    {group.items.map((c) => {
                      const checked = selected.has(c.id);
                      return (
                        <label
                          key={c.id}
                          className={
                            "flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm transition " +
                            (checked
                              ? "border-brand-300 bg-brand-50"
                              : "border-slate-200 hover:bg-slate-50")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(c.id)}
                            className="mt-0.5 h-4 w-4"
                          />
                          <span>
                            <span className="font-medium text-slate-900">{c.name}</span>
                            {c.description && (
                              <span className="block text-xs text-slate-500">{c.description}</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <form action={action} className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
              {[...selected].map((id) => {
                const c = byId.get(id);
                if (!c) return null;
                return (
                  <span key={id} className="hidden">
                    <input type="hidden" name="category" value={c.category} />
                    <input type="hidden" name="name" value={c.name} />
                    <input type="hidden" name="description" value={c.description} />
                  </span>
                );
              })}
              <span className="text-sm text-slate-500">
                {count} control{count === 1 ? "" : "s"} selected
              </span>
              <button
                type="submit"
                className="btn-primary"
                disabled={count === 0}
                onClick={() => setOpen(false)}
              >
                Add {count > 0 ? count : ""} control{count === 1 ? "" : "s"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
