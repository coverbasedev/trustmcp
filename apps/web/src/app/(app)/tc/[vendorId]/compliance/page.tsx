import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import ComplianceEditor from "@/components/compliance-editor";
import { saveBadges } from "../actions";

export const dynamic = "force-dynamic";

export default async function CompliancePage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { vendorId } = await params;
  const { saved } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const client = trustmcp();
  const [{ badges }, artifacts] = await Promise.all([
    client.getOwnerBadges(vendorId, tc.ownerToken),
    client.listArtifacts(vendorId, tc.ownerToken),
  ]);
  const artifactOpts = artifacts.map((a) => ({ id: a.id, title: a.title || a.type }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Compliance</h1>
      {saved && <div className="banner-success">Compliance standards saved.</div>}
      <p className="text-sm text-slate-600">
        The frameworks and certifications shown as badges on your public trust center. Pick from the
        catalog instead of typing each one; the matching acronym icon is used automatically, or add a
        custom name and logo. Saving replaces the full list.
      </p>

      <ComplianceEditor
        initial={badges}
        artifacts={artifactOpts}
        action={saveBadges.bind(null, vendorId)}
      />
    </div>
  );
}
