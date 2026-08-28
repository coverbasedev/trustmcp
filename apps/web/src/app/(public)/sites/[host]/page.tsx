import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { trustmcp } from "@/lib/trustmcp";
import PublicTrustCenter, { buildTrustMetadata } from "@/components/trust/PublicTrustCenter";

export const dynamic = "force-dynamic";

// Serves a vendor's trust center on their own connected domain. The web middleware
// rewrites any custom-domain request to /sites/{host}; this resolves the host to its
// published vendor and renders the same trust center as /trust/[vendorId]. Both live
// in the chrome-free (public) route group, so the page is fully the customer's brand.
// Generic: works for every vendor that connects a domain.
function normalizeHost(raw: string): string {
  return decodeURIComponent(raw).split(":")[0].trim().toLowerCase().replace(/\.$/, "");
}

async function resolveVendor(host: string): Promise<string | null> {
  try {
    return await trustmcp().resolveCustomDomain(host);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  const host = normalizeHost((await params).host);
  const vendorId = await resolveVendor(host);
  if (!vendorId) return { title: "Trust Center", robots: { index: false } };
  const meta = await buildTrustMetadata(vendorId);
  // Index only when genuinely served on the custom domain; the internal
  // trustmcp.app/sites/<host> view (real host ≠ param) is noindex.
  const realHost = (await headers()).get("host")?.split(":")[0].toLowerCase();
  const onCustomDomain = realHost === host;
  return {
    ...meta,
    alternates: { canonical: `https://${host}/` },
    ...(onCustomDomain ? {} : { robots: { index: false } }),
  };
}

export default async function CustomDomainTrustCenter({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const host = normalizeHost((await params).host);
  const vendorId = await resolveVendor(host);
  if (!vendorId) notFound();
  return <PublicTrustCenter vendorId={vendorId} />;
}
