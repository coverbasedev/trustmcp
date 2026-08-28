import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { trustmcp, TrustMCPError } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";

/**
 * Where Google sends the owner back after consent.
 *
 * The redirect URI has to be a single fixed URL (Google matches it verbatim
 * against the registered one), so it cannot carry the trust center in its path.
 * The vendor travels in `state` instead.
 *
 * We read the vendor out of `state` only to know which trust center to call.
 * That read is deliberately unverified here and proves nothing on its own —
 * authorization comes from two things that follow: the signed-in user must
 * actually own that trust center, and the network re-verifies the state's HMAC
 * before it will exchange the code. A forged state gets you as far as a 400.
 */
function vendorFromState(state: string): string | null {
  try {
    const body = state.split(".")[0];
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    const json = JSON.parse(
      Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    return typeof json.v === "string" ? json.v : null;
  } catch {
    return null;
  }
}

function fail(vendorId: string | null, message: string) {
  // Errors land back on the Drive page rather than a bare error screen, so the
  // owner can just try again from where they started.
  const target = vendorId ? `/tc/${vendorId}/drive` : "/dashboard";
  return NextResponse.redirect(
    new URL(`${target}?drive_error=${encodeURIComponent(message)}`, baseUrl()),
  );
}

function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const googleError = url.searchParams.get("error");
  const vendorId = vendorFromState(state);

  // The owner pressed Cancel on Google's consent screen. Not an error worth
  // shouting about — send them back with a plain note.
  if (googleError) {
    return fail(
      vendorId,
      googleError === "access_denied"
        ? "Google sign-in was cancelled."
        : `Google returned an error: ${googleError}`,
    );
  }
  if (!code || !state) {
    return fail(vendorId, "Google's response was missing the authorization code.");
  }
  if (!vendorId) {
    return fail(null, "Could not tell which trust center this sign-in was for.");
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", baseUrl()));
  }
  // The real authorization check: does this signed-in user manage this trust
  // center? Without it, `state` alone would decide whose Drive we attach.
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) {
    return fail(null, "You do not have access to that trust center.");
  }

  try {
    const result = await trustmcp().driveOAuthExchange(vendorId, tc.ownerToken, { code, state });
    const next = result.needs_folder ? "?pick=1" : "";
    return NextResponse.redirect(new URL(`/tc/${vendorId}/drive${next}`, baseUrl()));
  } catch (e) {
    const message =
      e instanceof TrustMCPError ? e.message : "Could not complete the Google connection.";
    return fail(vendorId, message);
  }
}
