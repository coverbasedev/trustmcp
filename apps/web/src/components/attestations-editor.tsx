"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CLAIMS,
  CLAIM_DOMAINS,
  type ClaimTemplate,
  claimByKey,
  defaultValueFor,
} from "@/lib/attestation-claims";
import { Select, MultiSelect } from "@/components/select";

type ArtifactOpt = { id: string; title: string };

type Row = {
  key: string;
  label: string;
  type: ClaimTemplate["type"];
  options?: string[];
  // value stored loosely; serialized to the hidden input on submit
  value: boolean | string | string[];
  evidence: string[];
};

function valueToString(r: Row): string {
  if (r.type === "boolean") return r.value ? "true" : "false";
  if (r.type === "multiselect") return (r.value as string[]).join(",");
  return String(r.value ?? "");
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : "Save attestations"}
    </button>
  );
}

function initialRow(c: ClaimTemplate, value?: unknown, evidence?: string[]): Row {
  let v: boolean | string | string[] = defaultValueFor(c);
  if (value !== undefined && value !== null) {
    if (c.type === "boolean") v = value === true || value === "true";
    else if (c.type === "multiselect") v = Array.isArray(value) ? (value as string[]) : String(value).split(",").map((s) => s.trim()).filter(Boolean);
    else v = String(value);
  }
  return { key: c.key, label: c.label, type: c.type, options: c.options, value: v, evidence: evidence ?? [] };
}

