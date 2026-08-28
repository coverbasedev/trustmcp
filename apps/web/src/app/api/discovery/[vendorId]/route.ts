import { NextResponse } from "next/server";
import { trustmcp } from "@/lib/trustmcp";

// Returns the TrustMCP discovery record for a vendor. A vendor hosts this content at
// https://<their-domain>/.well-known/trustmcp.json (copy it, or proxy this route).
export async function GET(_req: Request, ctx: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await ctx.params;
  const network = process.env.TRUSTMCP_NETWORK_URL ?? "http://localhost:8000";
  try {
    const profile = await trustmcp().getPublicProfile(vendorId);
    const body: Record<string, unknown> = {
      schema_version: "0.1",
      vendor_id: profile.vendor.id,
      legal_name: profile.vendor.legal_name,
      network,
      manifest: `${network}/v1/vendors/${vendorId}/manifest`,
    };
    if (profile.mark === "agent-ready") body.mark = "agent-ready";
    return NextResponse.json(body, {
      headers: { "cache-control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json({ error: "not found or not published" }, { status: 404 });
  }
}
