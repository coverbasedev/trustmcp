import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { BuilderTabs } from "@/components/builder-tabs";
import FormGuard from "@/components/form-guard";
import { trustmcp } from "@/lib/trustmcp";
import { ROLE_LABEL, canManage, normalizeRole } from "@/lib/roles";
import { getRole } from "@/lib/team";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { publish } from "./actions";

export const dynamic = "force-dynamic";

export default async function BuilderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) notFound();

  const [vendor, role] = await Promise.all([
    trustmcp().getVendor(vendorId, tc.ownerToken),
    getRole(session.user.id, tc.orgId),
  ]);
  const isAgentReady = vendor.mark_status === "agent-ready";
  const isPublished = !!vendor.published_at;
  const manage = canManage(role);

  // "View public" opens the vendor's own domain once it's connected and verified;
  // otherwise the trustmcp.app/trust/… URL. Either way it's the chrome-free public
  // trust center (the (public) route group, no TrustMCP header).
  const customDomain = (
    vendor.branding as { custom_domain?: { domain?: string; status?: string } } | undefined
  )?.custom_domain;
  const publicHref =
    customDomain?.domain && (customDomain.status === "verified" || customDomain.status === "active")
      ? `https://${customDomain.domain}`
      : `/trust/${vendorId}`;

  return (
    <div className="ui-90 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-xs text-slate-400 hover:text-slate-600">
            Trust Centers
          </Link>
          <h1 className="mt-0.5 text-2xl font-semibold">{vendor.legal_name}</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className={`badge ${isAgentReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {isAgentReady ? "● verified" : "● unverified"}
            </span>
            <span className={`badge ${isPublished ? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-500"}`}>
              {isPublished ? "published" : "draft"}
            </span>
            <span className="badge bg-slate-100 text-slate-500">{ROLE_LABEL[normalizeRole(role)]}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={publicHref} className="btn-ghost" target="_blank" rel="noreferrer">
            View public ↗
          </Link>
          {manage && (
            <form action={publish.bind(null, vendorId)}>
              <button className="btn-primary" type="submit">
                {isPublished ? "Re-publish" : "Publish"}
              </button>
            </form>
          )}
        </div>
      </div>

      <BuilderTabs vendorId={vendorId} />

      {!manage && (
        <div className="banner-warning">
          You have read-only (member) access to this trust center.
        </div>
      )}

      <div>{children}</div>
      <FormGuard />
    </div>
  );
}
