"use client";

import { useState } from "react";

/** Copy-to-clipboard button for a pending invite link. Lets owners share the
 * invite even when SMTP isn't configured (or the email landed in spam). */
export function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard API unavailable (e.g. non-secure context) - select fallback.
          window.prompt("Copy invite link", url);
        }
      }}
    >
      {copied ? "Copied!" : "Copy invite link"}
    </button>
  );
}
