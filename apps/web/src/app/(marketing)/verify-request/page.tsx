import { TrustMark } from "@/components/logo";

// Shown right after a sign-in link is requested (Auth.js pages.verifyRequest).
export default function VerifyRequestPage() {
  return (
    <div className="mx-auto flex min-h-[68vh] w-full max-w-[26rem] flex-col justify-center py-10">
      <div className="rounded-2xl border border-slate-200 bg-white px-8 pb-8 pt-9 text-center shadow-[0_10px_40px_-12px_rgba(15,23,42,0.18)]">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          Click the link in the email to sign in. You can close this window.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          The link expires shortly. Didn&apos;t get it? Check spam, or{" "}
          <a href="/login" className="font-medium text-brand-600 hover:underline">
            request a new one
          </a>
          .
        </p>
      </div>
      <div className="mt-6 flex justify-center">
        <TrustMark className="h-6 w-6 text-slate-300" />
      </div>
    </div>
  );
}
