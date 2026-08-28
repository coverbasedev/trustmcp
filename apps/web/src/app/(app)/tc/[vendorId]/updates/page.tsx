import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { saveUpdates } from "../actions";

export const dynamic = "force-dynamic";

export default async function UpdatesPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const { updates } = await trustmcp().getOwnerUpdates(vendorId, tc.ownerToken);

  const rows = [
    ...updates,
    ...Array(2).fill({ title: "", body: "", category: "", published_at: "" }),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Updates</h1>
      <p className="text-sm text-slate-600">
        Announcements and changelog entries shown in the Updates feed, and emailed to subscribers when
        you publish. Saving replaces the full list; rows without a title are ignored.
      </p>

      <form action={saveUpdates.bind(null, vendorId)} className="card space-y-4">
        {rows.map((u, i) => (
          <div key={i} className="space-y-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
            <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
              <input name="title" className="input" defaultValue={u.title} placeholder="SOC 2 Type II report available" />
              <input name="category" className="input" defaultValue={u.category ?? ""} placeholder="Compliance" />
              <input name="published_at" type="date" className="input" defaultValue={u.published_at ?? ""} />
            </div>
            <textarea name="body" className="input min-h-[70px]" defaultValue={u.body ?? ""} placeholder="We're excited to announce…" />
          </div>
        ))}
        <button className="btn-primary" type="submit">Save updates</button>
      </form>
    </div>
  );
}
