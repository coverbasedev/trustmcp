"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createTrustCenter, type CreateTrustCenterState } from "@/app/(app)/dashboard/actions";

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
          Creating…
        </>
      ) : (
        "Create trust center"
      )}
    </button>
  );
}

/**
 * Opens a modal to create a new trust center. Replaces the old inline form: the
 * "+ New trust center" button is the only entry point, and clicking it clearly
 * starts the creation flow. Supports any number of product lines.
 */
export default function NewTrustCenterModal({
  className = "btn-primary",
  label = "New trust center",
  defaultOpen = false,
}: {
  className?: string;
  label?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [products, setProducts] = useState<string[]>([""]);
  const [state, formAction] = useActionState<CreateTrustCenterState, FormData>(
    createTrustCenter,
    {},
  );

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function updateProduct(i: number, value: string) {
    setProducts((prev) => prev.map((p, idx) => (idx === i ? value : p)));
  }
  function addProduct() {
    setProducts((prev) => [...prev, ""]);
  }
  function removeProduct(i: number) {
    setProducts((prev) => (prev.length === 1 ? [""] : prev.filter((_, idx) => idx !== i)));
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <span aria-hidden>+</span> {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="ui-90 mt-12 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">New trust center</h2>
                <p className="text-sm text-slate-500">
                  Publishes a vendor profile to the network and opens the builder.
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

            {state?.error && <div className="banner-error mb-4">{state.error}</div>}

            <form action={formAction} className="space-y-4">
              <div>
                <label className="label" htmlFor="legal_name">Legal name</label>
                <input id="legal_name" name="legal_name" required className="input" placeholder="Acme Corp" />
              </div>

              <div>
                <span className="label">Product lines (optional)</span>
                <div className="space-y-2">
                  {products.map((value, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        name="products"
                        value={value}
                        onChange={(e) => updateProduct(i, e.target.value)}
                        className="input"
                        placeholder={i === 0 ? "Acme Platform" : "Another product"}
                      />
                      <button
                        type="button"
                        onClick={() => removeProduct(i)}
                        aria-label="Remove product line"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addProduct}
                  className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-500"
                >
                  + Add another product
                </button>
              </div>

              <div>
                <label className="label" htmlFor="domain">Primary domain (optional)</label>
                <input id="domain" name="domain" className="input" placeholder="acme.com" />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <CreateButton />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
