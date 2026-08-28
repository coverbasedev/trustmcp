import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { saveSubprocessors } from "../actions";

export const dynamic = "force-dynamic";

export default async function SubprocessorsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const { subprocessors } = await trustmcp().getOwnerSubprocessors(vendorId, tc.ownerToken);

  const rows = [
    ...subprocessors,
    ...Array(3).fill({ name: "", purpose: "", location: "", domain: "", category: "", logo_url: "" }),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Subprocessors</h1>
      <p className="text-sm text-slate-600">
        Your subprocessor list is part of your published profile (customers with the{" "}
        <code>attestations</code> scope can read it). Saving replaces the full list; blank rows are
        ignored.
      </p>

      <form action={saveSubprocessors.bind(null, vendorId)} className="card space-y-2">
        <div className="grid grid-cols-[1.1fr_1.2fr_0.6fr_1fr_0.8fr_1fr] gap-2 text-xs font-medium uppercase text-slate-400">
          <span>Name</span>
          <span>Purpose</span>
          <span>Location</span>
          <span>Domain</span>
          <span>Category</span>
          <span>Logo URL</span>
        </div>
        {rows.map((s, i) => (
          <div key={i} className="grid grid-cols-[1.1fr_1.2fr_0.6fr_1fr_0.8fr_1fr] gap-2">
            <input name="name" className="input" defaultValue={s.name} placeholder="Amazon Web Services" />
            <input name="purpose" className="input" defaultValue={s.purpose ?? ""} placeholder="Cloud hosting" />
            <input name="location" className="input" defaultValue={s.location ?? ""} placeholder="US" />
            <input name="domain" className="input" defaultValue={s.domain ?? ""} placeholder="aws.amazon.com" />
            <input name="category" className="input" defaultValue={s.category ?? ""} placeholder="Core Product" />
            <input name="logo_url" className="input" defaultValue={s.logo_url ?? ""} placeholder="(optional)" />
          </div>
        ))}
        <p className="text-xs text-slate-400">
          Leave the logo blank to auto-use the domain&apos;s favicon. The category (e.g. &quot;Core
          Product&quot;) groups subprocessors on the public page.
        </p>
        <button className="btn-primary" type="submit">Save subprocessors</button>
      </form>
    </div>
  );
}
