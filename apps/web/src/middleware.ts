import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Hosts where we serve our own app (marketing, dashboard, public /trust/… pages).
// Anything else reaching us is a customer's connected custom domain.
const PRIMARY_HOSTS = new Set(["trustmcp.app", "www.trustmcp.app", "localhost", "127.0.0.1"]);

function isPrimaryHost(host: string): boolean {
  if (!host) return true;
  if (PRIMARY_HOSTS.has(host)) return true;
  // Render/Vercel default hosts (used for health checks / direct service access).
  return host.endsWith(".onrender.com") || host.endsWith(".vercel.app");
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const { pathname } = req.nextUrl;

  // Forward the pathname to server components (kept for back-compat with the root
  // layout's chrome detection).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  // Custom domain → serve the matching vendor's trust center. Rewrite to an internal
  // /sites/{host} route that resolves host→vendor server-side (URL bar keeps the
  // customer's domain). Generic for every connected domain — no per-vendor config.
  // Only rewrite page navigations: skip the resolver route, Next internals, the API,
  // and any static file (a path with an extension, e.g. /compliance/iso27001.png) so
  // those are served normally instead of returning the trust-center HTML.
  const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(pathname);
  if (
    !isPrimaryHost(host) &&
    !pathname.startsWith("/sites/") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/api") &&
    !looksLikeFile
  ) {
    const url = req.nextUrl.clone();
    url.pathname = `/sites/${host}`;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Run on everything except Next internals and static assets, so a custom-domain
  // request is caught at any path. Primary-host behavior is unchanged (pass-through).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
