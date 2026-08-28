import type { Metadata } from "next";
import PublicTrustCenter, { buildTrustMetadata } from "@/components/trust/PublicTrustCenter";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}): Promise<Metadata> {
  const { vendorId } = await params;
  return buildTrustMetadata(vendorId);
}

export default async function PublicTrustCenterPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  return <PublicTrustCenter vendorId={vendorId} />;
}
