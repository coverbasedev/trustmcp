import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { sendAgreementForSignature } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-amber-50 text-amber-700",
  sent: "bg-indigo-50 text-indigo-700",
  signed: "bg-emerald-50 text-emerald-700",
  declined: "bg-red-50 text-red-700",
  voided: "bg-slate-100 text-slate-500",
};

export default async function AgreementsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const agreements = await trustmcp().listAgreements(vendorId, tc.ownerToken);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Agreements (DPA)</h1>
      <p className="text-sm text-slate-600">
        Self-service Data Processing Addendum requests submitted from your public trust center. Enable
        the form under <strong>Settings → Self-service DPA</strong>. Route each request to your e-sign
        provider for signature.
      </p>

      <div className="card">
        {agreements.length === 0 ? (
          <div className="text-sm text-slate-400">No agreement requests yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {agreements.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="font-medium">{a.company_name}</div>
                  <div className="text-xs text-slate-500">
                    {a.signer_name}
                    {a.signer_title ? `, ${a.signer_title}` : ""} · {a.signer_email}
                  </div>
                  <div className="text-xs text-slate-400">
                    {a.type.toUpperCase()} · {new Date(a.created_at).toLocaleString()}
                    {a.envelope_id ? ` · envelope ${a.envelope_id.slice(0, 10)}…` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {a.status === "submitted" && (
                    <form action={sendAgreementForSignature.bind(null, vendorId, a.id)}>
                      <button className="btn-ghost !py-1 text-xs" type="submit">Send for signature</button>
                    </form>
                  )}
                  <span className={`badge ${STATUS_STYLE[a.status] ?? "bg-slate-100 text-slate-500"}`}>{a.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
