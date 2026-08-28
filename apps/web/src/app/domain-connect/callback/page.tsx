"use client";

import { useEffect, useState } from "react";

/**
 * Domain Connect redirect target. When a customer finishes (or cancels) the
 * synchronous apply flow in their DNS provider's popup, the provider redirects the
 * popup here. We relay the outcome to the opener (the custom-domain panel) and close.
 *
 * This route is intentionally outside the (app) auth group: it carries no secrets and
 * only needs to bounce a postMessage back to the same-origin opener.
 */
export default function DomainConnectCallback() {
  const [closable, setClosable] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error") || params.get("error_description");
    try {
      window.opener?.postMessage(
        { type: "trustmcp:domain-connect", state: params.get("state"), error: error || null },
        window.location.origin,
      );
    } catch {
      // Opener gone or cross-origin — the panel falls back to its popup-closed path.
    }
    window.close();
    // Browsers only allow script-closing of script-opened windows; if it didn't
    // close, leave a clear instruction.
    const t = setTimeout(() => setClosable(false), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-white px-6 text-center">
      <div className="space-y-2">
        <div className="text-lg font-semibold text-slate-900">DNS setup complete</div>
        <p className="text-sm text-slate-500">
          {closable
            ? "You can close this window and return to TrustMCP."
            : "Done — close this window and return to TrustMCP to verify your domain."}
        </p>
      </div>
    </main>
  );
}
