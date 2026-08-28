import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, auth, devLoginEnabled } from "@/auth";
import { TrustMark } from "@/components/logo";
import { SubmitButton } from "@/components/submit-button";

// Cookie remembering the last sign-in method used on this browser, so we can hint
// "Last used" next to it (like enterprise SSO screens). Set in each form action.
const LAST_METHOD_COOKIE = "trustmcp_last_method";

async function rememberMethod(method: string) {
  "use server";
  (await cookies()).set(LAST_METHOD_COOKIE, method, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

function LastUsedPill() {
  return (
    <span className="pointer-events-none absolute -top-2 right-3 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 shadow-sm">
      Last used
    </span>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

// Human-readable copy for the Auth.js ?error= codes we can land back on /login with.
const ERROR_COPY: Record<string, string> = {
  OAuthAccountNotLinked:
    "That email is already registered with a different sign-in method. Use the method you signed up with.",
  OAuthSignin: "Couldn't start sign-in with that provider. Please try again.",
  OAuthCallback: "Sign-in with that provider failed. Please try again.",
  EmailSignin: "We couldn't send your sign-in email. Check the address and try again.",
  Verification: "That sign-in link is invalid or has expired - request a new one.",
  AccessDenied: "Access was denied.",
  Configuration: "Sign-in isn't configured correctly. Please contact the administrator.",
};

const oauthButton =
  "flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50";
const continueButton =
  "flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-zinc-700 to-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-zinc-600 hover:to-zinc-800";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error } = await searchParams;
  const errorMessage = error
    ? ERROR_COPY[error] ?? "Something went wrong signing in. Please try again."
    : null;

  const lastMethod = (await cookies()).get(LAST_METHOD_COOKIE)?.value ?? null;

  const hasGitHub = !!process.env.AUTH_GITHUB_ID;
  const hasGoogle = !!process.env.AUTH_GOOGLE_ID;
  const hasSSO = !!process.env.SSO_ISSUER && !!process.env.SSO_CLIENT_ID;
  const ssoName = process.env.SSO_NAME ?? "Enterprise SSO";
  const hasEmail = !!process.env.EMAIL_SERVER && !!process.env.EMAIL_FROM;
  const devLogin = devLoginEnabled();

  const hasSocial = hasGitHub || hasGoogle || hasSSO;
  const noneConfigured = !hasSocial && !hasEmail && !devLogin;

  return (
    <div className="ui-90 mx-auto flex min-h-[68vh] w-full max-w-[26rem] flex-col justify-center py-10">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_40px_-12px_rgba(15,23,42,0.18)]">
        <div className="px-8 pb-8 pt-9">
          <div className="flex flex-col items-center text-center">
            <TrustMark className="h-11 w-11 text-zinc-900" />
            <h1 className="mt-4 text-xl font-semibold text-slate-900">Sign in to TrustMCP</h1>
            <p className="mt-1 text-sm text-slate-500">Welcome back! Please sign in to continue</p>
          </div>

          {errorMessage && (
            <div className="banner-error mt-6" role="alert">
              {errorMessage}
            </div>
          )}

          {hasSocial && (
            <div className="mt-7 space-y-3">
              {hasGoogle && (
                <div className="relative">
                  <form
                    action={async () => {
                      "use server";
                      await rememberMethod("google");
                      await signIn("google", { redirectTo: "/dashboard" });
                    }}
                  >
                    <SubmitButton className={oauthButton} pendingLabel="Redirecting…">
                      <GoogleIcon /> Continue with Google
                    </SubmitButton>
                  </form>
                  {lastMethod === "google" && <LastUsedPill />}
                </div>
              )}
              {hasGitHub && (
                <div className="relative">
                  <form
                    action={async () => {
                      "use server";
                      await rememberMethod("github");
                      await signIn("github", { redirectTo: "/dashboard" });
                    }}
                  >
                    <SubmitButton className={oauthButton} pendingLabel="Redirecting…">
                      <GitHubIcon /> Continue with GitHub
                    </SubmitButton>
                  </form>
                  {lastMethod === "github" && <LastUsedPill />}
                </div>
              )}
              {hasSSO && (
                <div className="relative">
                  <form
                    action={async () => {
                      "use server";
                      await rememberMethod("sso");
                      await signIn("sso", { redirectTo: "/dashboard" });
                    }}
                  >
                    <SubmitButton className={oauthButton} pendingLabel="Redirecting…">
                      Continue with {ssoName}
                    </SubmitButton>
                  </form>
                  {lastMethod === "sso" && <LastUsedPill />}
                </div>
              )}
            </div>
          )}

          {hasSocial && (hasEmail || devLogin) && (
            <div className="my-6 flex items-center gap-4">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-medium text-slate-400">or</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          )}

          {hasEmail && (
            <form
              action={async (formData: FormData) => {
                "use server";
                await rememberMethod("email");
                try {
                  await signIn("nodemailer", {
                    email: String(formData.get("email") ?? ""),
                    redirectTo: "/dashboard",
                  });
                } catch (err) {
                  // On success signIn throws a redirect to /verify-request (re-thrown
                  // below); only a real failure is an AuthError we surface on /login.
                  if (err instanceof AuthError) redirect(`/login?error=${err.type}`);
                  throw err;
                }
              }}
              className={hasSocial ? "space-y-3" : "mt-7 space-y-3"}
            >
              <div>
                <label className="label flex items-center justify-between" htmlFor="signin-email">
                  <span>Email address</span>
                  {lastMethod === "email" && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      Last used
                    </span>
                  )}
                </label>
                <input
                  id="signin-email"
                  name="email"
                  type="email"
                  required
                  className="input"
                  placeholder="Enter your email address"
                />
              </div>
              <SubmitButton className={continueButton} pendingLabel="Sending link…">
                Continue <span aria-hidden>›</span>
              </SubmitButton>
              <p className="text-center text-xs text-slate-400">
                We&apos;ll email you a secure sign-in link.
              </p>
            </form>
          )}

          {devLogin && (
            <form
              action={async (formData: FormData) => {
                "use server";
                await rememberMethod("dev");
                try {
                  await signIn("dev", {
                    email: String(formData.get("email") ?? ""),
                    redirectTo: "/dashboard",
                  });
                } catch (err) {
                  if (err instanceof AuthError) redirect(`/login?error=${err.type}`);
                  throw err;
                }
              }}
              className={hasSocial || hasEmail ? "mt-5 space-y-3 border-t border-dashed border-slate-200 pt-5" : "mt-7 space-y-3"}
            >
              <div>
                <label className="label" htmlFor="dev-email">Email (dev login)</label>
                <input
                  id="dev-email"
                  name="email"
                  type="email"
                  required
                  className="input"
                  placeholder="you@company.com"
                />
              </div>
              <SubmitButton className={continueButton} pendingLabel="Signing in…">
                Continue <span aria-hidden>›</span>
              </SubmitButton>
              <p className="text-center text-xs text-slate-400">
                Dev login (local only). Configure GitHub/Google/email for production.
              </p>
            </form>
          )}

          {noneConfigured && (
            <p className="mt-7 text-sm text-red-600">
              No auth providers configured. Set AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET,
              SSO_ISSUER/CLIENT_ID/CLIENT_SECRET, EMAIL_SERVER+EMAIL_FROM, or AUTH_DEV_LOGIN=1.
            </p>
          )}
        </div>

        {!noneConfigured && (
          <div className="border-t border-slate-200 bg-slate-50 px-8 py-4 text-center text-sm text-slate-500">
            Don&apos;t have an account?{" "}
            <span className="font-semibold text-slate-900">
              Just continue above - we&apos;ll create one.
            </span>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        By continuing you agree to TrustMCP&apos;s terms and privacy policy.
      </p>
    </div>
  );
}
