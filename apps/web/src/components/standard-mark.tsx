"use client";

import { useState } from "react";
import { acronymFor, frameworkLogo } from "@/lib/compliance-frameworks";

/**
 * The logo/acronym chip for a compliance standard. Prefers a custom logo URL
 * (custom standards only), then the bundled out-of-the-box logo, and falls back
 * to a circular acronym icon if there's no logo or the image fails to load.
 */
export function StandardMark({
  name,
  code,
  logoUrl,
  size = 36,
}: {
  name: string;
  code?: string | null;
  logoUrl?: string | null;
  size?: number;
}) {
  const src = logoUrl || frameworkLogo(code);
  const [errored, setErrored] = useState(false);
  const dim = { height: size, width: size };

  if (src && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={() => setErrored(true)}
        className="shrink-0 rounded object-contain"
        style={dim}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-500"
      style={dim}
    >
      {acronymFor(name, code)}
    </span>
  );
}
