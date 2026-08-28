// The TrustMCP brand mark: a trust network rendered as three nodes held inside
// an anchor ring. Uses `currentColor` so it adapts to whatever context it sits
// in (white on the dark hero, accent on light surfaces, etc.). Keep this as the
// single source of truth for the logo across the app.

export function TrustMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="24" cy="24" r="20" />
      <circle cx="24" cy="14.5" r="8.5" />
      <circle cx="15.77" cy="28.75" r="8.5" />
      <circle cx="32.23" cy="28.75" r="8.5" />
      <circle cx="24" cy="24" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Mark + wordmark lockup. `tone` controls the wordmark letter color; the mark
// always inherits `currentColor` from the surrounding link/element.
export function Logo({
  className = "",
  markClassName = "h-7 w-7",
  wordmark = true,
}: {
  className?: string;
  markClassName?: string;
  wordmark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <TrustMark className={markClassName} />
      {wordmark && (
        <span className="text-[15px] font-semibold tracking-[0.2em]">TRUSTMCP</span>
      )}
    </span>
  );
}
