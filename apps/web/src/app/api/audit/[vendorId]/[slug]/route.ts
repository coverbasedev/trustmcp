import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Public read API for a published MCP audit scorecard. Only scans that have been
// explicitly published to a trust center are exposed, and only the report-facing
// fields — never the target auth, the operator's LLM config, or the interrogation
// transcript. This is what the MCP interaction layer and any external tool read.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ vendorId: string; slug: string }> },
) {
  const { vendorId, slug } = await params;
  const scan = await db.mcpAuditScan.findFirst({
    where: { publishSlug: slug, publishedVendorId: vendorId, published: true },
  });
  if (!scan || !scan.scorecard) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const evidence = scan.evidence as { bundle?: { contentHash?: string }; attestation?: unknown } | null;
  return NextResponse.json({
    name: scan.name,
    description: scan.description,
    target: scan.targetUrl,
    vendorId,
    slug,
    version: scan.publishedVersion,
    publishedAt: scan.publishedAt,
    grade: scan.grade,
    overallScore: scan.overallScore,
    scorecard: scan.scorecard,
    research: scan.research,
    evidence: evidence
      ? { contentHash: evidence.bundle?.contentHash, attestation: evidence.attestation }
      : null,
  });
}