export default function AttestationsEditor({
  initial,
  artifacts,
  action,
  autofillAction,
}: {
  initial: { key: string; value: unknown; evidence?: string[] }[];
  artifacts: ArtifactOpt[];
  action: (formData: FormData) => void;
  autofillAction: (formData: FormData) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial
      .filter((c) => c.key?.trim())
      .map((c) => {
        const tmpl = claimByKey(c.key) ?? { key: c.key, label: c.key, domain: "Custom", type: Array.isArray(c.value) ? "multiselect" : typeof c.value === "boolean" ? "boolean" : "text" as ClaimTemplate["type"] };
        return initialRow(tmpl as ClaimTemplate, c.value, c.evidence);
      }),
  );
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const selectedKeys = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return CLAIMS;
    return CLAIMS.filter(
      (c) => c.label.toLowerCase().includes(needle) || c.key.toLowerCase().includes(needle) || c.domain.toLowerCase().includes(needle),
    );
  }, [q]);

  function add(c: ClaimTemplate) {
    if (selectedKeys.has(c.key)) return;
    setRows((prev) => [...prev, initialRow(c)]);
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setValue(i: number, value: Row["value"]) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, value } : r)));
  }
  function setEvidence(i: number, ids: string[]) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, evidence: ids } : r)));
  }
  function toggleMulti(i: number, opt: string) {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const cur = r.value as string[];
        return { ...r, value: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
      }),
    );
  }

  return (
    <div className="space-y-4">
      {/* Auto-fill from a completed questionnaire */}
      <form action={autofillAction} className="card flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Auto-fill from a questionnaire</div>
          <p className="text-sm text-slate-500">
            Upload a completed questionnaire (CSV <span className="font-mono text-xs">key,value</span> or JSON
            <span className="font-mono text-xs"> {"{key: value}"}</span>). Recognized claims are added and
            set automatically.
          </p>
        </div>
        <input type="file" name="file" accept=".csv,.tsv,.json,.txt,text/csv,application/json" required className="text-sm" />
        <button className="btn-ghost" type="submit">Auto-fill</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          <span aria-hidden>+</span> Add attestation
        </button>
        <span className="text-sm text-slate-400">{rows.length} attestations</span>
      </div>

      <form action={action} className="space-y-3">
        {rows.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-400">
            No attestations yet — click <span className="font-medium text-slate-600">Add attestation</span> to pick from the catalog.
          </div>
        ) : (
          rows.map((row, i) => (
            <div key={row.key} className="card space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{row.label}</div>
                  <div className="font-mono text-[11px] text-slate-400">{row.key}</div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Remove attestation"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                >
                  ×
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Value control by type */}
                <div>
                  <span className="label text-xs">Value</span>
                  {row.type === "boolean" && (
                    <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
                      {[true, false].map((v) => (
                        <button
                          key={String(v)}
                          type="button"
                          onClick={() => setValue(i, v)}
                          className={
                            "px-4 py-1.5 text-sm font-medium transition " +
                            (row.value === v
                              ? v
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-700 text-white"
                              : "bg-white text-slate-600 hover:bg-slate-50")
                          }
                        >
                          {v ? "Yes" : "No"}
                        </button>
                      ))}
                    </div>
                  )}
                  {row.type === "enum" && (
                    <Select
                      ariaLabel={row.label}
                      value={String(row.value)}
                      onChange={(v) => setValue(i, v)}
                      options={(row.options ?? []).map((o) => ({ value: o, label: o }))}
                    />
                  )}
                  {row.type === "multiselect" && (
                    <div className="flex flex-wrap gap-2">
                      {(row.options ?? []).map((o) => {
                        const on = (row.value as string[]).includes(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            onClick={() => toggleMulti(i, o)}
                            className={
                              "rounded-full border px-3 py-1 text-xs transition " +
                              (on ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")
                            }
                          >
                            {on ? "✓ " : ""}{o}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {row.type === "number" && (
                    <input type="number" value={String(row.value)} onChange={(ev) => setValue(i, ev.target.value)} className="input" />
                  )}
                  {row.type === "text" && (
                    <input value={String(row.value)} onChange={(ev) => setValue(i, ev.target.value)} className="input" />
                  )}
                </div>

                {/* Evidence: select from the list of uploaded artifacts */}
                <div>
                  <span className="label text-xs">Evidence (select uploaded artifacts)</span>
                  {artifacts.length === 0 ? (
                    <p className="text-xs text-slate-400">No artifacts uploaded yet.</p>
                  ) : (
                    <MultiSelect
                      ariaLabel="Evidence"
                      placeholder="Select evidence…"
                      value={row.evidence}
                      onChange={(ids) => setEvidence(i, ids)}
                      options={artifacts.map((a) => ({ value: a.id, label: a.title }))}
                    />
                  )}
                </div>
              </div>

              {/* Hidden inputs for saveAttestations (parallel arrays). */}
              <input type="hidden" name="key" value={row.key} />
              <input type="hidden" name="value" value={valueToString(row)} />
              <input type="hidden" name="evidence" value={row.evidence.join(",")} />
            </div>
          ))
        )}
        <SaveButton />
      </form>

      {/* Catalog modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={(ev) => ev.target === ev.currentTarget && setOpen(false)}
        >
          <div className="ui-90 my-8 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Add an attestation</h2>
                <p className="text-sm text-slate-500">{CLAIMS.length} claims across {CLAIM_DOMAINS.length} risk domains.</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50">
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <input
              autoFocus
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="Search claims (e.g. MFA, encryption, GDPR, backups)…"
              className="input mb-3"
            />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              {CLAIM_DOMAINS.map((dom) => {
                const items = filtered.filter((c) => c.domain === dom);
                if (items.length === 0) return null;
                return (
                  <div key={dom}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{dom}</div>
                    <div className="space-y-1">
                      {items.map((c) => {
                        const added = selectedKeys.has(c.key);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            disabled={added}
                            onClick={() => add(c)}
                            className={
                              "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition " +
                              (added ? "cursor-default border-emerald-200 bg-emerald-50 text-slate-500" : "border-slate-200 hover:border-slate-400 hover:bg-slate-50")
                            }
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-slate-800">{c.label}</span>
                              <span className="block font-mono text-[11px] text-slate-400">
                                {c.key} · {c.type}
                              </span>
                            </span>
                            <span className={added ? "text-emerald-600" : "text-slate-300"} aria-hidden>{added ? "✓" : "+"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setOpen(false)} className="btn-primary">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
