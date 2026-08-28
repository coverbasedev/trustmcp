import Link from "next/link";
import { trustmcp } from "@/lib/trustmcp";
import { TrustMark } from "@/components/logo";

export const dynamic = "force-dynamic";

export default async function DirectoryPage() {
  let vendors: Awaited<ReturnType<ReturnType<typeof trustmcp>["getDirectory"]>>["vendors"] = [];
  try {
    vendors = (await trustmcp().getDirectory()).vendors;
  } catch {
    vendors = [];
  }

  return (
    <div className="ui-90 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Trust Directory</h1>
        <p className="text-sm text-slate-600">
          Vendors publishing a trust center on TrustMCP. Open one to see published
          evidence and request scoped access.
        </p>
      </div>

      {vendors.length === 0 && (
        <div className="card text-sm text-slate-500">No published vendors yet.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <Link key={v.id} href={`/trust/${v.id}`} className="card hover:border-slate-400">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{v.display_name}</div>
              {v.mark === "agent-ready" && (
                <span className="badge bg-emerald-50 text-emerald-700">
                  <TrustMark className="h-3.5 w-3.5" /> Verified
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-slate-600">{v.headline ?? v.product ?? ""}</div>
            <div className="mt-2 text-xs text-slate-400">{v.domains.join(", ")}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
