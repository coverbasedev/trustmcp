"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
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
  );
}
