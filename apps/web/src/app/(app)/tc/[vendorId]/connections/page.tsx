import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";

export const dynamic = "force-dynamic";

function Row({
  title,
  status,
  ok,
  body,
  href,
  cta,
}: {
  title: string;
  status: string;
  ok: boolean;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="card flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 font-medium">
          {title}
          <span className={`badge ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {status}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{body}</p>
      </div>
      <Link href={href} className="btn-ghost shrink-0">{cta}</Link>
    </div>
  );
}

export default async function ConnectionsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const vendor = await trustmcp().getVendor(vendorId, tc.ownerToken);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const network = process.env.TRUSTMCP_NETWORK_URL ?? "http://localhost:8000";
  const discovery = JSON.stringify(
    {
      schema_version: "0.1",
      vendor_id: vendor.id,
      legal_name: vendor.legal_name,
      network,
      manifest: `${network}/v1/vendors/${vendor.id}/manifest`,
      ...(vendor.mark_status === "agent-ready" ? { mark: "agent-ready" } : {}),
    },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="text-sm text-slate-600">
          Connect TrustMCP to the rest of your stack: your domain, your CRM, and your own systems.
        </p>
      </div>

      <Row
        title="Domain verification"
        status={vendor.mark_status === "agent-ready" ? "verified" : "not verified"}
        ok={vendor.mark_status === "agent-ready"}
        body="Verify a domain you control to confirm ownership of where you publish."
        href={`/tc/${vendorId}/domains`}
        cta="Domains"
      />
      <Row
        title="CRM auto-release (HubSpot / Salesforce)"
        status={vendor.auto_approve_crm ? "on" : "off"}
        ok={!!vendor.auto_approve_crm}
        body="Auto-grant access when a requester is an existing customer in your CRM."
        href={`/tc/${vendorId}/settings`}
        cta="Settings"
      />
      <Row
        title="Webhooks"
        status={vendor.webhook_url ? "configured" : "not set"}
        ok={!!vendor.webhook_url}
        body="Receive request/grant/deny/revoke events in your own systems, signed with HMAC."
        href={`/tc/${vendorId}/settings`}
        cta="Settings"
      />

      <div className="card">
        <div className="flex items-center justify-between">
          <div className="font-medium">Discovery record</div>
          <a href={`/api/discovery/${vendor.id}`} className="text-sm text-slate-900 hover:underline" target="_blank">
            View JSON ↗
          </a>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Host this at <code>https://{vendor.domains[0] ?? "your-domain"}/.well-known/trustmcp.json</code> so
          an agent that only knows your domain can find your profile.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">{discovery}</pre>
        <p className="mt-2 text-xs text-slate-400">
          Or proxy <code>{appUrl}/api/discovery/{vendor.id}</code> from that path.
        </p>
      </div>
    </div>
  );
}
