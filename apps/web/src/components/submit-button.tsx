"use client";

import { useFormStatus } from "react-dom";

// Submit button that reflects the enclosing <form>'s pending state: on click it
// disables and swaps in a spinner so there's immediate feedback (e.g. while a
// sign-in email is sent or an OAuth redirect kicks in). The spinner uses
// border-current so it inherits the button's text color.
export function SubmitButton({
  className,
  children,
  pendingLabel = "Please wait…",
}: {
  className?: string;
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
