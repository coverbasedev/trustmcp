import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { Select } from "@/components/select";
import { deleteArtifact, editArtifact, uploadContent } from "../../actions";

export const dynamic = "force-dynamic";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ vendorId: string; artifactId: string }>;
}) {
  const { vendorId, artifactId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const client = trustmcp();
  const all = await client.listArtifacts(vendorId, tc.ownerToken);
  const a = all.find((x) => x.id === artifactId);
  if (!a) notFound();
  const versions = a.has_content
    ? (await client.getArtifactVersions(vendorId, tc.ownerToken, artifactId)).versions
    : [];

  const isPublic = a.access === "public";
  const shareUrl = `${appUrl}/api/public-artifact/${vendorId}/${artifactId}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/tc/${vendorId}/artifacts`} className="text-xs text-slate-400 hover:text-slate-600">
          ← Resources
        </Link>
        <h1 className="mt-0.5 text-2xl font-semibold">{a.title || a.type}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span className="badge bg-slate-100 text-slate-600">{a.type}</span>
          {a.format && <span className="badge bg-slate-100 text-slate-600">{a.format}</span>}
          <span className={`badge ${isPublic ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {isPublic ? "public" : "private"}
          </span>
          <span className="badge bg-slate-100 text-slate-700">v{a.version}</span>
          {a.category && <span className="badge bg-brand-50 text-brand-700">{a.category}</span>}
        </div>
        <div className="mt-1 font-mono text-xs text-slate-400">
          {a.id}
          {a.sha256 ? ` · sha256 ${a.sha256}` : " · no file uploaded yet"}
        </div>
      </div>

      {/* Details + visibility */}
      <form action={editArtifact.bind(null, vendorId, artifactId)} className="card grid gap-3 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Details &amp; visibility</h2>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title">Title</label>
          <input id="title" name="title" className="input" defaultValue={a.title ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="issued_at">Issued</label>
          <input id="issued_at" name="issued_at" type="date" className="input" defaultValue={a.issued_at} />
        </div>
        <div>
          <label className="label" htmlFor="valid_until">Valid until</label>
          <input id="valid_until" name="valid_until" type="date" className="input" defaultValue={a.valid_until ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <input id="category" name="category" className="input" defaultValue={a.category ?? ""} placeholder="Compliance" />
        </div>
        <div>
          <label className="label" htmlFor="access">Visibility</label>
          <Select
            id="access"
            name="access"
            defaultValue={a.access}
            ariaLabel="Visibility"
            options={[
              { value: "key_required", label: "Private (request + approval required)" },
              { value: "public", label: "Public (anyone with the link)" },
            ]}
          />
        </div>
        <div className="sm:col-span-2">
          <button className="btn-primary" type="submit">Save</button>
        </div>
      </form>

      {/* Shareable URL */}
      <div className="card space-y-2">
        <h2 className="font-semibold">Shareable link</h2>
        {isPublic ? (
          <>
            <p className="text-sm text-slate-500">
              This artifact is public — anyone with this link can download the latest version:
            </p>
            <code className="block break-all rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">{shareUrl}</code>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            This artifact is private. Set visibility to <strong>Public</strong> above to generate a
            shareable download link, or keep it private and release it per request with a scoped key.
          </p>
        )}
      </div>

      {/* Content / versions */}
      <div className="card space-y-3">
        <h2 className="font-semibold">File &amp; versions</h2>
        <form action={uploadContent.bind(null, vendorId, artifactId)} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" required className="text-sm" />
          <input name="note" className="input !w-48 !py-1 text-sm" placeholder="version note" />
          <button className="btn-ghost" type="submit">{a.has_content ? "Upload new version" : "Upload file"}</button>
        </form>
        {versions.length > 0 && (
          <ul className="space-y-1 text-xs text-slate-500">
            {versions.map((v) => (
              <li key={v.version}>
                v{v.version}
                {v.current ? " (current)" : ""} · issued {v.issued_at}
                {v.sha256 ? ` · ${v.sha256.slice(0, 12)}…` : ""}
                {v.note ? ` · ${v.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Danger */}
      <div className="card border-red-200">
        <h2 className="font-semibold text-red-600">Delete artifact</h2>
        <p className="mt-1 text-sm text-slate-600">Removes this artifact and all its versions. This cannot be undone.</p>
        <form action={deleteArtifact.bind(null, vendorId, artifactId)} className="mt-2">
          <button className="btn-danger" type="submit">Delete artifact</button>
        </form>
      </div>
    </div>
  );
}
