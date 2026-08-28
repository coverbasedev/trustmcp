import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { CrmConnectionFields } from "@/components/crm-connection-fields";
import { deleteTrustCenter, saveSettings } from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
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
  const v = await trustmcp().getVendor(vendorId, tc.ownerToken);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {saved && <div className="banner-success">Settings saved.</div>}

      <form action={saveSettings.bind(null, vendorId)} className="space-y-6">
        <div className="card space-y-3">
          <h2 className="font-semibold">Notifications</h2>
          <div>
            <label className="label" htmlFor="notify_email">Notification email</label>
            <input id="notify_email" name="notify_email" type="email" className="input"
              defaultValue={v.notify_email ?? ""} placeholder="trust@yourco.com" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notify_on_request" defaultChecked={v.notify_on_request !== false} />
            Email me on every access request (web, API, and MCP)
          </label>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Auto-release policies</h2>
          <p className="text-sm text-slate-600">
            When a request matches any enabled policy, a scoped key is granted automatically -
            no manual approval. You can still revoke at any time.
          </p>
          <div>
            <label className="label" htmlFor="auto_approve_domains">
              Preconfigured customer domains (one per line or comma-separated)
            </label>
            <textarea id="auto_approve_domains" name="auto_approve_domains" rows={3} className="input"
              defaultValue={(v.auto_approve_domains ?? []).join("\n")}
              placeholder={"globex.com\ninitech.com"} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_approve_crm" defaultChecked={v.auto_approve_crm} />
            Auto-release if the requester is a customer in our CRM (HubSpot / Salesforce)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_approve_on_contract" defaultChecked={v.auto_approve_on_contract} />
            Auto-release if the requester uploads a contract proving an agreement
          </label>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Approval agent</h2>
          <p className="text-sm text-slate-600">
            When on, requests whose recommendation is a confident <strong>approve</strong> (e.g.
            existing CRM customer + NDA) are granted automatically. You can always revoke.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="agent_auto_approve" defaultChecked={v.agent_auto_approve} />
            Let the approval agent auto-grant confident requests
          </label>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Document watermarking</h2>
          <p className="text-sm text-slate-600">
            Stamp each PDF download with the requester&apos;s domain + timestamp to deter leaks.
            Watermarked copies have a different hash; the API returns the original hash too.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="watermark_downloads" defaultChecked={v.watermark_downloads} />
            Watermark PDF downloads per requester
          </label>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">CRM connection</h2>
          <p className="text-sm text-slate-600">
            Connect your own CRM so relationship checks and auto-release use your data. These are
            your credentials, scoped to this trust center. Only the fields for the selected
            provider and connection method are shown.
          </p>
          <CrmConnectionFields
            provider={v.crm_provider ?? ""}
            connection={v.crm_connection ?? "api"}
            crmConfigured={!!v.crm_configured}
            instanceUrl={v.crm_instance_url ?? ""}
            mcpUrl={v.crm_mcp_url ?? ""}
            mcpConfigured={!!v.crm_mcp_configured}
            mcpAuth={v.crm_mcp_auth ?? "oauth"}
            mcpClientId={v.crm_mcp_client_id ?? ""}
            mcpTokenUrl={v.crm_mcp_token_url ?? ""}
            mcpClientSecretSet={!!v.crm_mcp_client_secret_set}
          />
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">NDA gate</h2>
          <p className="text-sm text-slate-600">
            Require requesters to accept an NDA before they can request access. Acceptance is
            recorded (timestamp + text hash) on the request.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="nda_required" defaultChecked={v.nda_required} />
            Require NDA acceptance
          </label>
          <div>
            <label className="label" htmlFor="nda_text">NDA text</label>
            <textarea id="nda_text" name="nda_text" rows={4} className="input"
              defaultValue={v.nda_text ?? ""} placeholder="By requesting access you agree to…" />
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Self-service DPA</h2>
          <p className="text-sm text-slate-600">
            Let visitors fill out a form on your public trust center to request a Data Processing
            Addendum. Submissions appear under <strong>Access → Agreements</strong>; route each one to
            your e-sign provider for signature.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="dpa_self_serve" defaultChecked={v.dpa_self_serve} />
            Enable the self-service DPA form
          </label>
          <div>
            <label className="label" htmlFor="dpa_intro">Intro text (optional)</label>
            <textarea id="dpa_intro" name="dpa_intro" rows={2} className="input"
              defaultValue={v.dpa_intro ?? ""} placeholder="Complete the fields below to generate our DPA for execution." />
          </div>
          <div>
            <label className="label" htmlFor="dpa_template_id">Docusign template ID (optional)</label>
            <input id="dpa_template_id" name="dpa_template_id" className="input"
              defaultValue={v.dpa_template_id ?? ""} placeholder="e.g. 1a2b3c4d-…" />
            <p className="mt-1 text-xs text-slate-400">
              When the network has Docusign configured and a template is set (here or as the network
              default), submitted DPAs are sent to the signer automatically. Otherwise you&apos;ll be
              notified to route them manually.
            </p>
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Docusign (e-signature)</h2>
          <p className="text-sm text-slate-600">
            Connect your own Docusign account so submitted DPAs are sent for signature under your
            brand. Uses the JWT Grant (impersonation) flow.{" "}
            {v.docusign_configured
              ? "Docusign is configured for this trust center."
              : "Not configured - submitted DPAs are captured and you're notified to route them manually."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="docusign_account_id">Account ID</label>
              <input id="docusign_account_id" name="docusign_account_id" className="input"
                defaultValue={v.docusign_account_id ?? ""} placeholder="e.g. 1a2b3c4d-…" />
            </div>
            <div>
              <label className="label" htmlFor="docusign_integration_key">Integration key (client ID)</label>
              <input id="docusign_integration_key" name="docusign_integration_key" className="input"
                defaultValue={v.docusign_integration_key ?? ""} placeholder="OAuth integration key" />
            </div>
            <div>
              <label className="label" htmlFor="docusign_user_id">Impersonated user ID</label>
              <input id="docusign_user_id" name="docusign_user_id" className="input"
                defaultValue={v.docusign_user_id ?? ""} placeholder="API username GUID" />
            </div>
            <div>
              <label className="label" htmlFor="docusign_auth_host">Auth host</label>
              <input id="docusign_auth_host" name="docusign_auth_host" className="input"
                defaultValue={v.docusign_auth_host ?? ""}
                placeholder="account-d.docusign.com (demo) / account.docusign.com" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="docusign_base_uri">Base URI</label>
            <input id="docusign_base_uri" name="docusign_base_uri" className="input"
              defaultValue={v.docusign_base_uri ?? ""}
              placeholder="https://demo.docusign.net/restapi (demo) / https://<account>.docusign.net/restapi" />
          </div>
          <div>
            <label className="label" htmlFor="docusign_private_key">RSA private key (PEM)</label>
            <textarea id="docusign_private_key" name="docusign_private_key" rows={4} className="input"
              placeholder={v.docusign_private_key_set ? "•••••• (unchanged)" : "-----BEGIN RSA PRIVATE KEY-----"} />
            <p className="mt-1 text-xs text-slate-400">
              Stored as a secret and never shown again. Leave blank to keep the existing key.
              {v.docusign_private_key_set ? " A key is currently set." : " No key set."}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="docusign_connect_hmac_key">Connect HMAC key (optional)</label>
            <input id="docusign_connect_hmac_key" name="docusign_connect_hmac_key" type="password" className="input"
              placeholder={v.docusign_connect_hmac_key_set ? "•••••• (unchanged)" : "verify status webhooks"} />
            <p className="mt-1 text-xs text-slate-400">
              Point a Docusign Connect webhook at <code>/v1/esign/webhook</code> on the network and set
              this to verify it. The DPA template ID lives under <strong>Self-service DPA</strong> above.
            </p>
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Webhooks</h2>
          <p className="text-sm text-slate-600">
            Receive <code>key.requested / granted / denied / revoked</code> events. Payloads are
            signed with <code>X-TrustMCP-Signature: sha256=HMAC</code> using your secret.
          </p>
          <div>
            <label className="label" htmlFor="webhook_url">Webhook URL</label>
            <input id="webhook_url" name="webhook_url" className="input"
              defaultValue={v.webhook_url ?? ""} placeholder="https://hooks.yourco.com/trustmcp" />
          </div>
          <div>
            <label className="label" htmlFor="webhook_secret">Signing secret</label>
            <input id="webhook_secret" name="webhook_secret" className="input"
              defaultValue={v.webhook_secret ?? ""} placeholder="a shared secret" />
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Trust Directory</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="listed" defaultChecked={v.listed !== false} />
            List us in the public Trust Directory
          </label>
        </div>

        <button className="btn-primary" type="submit">Save settings</button>
      </form>

      <div className="card border-red-200">
        <h2 className="font-semibold text-red-600">Danger zone</h2>
        <p className="mt-1 text-sm text-slate-600">
          Permanently delete this trust center and all of its evidence, attestations,
          keys, and audit history. This cannot be undone.
        </p>
        <form action={deleteTrustCenter.bind(null, vendorId)} className="mt-3">
          <button className="btn-danger" type="submit">Delete this trust center</button>
        </form>
      </div>
    </div>
  );
}
