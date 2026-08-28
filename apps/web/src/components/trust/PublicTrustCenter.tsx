import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { trustmcp, TrustMCPError } from "@/lib/trustmcp";
import { TrustCenterApp, type PublicProfile } from "@/components/trust/TrustCenterApp";
import {
  askQuestion,
  getPublicArtifactUrl,
  reclaimAccess,
  submitDpa,
  submitRequestAccess,
  subscribeToUpdates,
} from "@/app/(public)/trust/[vendorId]/actions";

/**
 * Shared public trust-center rendering, used both by the path-based route
 * (/trust/[vendorId]) and the custom-domain route (/sites/[host]). Keeping the
 * profile fetch, defensive section defaulting, and action wiring in one place means
 * the two entry points can never drift.
 */
export async function buildTrustMetadata(vendorId: string): Promise<Metadata> {
  // Use the vendor's brand logo as the favicon and tab title so the trust center
  // feels like their own site. Best-effort: falls back to defaults on failure.
  try {
    const p = await trustmcp().getPublicProfile(vendorId);
    const b = p.vendor?.branding ?? {};
    const name = b.display_name || p.vendor?.legal_name || "Trust Center";
    return {
      title: `${name} · Trust Center`,
      description: b.description || `${name}'s security and compliance trust center.`,
      ...(b.logo_url ? { icons: { icon: b.logo_url, shortcut: b.logo_url, apple: b.logo_url } } : {}),
    };
  } catch {
    return { title: "Trust Center" };
  }
}

export default async function PublicTrustCenter({ vendorId }: { vendorId: string }) {
  let raw: Awaited<ReturnType<ReturnType<typeof trustmcp>["getPublicProfile"]>>;
  try {
    raw = await trustmcp().getPublicProfile(vendorId);
  } catch (e) {
    if (e instanceof TrustMCPError && e.status === 404) notFound();
    throw e;
  }

  // Defensively default the section arrays so the client never dereferences
  // undefined if an older/partial /public payload omits a field.
  const profile: PublicProfile = {
    ...raw,
    artifacts: raw.artifacts ?? [],
    resources: raw.resources,
    badges: raw.badges ?? [],
    controls: raw.controls ?? [],
    data_types: raw.data_types ?? [],
    subprocessors: raw.subprocessors ?? [],
    faqs: raw.faqs ?? [],
    updates: raw.updates ?? [],
  };

  return (
    <TrustCenterApp
      profile={profile}
      actions={{
        requestAccess: submitRequestAccess,
        subscribe: subscribeToUpdates,
        ask: askQuestion,
        reclaim: reclaimAccess,
        submitDpa,
        artifactUrl: getPublicArtifactUrl,
      }}
    />
  );
}
