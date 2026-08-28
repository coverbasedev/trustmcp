import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";

export const dynamic = "force-dynamic";

export default async function SubscribersPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const { count, subscribers } = await trustmcp().listSubscribers(vendorId, tc.ownerToken);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Subscribers</h1>
      <p className="text-sm text-slate-600">
        People who asked to be notified when you publish updates. {count} total.
      </p>

      <div className="card">
        {subscribers.length === 0 ? (
          <div className="text-sm text-slate-400">No subscribers yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {subscribers.map((s) => (
              <div key={s.email} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                <span className="text-sm">{s.email}</span>
                <span className="text-xs text-slate-400">{new Date(s.since).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
