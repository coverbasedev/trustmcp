"use client";

import { useState } from "react";
import type { Product } from "@trustmcp/sdk";

type Row = { id: string; name: string };

/**
 * Edits a vendor's product lines inside the branding form. Each row contributes
 * a hidden `product_id` (empty for new lines) and a `product_name` to the parent
 * form, which the saveBranding action zips back into the products list. Removing
 * a row drops the product line on save; documents associated only with it are
 * unassociated server-side.
 */
export default function ProductLinesEditor({ initial }: { initial: Product[] }) {
  const [rows, setRows] = useState<Row[]>(
    initial.length ? initial.map((p) => ({ id: p.id, name: p.name })) : [],
  );

  function add() {
    setRows((prev) => [...prev, { id: "", name: "" }]);
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function update(i: number, name: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, name } : r)));
  }

  return (
    <div>
      <span className="label">Product lines</span>
      <p className="-mt-1 mb-2 text-xs text-slate-400">
        Add any number of products. You can associate each document with specific products
        on the Resources tab.
      </p>
      {rows.length === 0 ? (
        <p className="mb-2 text-sm text-slate-400">No product lines yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="hidden" name="product_id" value={row.id} />
              <input
                name="product_name"
                value={row.name}
                onChange={(e) => update(i, e.target.value)}
                className="input"
                placeholder="Product name"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove product line"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={add}
        className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-500"
      >
        + Add product line
      </button>
    </div>
  );
}
