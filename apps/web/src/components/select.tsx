"use client";

import { useEffect, useRef, useState } from "react";

export type SelectOption = { value: string; label: string };

/** Close an open menu on outside pointer-down or Escape. Shared by the dropdowns. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

/** Chevron used by both dropdowns; rotates when the menu is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * App-wide custom dropdown that replaces the native <select> so menus are styled
 * consistently (the native control can't be themed cross-browser). Works two
 * ways:
 *  - Form mode: pass `name` (+ optional `defaultValue`). A hidden input carries
 *    the value so it submits with the surrounding <form> server action.
 *  - Controlled mode: pass `value` + `onChange` for client-managed state.
 * Closes on outside click or Escape, like every other dropdown in the app.
 */
export function Select({
  options,
  name,
  value: controlledValue,
  defaultValue,
  onChange,
  id,
  className = "input",
  placeholder = "Select…",
  ariaLabel,
  disabled,
}: {
  options: SelectOption[];
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const isControlled = controlledValue !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const value = isControlled ? controlledValue : internal;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);

  const selected = options.find((o) => o.value === value);

  function choose(v: string) {
    if (!isControlled) setInternal(v);
    onChange?.(v);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`${className} flex cursor-pointer items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-30 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => choose(o.value)}
                  className={`block w-full rounded px-3 py-2 text-left hover:bg-slate-100 ${
                    active ? "bg-slate-50 font-medium text-slate-900" : "text-slate-700"
                  }`}
                >
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Custom multi-select replacing a native <select multiple>. Controlled only:
 * pass `value` (array) + `onChange`. The menu stays open while you toggle
 * options (checkbox-style), and closes on outside click or Escape like Select.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  id,
  className = "input",
  placeholder = "Select…",
  ariaLabel,
  disabled,
}: {
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);

  const selected = options.filter((o) => value.includes(o.value));

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`${className} flex cursor-pointer items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected.length ? "" : "text-slate-400"}`}>
          {selected.length ? selected.map((s) => s.label).join(", ") : placeholder}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-multiselectable
          className="absolute left-0 z-30 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg"
        >
          {options.map((o) => {
            const active = value.includes(o.value);
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => toggle(o.value)}
                  className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-slate-100 ${
                    active ? "bg-slate-50 font-medium text-slate-900" : "text-slate-700"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${
                      active ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
