import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import ProductLinesEditor from "@/components/product-lines-editor";
import ColorField from "@/components/color-field";
import LogoUploader from "@/components/logo-uploader";
import { saveBranding, uploadLogo, uploadWideLogo } from "../actions";

export const dynamic = "force-dynamic";

export default async function BrandingPage({
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
  const vendor = await trustmcp().getVendor(vendorId, tc.ownerToken);
  const b = vendor.branding ?? {};

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Branding</h1>
      {saved && <div className="banner-success">Branding saved.</div>}
      <p className="text-sm text-slate-600">
        Customize the public trust center your customers and their agents see. This is your brand,
        not ours.
      </p>

      {/* Logos: drag-and-drop, validated + resized client-side, then stored and
          served by the network. A square mark (switcher/favicon) and a wide
          lockup (header). */}
      <div className="grid gap-4 md:grid-cols-2">
        <LogoUploader kind="square" currentUrl={b.logo_url} action={uploadLogo.bind(null, vendorId)} />
        <LogoUploader kind="wide" currentUrl={b.wide_logo_url} action={uploadWideLogo.bind(null, vendorId)} />
      </div>

      <form action={saveBranding.bind(null, vendorId)} className="grid gap-6 md:grid-cols-2">
        <div className="card space-y-3">
          <Field name="legal_name" label="Legal name" defaultValue={vendor.legal_name} />
          <ProductLinesEditor initial={vendor.products ?? []} />
          <Field name="display_name" label="Display name" defaultValue={b.display_name ?? ""} />
          <Field name="headline" label="Headline" defaultValue={b.headline ?? ""} />
          <div>
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={3} className="input" defaultValue={b.description ?? ""} />
          </div>
          <Field name="logo_url" label="Logo URL (or upload above)" defaultValue={b.logo_url ?? ""} placeholder="https://…/logo.svg" />
          <Field name="support_email" label="Support email" defaultValue={b.support_email ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <ColorField name="primary_color" label="Primary color" defaultValue={b.primary_color ?? "#0f172a"} />
            <ColorField name="accent_color" label="Accent color" defaultValue={b.accent_color ?? "#06b6d4"} />
          </div>
          <div className="border-t border-slate-100 pt-3 text-xs uppercase tracking-wide text-slate-400">
            Header links
          </div>
          <Field name="privacy_policy_url" label="Privacy policy URL" defaultValue={b.privacy_policy_url ?? ""} placeholder="https://…/privacy" />
          <Field name="marketplace_url" label="Marketplace listing URL" defaultValue={b.marketplace_url ?? ""} placeholder="https://…" />
          <Field name="company_url" label="Website URL" defaultValue={b.company_url ?? ""} placeholder="https://…" />
          <button className="btn-primary w-full" type="submit">Save branding</button>
        </div>

        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">Live values</div>
          <div
            className="mt-3 rounded-lg p-5 text-white"
            style={{ background: b.primary_color ?? "#0f172a" }}
          >
            <div className="flex items-center gap-3">
              {b.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logo_url} alt="" className="h-10 w-10 rounded bg-white/10 object-contain" />
              )}
              <div className="text-lg font-semibold">{b.display_name || vendor.legal_name}</div>
            </div>
            <div className="mt-1 opacity-90">{b.headline || "Trust, machine-readable."}</div>
          </div>
          <p className="mt-3 text-sm text-slate-600">{b.description || "Add a description to introduce your trust center."}</p>
          <p className="mt-4 text-xs text-slate-400">
            Preview the full page with “View public page ↗”.
          </p>
        </div>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} className="input" defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}
