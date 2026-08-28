import { NextResponse } from "next/server";
import { trustmcp } from "@/lib/trustmcp";

// Redirects to a short-lived signed URL for a PUBLIC artifact. Private artifacts
// return 404 here (the network refuses them without a key).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ vendorId: string; artifactId: string }> },
) {
  const { vendorId, artifactId } = await ctx.params;
  try {
    const link = await trustmcp().getPublicArtifact(vendorId, artifactId);
    return NextResponse.redirect(link.url);
  } catch {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
}
