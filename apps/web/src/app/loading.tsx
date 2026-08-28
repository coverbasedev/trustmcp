import { TrustMark } from "@/components/logo";

// App-wide route loading UI: a centered, slowly rotating TrustMCP mark.
export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <TrustMark className="h-10 w-10 animate-spin text-slate-900 [animation-duration:1.4s]" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
