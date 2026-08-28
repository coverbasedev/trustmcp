"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

// Catches React render errors that escape the root layout. Unlike error.tsx
// (which renders inside the layout), global-error replaces the whole document,
// so it must supply its own <html>/<body>. Reports to Sentry (no-op without a DSN).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-md py-16 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            An unexpected error occurred. You can try again.
          </p>
          {error.digest && <p className="mt-1 text-xs text-slate-400">ref: {error.digest}</p>}
          <button className="btn-primary mt-5" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
