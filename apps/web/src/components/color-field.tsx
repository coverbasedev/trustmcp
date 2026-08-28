"use client";

import { useId, useState } from "react";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Color input with a live swatch and a native color picker. The swatch circle
 * sits inside the text box and reflects the current value; clicking it opens the
 * OS color picker, and typing a hex value updates the swatch. Submits the hex via
 * the named text input so the existing form action is unchanged.
 */
export default function ColorField({
  name,
  label,
  defaultValue = "",
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue || "");
  const id = useId();
  const valid = HEX.test(value);
  const swatch = valid ? value : "#ffffff";

  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        {/* Swatch + hidden native color input (click the circle to open it). */}
        <span className="absolute left-2 top-1/2 -translate-y-1/2">
          <span
            className="block h-6 w-6 rounded-full border border-slate-300 shadow-sm"
            style={{ background: swatch, backgroundImage: valid ? undefined : "linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%)", backgroundSize: "8px 8px", backgroundPosition: "0 0,4px 4px" }}
          />
          <input
            type="color"
            aria-label={`${label} picker`}
            value={valid ? value : "#000000"}
            onChange={(e) => setValue(e.target.value)}
            className="absolute inset-0 h-6 w-6 cursor-pointer opacity-0"
          />
        </span>
        <input
          id={id}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="#0f172a"
          className="input"
          // Clear the swatch (left-2 + w-6 = ends at 2rem). Set inline because the
          // `.input` class is unlayered, so its `px-3` would beat a `pl-10` utility.
          style={{ paddingLeft: "2.5rem" }}
        />
      </div>
    </div>
  );
}
