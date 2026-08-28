import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { publish } from "../actions";

export const dynamic = "force-dynamic";

export default async function SetupPage({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const client = trustmcp();
  const [vendor, artifacts, att] = await Promise.all([
    client.getVendor(vendorId, tc.ownerToken),
    client.listArtifacts(vendorId, tc.ownerToken),
    client.getOwnerAttestations(vendorId, tc.ownerToken),
  ]);

  const steps = [
    {
      n: 1,
      title: "Brand your trust center",
      body: "Add your display name, logo, colors, and a headline. This is your brand - TrustMCP stays invisible.",
      done: !!vendor.branding?.headline || !!vendor.branding?.display_name,
      href: `/tc/${vendorId}/branding`,
      cta: "Edit branding",
    },
    {
      n: 2,
      title: "Connect sources & upload evidence",
      body: "Upload SOC 2, pentests, ISO, COI, SBOM, DPA. Optionally connect a CRM so customer requests can auto-release.",
      done: artifacts.length > 0,
      href: `/tc/${vendorId}/artifacts`,
      cta: "Add artifacts",
      extra: { label: "Connections", href: `/tc/${vendorId}/connections` },
    },
    {
      n: 3,
      title: "Declare attestations",
      body: "Add machine-readable claims (mfa.enforced, encryption.at_rest…) so agents reason without parsing PDFs.",
      done: att.claims.length > 0,
      href: `/tc/${vendorId}/attestations`,
      cta: "Add claims",
    },
    {
      n: 4,
      title: "Verify a domain",
      body: "Prove you control your domain via DNS or a .well-known file to verify ownership.",
      done: vendor.mark_status === "agent-ready",
      href: `/tc/${vendorId}/domains`,
      cta: "Verify domain",
    },
  ];
  const ready = steps.every((s) => s.done);
  const published = !!vendor.published_at;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Guided setup</h1>
        <p className="text-sm text-slate-600">Four steps to a complete trust center, then publish.</p>
      </div>

      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.n} className="card flex items-start gap-4">
            <div
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                s.done ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-400"
              }`}
            >
              {s.done ? "✓" : s.n}
            </div>
            <div className="flex-1">
              <div className="font-medium">{s.title}</div>
              <p className="mt-1 text-sm text-slate-600">{s.body}</p>
              <div className="mt-2 flex gap-2">
                <Link href={s.href} className="btn-ghost">{s.cta}</Link>
                {s.extra && <Link href={s.extra.href} className="btn-ghost">{s.extra.label}</Link>}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="card flex items-center justify-between">
        <div>
          <div className="font-medium">{published ? "Published" : "Publish your trust center"}</div>
          <p className="text-sm text-slate-600">
            {ready
              ? "Everything's ready. Publishing makes your profile readable by customers you grant access to."
              : "Finish the steps above first (you can publish before verifying a domain, but it won't show as verified)."}
          </p>
        </div>
        <form action={publish.bind(null, vendorId)}>
          <button className="btn-primary" type="submit">{published ? "Re-publish" : "Publish"}</button>
        </form>
      </div>
    </div>
  );
}
