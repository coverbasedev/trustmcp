import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { saveDataTypes } from "../actions";

export const dynamic = "force-dynamic";

export default async function DataCollectedPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const { data_types } = await trustmcp().getOwnerDataTypes(vendorId, tc.ownerToken);

  const rows = [
    ...data_types,
    ...Array(4).fill({ label: "", collected: true }),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Data collected</h1>
      <p className="text-sm text-slate-600">
        The kinds of data you do (and don&apos;t) collect, shown as a yes/no list on your public trust
        center. Tick &quot;Collected&quot; for data you process. Saving replaces the full list.
      </p>

      <form action={saveDataTypes.bind(null, vendorId)} className="card space-y-2">
        <div className="grid grid-cols-[2fr_0.6fr] gap-2 text-xs font-medium uppercase text-slate-400">
          <span>Data type</span>
          <span>Collected</span>
        </div>
        {rows.map((d, i) => (
          <div key={i} className="grid grid-cols-[2fr_0.6fr] items-center gap-2">
            <input name="label" className="input" defaultValue={d.label} placeholder="Customer personally identifiable information" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="collected" value={i} defaultChecked={d.collected} />
              Collected
            </label>
          </div>
        ))}
        <button className="btn-primary" type="submit">Save data types</button>
      </form>
    </div>
  );
}
