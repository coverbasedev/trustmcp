import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { devLoginEnabled } from "@/auth";

export const dynamic = "force-dynamic";

// Operator self-check for a deployment smoke test. Service-token gated and
// returns only booleans (never secret values). Reports the web app's own
// configuration plus the network's diagnostics, fetched server-side with the
// shared service token so a single call covers the whole system.

function tokenOk(provided: string | null): boolean {
  const expected = process.env.TRUSTMCP_SERVICE_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!tokenOk(req.headers.get("x-trustmcp-service-token"))) {
    return NextResponse.json({ error: "invalid service token" }, { status: 401 });
  }

  const web = {
    auth: {
      github: !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET,
      google: !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET,
      sso: !!process.env.SSO_ISSUER && !!process.env.SSO_CLIENT_ID && !!process.env.SSO_CLIENT_SECRET,
      email: !!process.env.EMAIL_SERVER && !!process.env.EMAIL_FROM,
      dev_login: devLoginEnabled(),
    },
    analytics: { posthog: !!process.env.NEXT_PUBLIC_POSTHOG_KEY },
    sentry: {
      browser: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      server: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
    },
    auth_secret_set: !!process.env.AUTH_SECRET,
    auth_url: process.env.AUTH_URL ?? null,
  };

  // At least one real (non-dev) sign-in method must be configured to onboard users.
  const realAuth = web.auth.github || web.auth.google || web.auth.sso || web.auth.email;

  const networkUrl = process.env.TRUSTMCP_NETWORK_URL ?? "http://localhost:8000";
  let network: unknown = { reachable: false };
  try {
    const r = await fetch(`${networkUrl}/v1/meta/diagnostics`, {
      headers: { "X-TrustMCP-Service-Token": process.env.TRUSTMCP_SERVICE_TOKEN ?? "" },
      cache: "no-store",
    });
    network = r.ok
      ? { reachable: true, ...(await r.json()) }
      : { reachable: false, status: r.status };
  } catch (e) {
    network = { reachable: false, error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({
    ok: realAuth && web.auth_secret_set,
    web: { ...web, real_auth_configured: realAuth },
    network,
  });
}
