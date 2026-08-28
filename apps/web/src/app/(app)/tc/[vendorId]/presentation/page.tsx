import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Select } from "@/components/select";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { saveResourceDisplay, saveResourcePresentation } from "../actions";

export const dynamic = "force-dynamic";

export default async function PresentationPage({
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
  const [{ display, categories_in_use }, artifacts] = await Promise.all([
    client.getResourceDisplay(vendorId, tc.ownerToken),
    client.listArtifacts(vendorId, tc.ownerToken),
  ]);

  // Show the list in the order visitors will see it: position, then newest first.
  const ordered = [...artifacts].sort(
    (a, b) =>
      (a.position ?? 0) - (b.position ?? 0) ||
      (a.issued_at < b.issued_at ? 1 : a.issued_at > b.issued_at ? -1 : 0),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Resource presentation</h1>
        <p className="text-sm text-slate-600">
          How your documents read on the public trust center: what visitors see, in what
          order, and grouped how. Hiding a resource removes it from the listing — it does
          not change who is allowed to download it, which is the{" "}
          <strong>visibility</strong> setting on the resource itself.
        </p>
      </div>

      <form
        action={saveResourceDisplay.bind(null, vendorId)}
        className="card grid gap-3 sm:grid-cols-2"
      >
        <h2 className="font-semibold sm:col-span-2">Layout</h2>
        <div>
          <label className="label" htmlFor="layout">Style</label>
          <Select
            id="layout"
            name="layout"
            defaultValue={display.layout}
            ariaLabel="Layout"
            options={[
              { value: "list", label: "List" },
              { value: "grid", label: "Grid of cards" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
        <div>
          <label className="label" htmlFor="group_by">Group by</label>
          <Select
            id="group_by"
            name="group_by"
            defaultValue={display.group_by}
            ariaLabel="Grouping"
            options={[
              { value: "category", label: "Category" },
              { value: "type", label: "Document type" },
              { value: "product", label: "Product line" },
              { value: "none", label: "No grouping" },
            ]}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="category_order">Category order</label>
          <input
            id="category_order"
            name="category_order"
            className="input"
            defaultValue={display.category_order.join(", ")}
            placeholder="Compliance, Penetration Testing, Privacy"
          />
          <p className="mt-1 text-xs text-slate-500">
            Comma-separated. Categories you do not list appear after these, alphabetically —
            so adding a new category never makes it disappear.
            {categories_in_use.length > 0 && (
              <> In use: {categories_in_use.join(", ")}.</>
            )}
          </p>
        </div>

        <div className="sm:col-span-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="show_descriptions"
              defaultChecked={display.show_descriptions}
            />
            Show descriptions
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="show_dates" defaultChecked={display.show_dates} />
            Show issue and expiry dates
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="show_hashes" defaultChecked={display.show_hashes} />
            Show SHA-256 hashes
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="feature_band" defaultChecked={display.feature_band} />
            Pin featured resources to the top
          </label>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="empty_message">
            Message when nothing is published (optional)
          </label>
          <input
            id="empty_message"
            name="empty_message"
            className="input"
            defaultValue={display.empty_message ?? ""}
            placeholder="Request access to see our documentation."
          />
        </div>

        <button className="btn-primary sm:col-span-2" type="submit">Save layout</button>
      </form>

      <form action={saveResourcePresentation.bind(null, vendorId)} className="card space-y-3">
        <h2 className="font-semibold">Resources</h2>
        <p className="text-sm text-slate-600">
          Lower positions come first within a group. Resources sharing a position fall back
          to newest first.
        </p>

        {ordered.length === 0 && (
          <div className="text-sm text-slate-500">No resources yet.</div>
        )}

        {ordered.map((artifact) => (
          <div key={artifact.id} className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-12">
            <input type="hidden" name="presentation_id" value={artifact.id} />
            <input
              name="presentation_title"
              className="input sm:col-span-3"
              defaultValue={artifact.title ?? ""}
              placeholder={artifact.type}
              aria-label="Title"
            />
            <input
              name="presentation_description"
              className="input sm:col-span-4"
              defaultValue={artifact.description ?? ""}
              placeholder="Short description"
              aria-label="Description"
            />
            <input
              name="presentation_category"
              className="input sm:col-span-2"
              defaultValue={artifact.category ?? ""}
              placeholder="Category"
              aria-label="Category"
            />
            <input
              name="presentation_position"
              type="number"
              className="input sm:col-span-1"
              defaultValue={artifact.position ?? 0}
              aria-label="Position"
            />
            <label className="flex items-center gap-1.5 text-sm sm:col-span-1">
              <input
                type="checkbox"
                name="presentation_featured"
                value={artifact.id}
                defaultChecked={artifact.featured ?? false}
              />
              Feature
            </label>
            <label className="flex items-center gap-1.5 text-sm sm:col-span-1">
              <input
                type="checkbox"
                name="presentation_hidden"
                value={artifact.id}
                defaultChecked={artifact.hidden ?? false}
              />
              Hide
            </label>
            <div className="text-xs text-slate-400 sm:col-span-12">
              {artifact.id} · {artifact.type} ·{" "}
              {artifact.access === "public" ? "public" : "private"}
              {artifact.source === "drive" ? " · synced from Google Drive" : ""}
            </div>
          </div>
        ))}

        {ordered.length > 0 && (
          <button className="btn-primary" type="submit">Save resource presentation</button>
        )}
      </form>
    </div>
  );
}
