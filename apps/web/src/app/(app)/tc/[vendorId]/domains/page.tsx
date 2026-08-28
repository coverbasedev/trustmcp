import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import type { CustomDomainStatus } from "@trustmcp/sdk";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import CustomDomainPanel from "@/components/custom-domain-panel";
import {
  addDomain,
  autoConfigureDns,
  detectDnsProvider,
  discoverDomainConnect,
  removeCustomDomain,
  removeDomain,
  setCustomDomain,
  verifyCustomDomain,
  verifyDomain,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function DomainsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const [vendor, domains, customDomain] = await Promise.all([
    trustmcp().getVendor(vendorId, tc.ownerToken),
    trustmcp().listDomains(vendorId, tc.ownerToken),
    trustmcp()
      .getCustomDomain(vendorId, tc.ownerToken)
      .catch((): CustomDomainStatus => ({ domain: null })),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Domains</h1>
      <p className="text-sm text-slate-600">
        Verify a domain you control to confirm you own where you publish. Your evidence stays
        self-asserted - customers verify it themselves.
      </p>
      <div className="card">
        Domain status:{" "}
        <span
          className={`badge ${
            vendor.mark_status === "agent-ready"
              ? "bg-emerald-50 text-emerald-700"
              : vendor.mark_status === "revoked"
                ? "bg-red-50 text-red-700"
                : "bg-amber-50 text-amber-700"
          }`}
        >
          {vendor.mark_status === "agent-ready" ? "verified" : vendor.mark_status}
        </span>
        {vendor.mark_status === "revoked" && (
          <p className="mt-2 text-sm text-red-700">
            Revoked by the network - contact the operator to reinstate. Re-verifying a domain will not
            restore it on its own.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {domains.map((d) => (
          <div key={d.domain} className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">{d.domain}</div>
              <div className="flex items-center gap-2">
                <span className={`badge ${d.verified ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {d.verified ? `verified (${d.method})` : "pending"}
                </span>
                <form action={removeDomain.bind(null, vendorId, d.domain)}>
                  <button className="btn-ghost !py-1 text-xs" type="submit">Remove</button>
                </form>
              </div>
            </div>
            {!d.verified && (
              <>
                <div className="rounded-lg bg-slate-50 p-3 text-xs">
                  <div className="font-medium text-slate-500">Add ONE of the following, then verify:</div>
                  <div className="mt-2">
                    <div className="text-slate-400">DNS TXT record</div>
                    <code className="break-all">{d.dns_record_name} → {d.dns_record_value}</code>
                  </div>
                  <div className="mt-2">
                    <div className="text-slate-400">or file at</div>
                    <code className="break-all">{d.well_known_url}</code>
                    <div>containing: <code className="break-all">{d.dns_record_value}</code></div>
                  </div>
                </div>
                <form action={verifyDomain.bind(null, vendorId, d.domain)}>
                  <button className="btn-primary" type="submit">Verify {d.domain}</button>
                </form>
              </>
            )}
          </div>
        ))}
      </div>

      <form action={addDomain.bind(null, vendorId)} className="card flex items-end gap-3">
        <div className="flex-1">
          <label className="label" htmlFor="domain">Add a domain</label>
          <input id="domain" name="domain" className="input" placeholder="acme.com" />
        </div>
        <button className="btn-ghost" type="submit">Add</button>
      </form>

      <div className="border-t border-slate-200 pt-6">
        <h2 className="text-xl font-semibold">Custom domain hosting</h2>
        <p className="mt-1 text-sm text-slate-600">
          Optionally serve your trust center on your own domain (e.g.{" "}
          <code className="rounded bg-slate-100 px-1">trust.example.com</code>). Point a subdomain at
          us with a CNAME and verify with a TXT record — or connect your DNS provider to set it up
          automatically. This is separate from the domain verification above.
        </p>
        <div className="mt-4">
          <CustomDomainPanel
            status={customDomain}
            actions={{
              set: setCustomDomain.bind(null, vendorId),
              verify: verifyCustomDomain.bind(null, vendorId),
              remove: removeCustomDomain.bind(null, vendorId),
              detect: detectDnsProvider.bind(null, vendorId),
              autoConfigure: autoConfigureDns.bind(null, vendorId),
              connect: discoverDomainConnect.bind(null, vendorId),
            }}
          />
        </div>
      </div>
    </div>
  );
}
