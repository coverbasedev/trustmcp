import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { Select } from "@/components/select";
import QuestionnairePicker from "@/components/questionnaire-picker";
import { addArtifact, addQuestionnaires, deleteArtifact, editArtifact, uploadContent } from "../actions";

export const dynamic = "force-dynamic";

const TYPES = [
  "soc2_type2", "soc2_type1", "iso_27001", "pentest", "insurance_coi",
  "financials", "dpa", "architecture", "subprocessor_list", "sbom", "policy",
];

export default async function ArtifactsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const client = trustmcp();
  const [artifacts, vendor] = await Promise.all([
    client.listArtifacts(vendorId, tc.ownerToken),
    client.getVendor(vendorId, tc.ownerToken),
  ]);
  const products = vendor.products ?? [];
  const productName = new Map(products.map((p) => [p.id, p.name]));
  // Version history per artifact (small N).
  const histories = new Map<string, Awaited<ReturnType<typeof client.getArtifactVersions>>["versions"]>();
  await Promise.all(
    artifacts
      .filter((a) => a.has_content)
      .map(async (a) =>
        histories.set(a.id, (await client.getArtifactVersions(vendorId, tc.ownerToken, a.id)).versions),
      ),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Resources</h1>
        <QuestionnairePicker action={addQuestionnaires.bind(null, vendorId)} />
      </div>
      <p className="text-sm text-slate-600">
        Upload your evidence once. Files are stored by the network and only released to customers
        you grant a scoped key. The sha256 is recorded so agents can verify what they download.
        Set a <strong>category</strong> to group resources on your public trust center. Add
        standardized questionnaires (CAIQ, SIG Lite, VSA…) from the button above.
      </p>

      <div className="space-y-3">
        {artifacts.length === 0 && <div className="card text-sm text-slate-500">No artifacts yet.</div>}
        {artifacts.map((a) => (
          <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">
                {a.title || a.type}{" "}
                <span className="badge bg-slate-100 text-slate-500">{a.type}</span>{" "}
                <span className={`badge ${a.access === "public" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {a.access === "public" ? "public" : "private"}
                </span>{" "}
                <span className="badge bg-slate-100 text-slate-700">v{a.version}</span>
              </div>
              <div className="text-xs text-slate-400">
                {a.id} · issued {a.issued_at}
                {a.valid_until ? ` · valid until ${a.valid_until}` : " · no expiry"}
                {a.sha256 ? ` · sha256 ${a.sha256.slice(0, 12)}…` : ""}
              </div>
              {products.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(a.product_ids ?? []).length === 0 ? (
                    <span className="badge bg-slate-100 text-slate-500">All products</span>
                  ) : (
                    (a.product_ids ?? []).map((pid) => (
                      <span key={pid} className="badge bg-brand-50 text-brand-700">
                        {productName.get(pid) ?? pid}
                      </span>
                    ))
                  )}
                </div>
              )}
              <details className="mt-2 text-xs text-slate-500">
                <summary className="cursor-pointer">Edit details</summary>
                <form action={editArtifact.bind(null, vendorId, a.id)} className="mt-2 grid grid-cols-2 gap-2">
                  <input name="title" className="input" defaultValue={a.title ?? ""} placeholder="title" />
                  <input name="type" className="input" defaultValue={a.type} placeholder="type" />
                  <input name="format" className="input" defaultValue={a.format ?? ""} placeholder="format (e.g. cyclonedx-1.5)" />
                  <input name="scope" className="input" defaultValue={a.scope ?? ""} placeholder="scope" />
                  <input name="category" className="input" defaultValue={a.category ?? ""} placeholder="category (e.g. Compliance)" />
                  <input name="issued_at" type="date" className="input" defaultValue={a.issued_at} />
                  <input name="valid_until" type="date" className="input" defaultValue={a.valid_until ?? ""} />
                  <Select
                    name="access"
                    defaultValue={a.access}
                    ariaLabel="Artifact visibility"
                    options={[
                      { value: "key_required", label: "Private" },
                      { value: "public", label: "Public" },
                    ]}
                  />
                  {products.length > 0 && (
                    <fieldset className="col-span-2 rounded-md border border-slate-200 p-2">
                      <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-400">
                        Products (none = all)
                      </legend>
                      <div className="flex flex-wrap gap-3">
                        {products.map((p) => (
                          <label key={p.id} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              name="product_ids"
                              value={p.id}
                              defaultChecked={(a.product_ids ?? []).includes(p.id)}
                            />
                            {p.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <button className="btn-ghost" type="submit">Save details</button>
                </form>
              </details>
              {a.has_content && (histories.get(a.id)?.length ?? 0) > 1 && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer">Version history</summary>
                  <ul className="mt-1 space-y-1">
                    {histories.get(a.id)!.map((v) => (
                      <li key={v.version}>
                        v{v.version}
                        {v.current ? " (current)" : ""} · issued {v.issued_at}
                        {v.sha256 ? ` · ${v.sha256.slice(0, 10)}…` : ""}
                        {v.note ? ` · ${v.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/tc/${vendorId}/artifacts/${a.id}`} className="btn-ghost">Manage</Link>
              {a.has_content ? (
                <form action={uploadContent.bind(null, vendorId, a.id)} className="flex items-center gap-2">
                  <input type="file" name="file" required className="text-xs" />
                  <input name="note" className="input !w-32 !py-1 text-xs" placeholder="note" />
                  <button className="btn-ghost" type="submit">New version</button>
                </form>
              ) : (
                <form action={uploadContent.bind(null, vendorId, a.id)} className="flex items-center gap-2">
                  <input type="file" name="file" required className="text-xs" />
                  <button className="btn-ghost" type="submit">Upload</button>
                </form>
              )}
              <form action={deleteArtifact.bind(null, vendorId, a.id)}>
                <button className="btn-danger" type="submit">Delete</button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <form action={addArtifact.bind(null, vendorId)} className="card grid gap-3 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Add artifact</h2>
        <div>
          <label className="label" htmlFor="type">Type</label>
          <Select
            id="type"
            name="type"
            defaultValue="soc2_type2"
            ariaLabel="Artifact type"
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" name="title" className="input" placeholder="SOC 2 Type II Report" />
        </div>
        <div>
          <label className="label" htmlFor="format">Format (optional)</label>
          <input id="format" name="format" className="input" placeholder="cyclonedx-1.5 / pdf" />
        </div>
        <div>
          <label className="label" htmlFor="issued_at">Issued at</label>
          <input id="issued_at" name="issued_at" type="date" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="valid_until">Valid until (optional)</label>
          <input id="valid_until" name="valid_until" type="date" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="access">Visibility</label>
          <Select
            id="access"
            name="access"
            defaultValue="key_required"
            ariaLabel="Visibility"
            options={[
              { value: "key_required", label: "Private (request + approval required)" },
              { value: "public", label: "Public (anyone can download)" },
            ]}
          />
        </div>
        <div>
          <label className="label" htmlFor="scope">Scope (optional)</label>
          <input id="scope" name="scope" className="input" placeholder="Acme Platform, US regions" />
        </div>
        <div>
          <label className="label" htmlFor="category">Resource category (optional)</label>
          <input id="category" name="category" className="input" placeholder="Compliance / Penetration Testing / Privacy" />
        </div>
        {products.length > 0 && (
          <div className="sm:col-span-2">
            <span className="label">Products (optional — leave empty to apply to all)</span>
            <div className="flex flex-wrap gap-3 rounded-md border border-slate-200 p-3">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="product_ids" value={p.id} />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="file">File (optional, can upload later)</label>
          <input id="file" name="file" type="file" className="text-sm" />
        </div>
        <button className="btn-primary sm:col-span-2" type="submit">Add artifact</button>
      </form>
    </div>
  );
}
