import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { Select } from "@/components/select";
import ControlsLibraryPicker from "@/components/controls-library-picker";
import { addLibraryControls, parseControls, saveControls } from "../actions";

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  empty: "Add a file or paste your controls first.",
  parse: "Couldn't find any controls in that input. Try CSV (Category, Control, Status) or JSON.",
};

export default async function ControlsPage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorId: string }>;
  searchParams: Promise<{ saved?: string; added?: string; error?: string }>;
}) {
  const { vendorId } = await params;
  const { saved, added, error } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const { controls } = await trustmcp().getOwnerControls(vendorId, tc.ownerToken);

  const rows = [
    ...controls,
    ...Array(5).fill({ category: "", name: "", status: "operating" }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Controls</h1>
        <ControlsLibraryPicker action={addLibraryControls.bind(null, vendorId)} />
      </div>
      {saved && <div className="banner-success">Controls saved.</div>}
      {added && <div className="banner-success">Added {added} control{added === "1" ? "" : "s"} from the library.</div>}
      {error && ERROR_COPY[error] && <div className="banner-error">{ERROR_COPY[error]}</div>}
      <p className="text-sm text-slate-600">
        Security controls grouped by category, each with a status. Shown as a checkmark grid on your
        public trust center. Saving replaces the full list; blank rows are ignored.
      </p>

      {/* Import: upload or paste an internal control standard; we parse it into rows. */}
      <form action={parseControls.bind(null, vendorId)} className="card space-y-3">
        <div>
          <h2 className="font-semibold">Import control standards</h2>
          <p className="text-sm text-slate-500">
            Upload or paste your internal controls and we&apos;ll parse them into the list below.
            Accepts CSV/TSV (<span className="font-mono text-xs">Category, Control, Status</span>),
            JSON, or one control per line (<span className="font-mono text-xs">Category: Control</span>).
          </p>
        </div>
        <input type="file" name="file" accept=".csv,.tsv,.json,.txt,text/csv,application/json" className="text-sm" />
        <textarea
          name="bulk"
          rows={4}
          className="input font-mono text-xs"
          placeholder={"Infrastructure Security, Production data backups conducted, operating\nAccess Control, MFA enforced for all staff, operating"}
        />
        <button className="btn-ghost" type="submit">Parse &amp; import</button>
      </form>

      <form action={saveControls.bind(null, vendorId)} className="card space-y-2">
        <div className="grid grid-cols-[1fr_1.6fr_0.8fr] gap-2 text-xs font-medium uppercase text-slate-400">
          <span>Category</span>
          <span>Control</span>
          <span>Status</span>
        </div>
        {rows.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.6fr_0.8fr] gap-2">
            <input name="category" className="input" defaultValue={c.category} placeholder="Infrastructure Security" />
            <input name="name" className="input" defaultValue={c.name} placeholder="Production data backups conducted" />
            <Select
              name="status"
              defaultValue={c.status}
              ariaLabel="Control status"
              options={[
                { value: "operating", label: "Operating" },
                { value: "not_operating", label: "Not operating" },
              ]}
            />
          </div>
        ))}
        <button className="btn-primary" type="submit">Save controls</button>
      </form>
    </div>
  );
}
