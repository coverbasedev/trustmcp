"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  FRAMEWORKS,
  FRAMEWORK_CATEGORIES,
  frameworkByCode,
} from "@/lib/compliance-frameworks";
import { StandardMark } from "@/components/standard-mark";
import { Select } from "@/components/select";

type Row = {
  code: string;
  name: string;
  logo_url: string;
  issued_on: string;
  valid_until: string;
  access: string;
  evidence: { id: string; title: string; access?: string } | null;
};

type ArtifactOpt = { id: string; title: string };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : "Save compliance"}
    </button>
  );
}

export default function ComplianceEditor({
  initial,
  artifacts,
  action,
}: {
  initial: {
    name: string;
    standard?: string | null;
    logo_url?: string | null;
    evidence_artifact_id?: string | null;
    evidence?: { id: string; title: string; access?: string } | null;
    issued_on?: string | null;
    valid_until?: string | null;
  }[];
  artifacts: ArtifactOpt[];
  action: (formData: FormData) => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    initial
      .filter((b) => b.name?.trim())
      .map((b) => ({
        code: b.standard ?? "",
        name: b.name,
        logo_url: b.logo_url ?? "",
        issued_on: b.issued_on ?? "",
        valid_until: b.valid_until ?? "",
        access: b.evidence?.access ?? "key_required",
        evidence: b.evidence ?? null,
      })),
  );
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState<number | null>(null);
  const [dragRow, setDragRow] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const selectedCodes = new Set(rows.map((r) => r.code).filter(Boolean));
  const blank = { logo_url: "", issued_on: "", valid_until: "", access: "key_required", evidence: null };

  function addFramework(code: string) {
    const fw = frameworkByCode(code);
    if (!fw || selectedCodes.has(code)) return;
    setRows((prev) => [...prev, { code: fw.code, name: fw.name, ...blank }]);
  }
  function addCustom() {
    setRows((prev) => [...prev, { code: "", name: "", ...blank }]);
    setCustomizing(rows.length);
    setOpen(false);
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  // Drag-and-drop: drop files onto a standard to auto-upload them as evidence.
  function onDrop(i: number, e: React.DragEvent) {
    e.preventDefault();
    setDragRow(null);
    const files = e.dataTransfer?.files;
    const input = fileRefs.current[i];
    if (!files || files.length === 0 || !input) return;
    const dt = new DataTransfer();
    Array.from(files).forEach((f) => dt.items.add(f));
    input.files = dt.files;
    // Save immediately — uploads the dropped evidence with the row's dates/visibility.
    formRef.current?.requestSubmit();
  }

  return (
    <div className="space-y-4">
      {/* Primary action — prominent, at the top. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          <span aria-hidden>+</span> Add compliance standard
        </button>
        <span className="text-sm text-slate-400">{rows.length} selected</span>
      </div>

      <form ref={formRef} action={action} className="space-y-3">
        {rows.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-400">
            No standards yet — click <span className="font-medium text-slate-600">Add compliance standard</span> to choose from the catalog.
          </div>
        ) : (
          rows.map((row, i) => (
            <div key={i} className="card space-y-3">
              <div className="flex items-center gap-3">
                <StandardMark name={row.name} code={row.code} logoUrl={row.logo_url} />
                <input
                  name="name"
                  value={row.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Standard name (e.g. SOC 2 Type II)"
                  className="input flex-1"
                />
                {/* Custom logo only for custom standards (OOTB use bundled logos). */}
                {!row.code && (
                  <button
                    type="button"
                    onClick={() => setCustomizing(customizing === i ? null : i)}
                    className="btn-ghost text-xs"
                  >
                    Logo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Remove standard"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                >
                  ×
                </button>
              </div>

              {!row.code && customizing === i && (
                <div className="pl-12">
                  <label className="label text-xs">Custom logo URL (optional)</label>
                  <input
                    value={row.logo_url}
                    onChange={(e) => update(i, { logo_url: e.target.value })}
                    placeholder="https://…/logo.svg — leave blank to use the acronym icon"
                    className="input"
                  />
                </div>
              )}

              {/* Validity + visibility */}
              <div className="grid gap-3 pl-12 sm:grid-cols-3">
                <div>
                  <label className="label text-xs">Issued / attained</label>
                  <input
                    type="date"
                    name="issued_on"
                    value={row.issued_on}
                    onChange={(e) => update(i, { issued_on: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label text-xs">Valid until</label>
                  <input
                    type="date"
                    name="valid_until"
                    value={row.valid_until}
                    onChange={(e) => update(i, { valid_until: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label text-xs">Evidence visibility</label>
                  <Select
                    name="access"
                    ariaLabel="Evidence visibility"
                    value={row.access}
                    onChange={(v) => update(i, { access: v })}
                    options={[
                      { value: "key_required", label: "Private (request required)" },
                      { value: "public", label: "Public" },
                    ]}
                  />
                </div>
              </div>

              {/* Evidence: drag-drop drop zone (auto-uploads) + existing link */}
              <div className="grid gap-3 pl-12 sm:grid-cols-2">
                <div>
                  <span className="label text-xs">Evidence</span>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragRow(i);
                    }}
                    onDragLeave={() => setDragRow((r) => (r === i ? null : r))}
                    onDrop={(e) => onDrop(i, e)}
                    className={
                      "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs transition " +
                      (dragRow === i
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50")
                    }
                  >
                    <svg className="mb-1 h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                    </svg>
                    <span className="font-medium">Drag &amp; drop evidence here</span>
                    <span>or click to browse — uploads automatically</span>
                    <input
                      ref={(el) => {
                        fileRefs.current[i] = el;
                      }}
                      type="file"
                      name={`evidence_file_${i}`}
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) formRef.current?.requestSubmit();
                      }}
                    />
                  </label>
                </div>
                <div>
                  <label className="label text-xs">…or link existing evidence</label>
                  <Select
                    ariaLabel="Link existing evidence"
                    value={row.evidence?.id ?? ""}
                    onChange={(v) =>
                      update(i, {
                        evidence: v
                          ? { id: v, title: artifacts.find((a) => a.id === v)?.title ?? "" }
                          : null,
                      })
                    }
                    options={[
                      { value: "", label: "No evidence linked" },
                      ...artifacts.map((a) => ({ value: a.id, label: a.title })),
                    ]}
                  />
                  {row.evidence && (
                    <p className="mt-1 text-xs text-emerald-600">✓ Linked: {row.evidence.title}</p>
                  )}
                </div>
              </div>

              {/* Hidden inputs consumed by saveBadges (parallel arrays). */}
              <input type="hidden" name="standard" value={row.code} />
              <input type="hidden" name="logo_url" value={row.logo_url} />
              <input type="hidden" name="evidence_artifact_id" value={row.evidence?.id ?? ""} />
            </div>
          ))
        )}

        <SaveButton />
      </form>

      {/* Catalog modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="ui-90 my-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Add a compliance standard</h2>
                <p className="text-sm text-slate-500">
                  Pick from common frameworks and certifications, or add a custom one.
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

            <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
              {FRAMEWORK_CATEGORIES.map((cat) => {
                const items = FRAMEWORKS.filter((f) => f.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {cat}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((f) => {
                        const added = selectedCodes.has(f.code);
                        return (
                          <button
                            key={f.code}
                            type="button"
                            disabled={added}
                            onClick={() => addFramework(f.code)}
                            className={
                              "flex items-center gap-2.5 rounded-lg border p-3 text-left transition " +
                              (added
                                ? "cursor-default border-emerald-200 bg-emerald-50"
                                : "border-slate-200 hover:border-slate-400 hover:bg-slate-50")
                            }
                          >
                            <StandardMark name={f.name} code={f.code} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-800">{f.name}</span>
                              <span className="block text-xs text-slate-400">{added ? "Added" : "Add"}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <button type="button" onClick={addCustom} className="btn-ghost">
                + Custom standard
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
