import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { Select } from "@/components/select";
import { addSbom, deleteArtifact, uploadContent } from "../actions";

export const dynamic = "force-dynamic";

const FORMATS = ["cyclonedx-1.6", "cyclonedx-1.5", "spdx-2.3", "spdx-3.0", "syft-json"];

export default async function SbomPage({
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
  const all = await client.listArtifacts(vendorId, tc.ownerToken);
  const sboms = all.filter((a) => a.type === "sbom");

  // Version history per SBOM that has content.
  const histories = new Map<string, Awaited<ReturnType<typeof client.getArtifactVersions>>["versions"]>();
  await Promise.all(
    sboms
      .filter((a) => a.has_content)
      .map(async (a) =>
        histories.set(a.id, (await client.getArtifactVersions(vendorId, tc.ownerToken, a.id)).versions),
      ),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Bill of Materials</h1>
      <p className="text-sm text-slate-600">
        Publish your Software Bill of Materials (SBOM). Each upload is versioned with a recorded
        sha256 and date, so customers and agents can see what changed and verify what they download.
        CycloneDX and SPDX are supported.
      </p>

      <div className="space-y-3">
        {sboms.length === 0 && (
          <div className="card text-sm text-slate-500">No SBOMs yet. Upload one below.</div>
        )}
        {sboms.map((a) => (
          <div key={a.id} className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {a.title || "Software Bill of Materials"}{" "}
                  {a.format && <span className="badge bg-slate-100 text-slate-600">{a.format}</span>}{" "}
                  <span className={`badge ${a.access === "public" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {a.access === "public" ? "public" : "private"}
                  </span>{" "}
                  <span className="badge bg-slate-100 text-slate-700">v{a.version}</span>
                </div>
                <div className="text-xs text-slate-400">
                  {a.id} · issued {a.issued_at}
                  {a.sha256 ? ` · sha256 ${a.sha256.slice(0, 12)}…` : " · no file uploaded yet"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <form action={uploadContent.bind(null, vendorId, a.id)} className="flex items-center gap-2">
                  <input type="file" name="file" required className="text-xs" />
                  <input name="note" className="input !w-32 !py-1 text-xs" placeholder="version note" />
                  <button className="btn-ghost" type="submit">{a.has_content ? "New version" : "Upload"}</button>
                </form>
                <form action={deleteArtifact.bind(null, vendorId, a.id)}>
                  <button className="btn-danger" type="submit">Delete</button>
                </form>
              </div>
            </div>
            {a.has_content && (histories.get(a.id)?.length ?? 0) > 0 && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer">Version history ({histories.get(a.id)!.length})</summary>
                <ul className="mt-1 space-y-1">
                  {histories.get(a.id)!.map((v) => (
                    <li key={v.version}>
                      v{v.version}
                      {v.current ? " (current)" : ""} · {v.issued_at}
                      {v.sha256 ? ` · ${v.sha256.slice(0, 10)}…` : ""}
                      {v.note ? ` · ${v.note}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>

      <form action={addSbom.bind(null, vendorId)} className="card grid gap-3 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Add an SBOM</h2>
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" name="title" className="input" placeholder="Acme Platform SBOM" />
        </div>
        <div>
          <label className="label" htmlFor="format">Format</label>
          <Select
            id="format"
            name="format"
            defaultValue="cyclonedx-1.6"
            ariaLabel="SBOM format"
            options={FORMATS.map((f) => ({ value: f, label: f }))}
          />
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
          <label className="label" htmlFor="file">SBOM file (optional, can upload later)</label>
          <input id="file" name="file" type="file" className="text-sm" />
        </div>
        <button className="btn-primary sm:col-span-2" type="submit">Add SBOM</button>
      </form>
    </div>
  );
}
