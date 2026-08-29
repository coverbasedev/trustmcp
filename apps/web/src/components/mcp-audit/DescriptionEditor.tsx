"use client";

import { useState, useTransition } from "react";
import { updateScanDescription } from "@/app/(app)/audit/actions";

/** Editable description for a scan. Shown on the report and used as the blurb when
 *  the scan is published to a trust center (vendor self-scans). */
export function DescriptionEditor({
  scanId,
  initial,
}: {
  scanId: string;
  initial: string | null;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2">
      <textarea
        className="input min-h-20"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder="Add a description for this scan — shown on the public page when you publish it to a trust center."
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await updateScanDescription(scanId, value);
              setSaved(true);
            })
          }
        >
          {pending ? "Saving…" : "Save description"}
        </button>
        {saved && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
    </div>
  );
}
