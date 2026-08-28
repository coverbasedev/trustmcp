import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";

// Owner-only audit export. /api/tc/{vendorId}/audit?format=csv|json
export async function GET(req: Request, ctx: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const format = new URL(req.url).searchParams.get("format") ?? "csv";

  if (format === "json") {
    const rows = await trustmcp().getAudit(vendorId, tc.ownerToken);
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="audit-${vendorId}.json"`,
      },
    });
  }

  // CSV: proxy the network's CSV export with the stored owner token.
  const network = process.env.TRUSTMCP_NETWORK_URL ?? "http://localhost:8000";
  const res = await fetch(`${network}/v1/vendors/${vendorId}/audit.csv`, {
    headers: { "x-trustmcp-owner-token": tc.ownerToken },
  });
  if (!res.ok) return NextResponse.json({ error: "export failed" }, { status: 502 });
  return new NextResponse(await res.text(), {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="audit-${vendorId}.csv"`,
    },
  });
}
