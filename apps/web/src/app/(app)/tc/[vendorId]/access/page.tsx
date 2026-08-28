import { redirect } from "next/navigation";

export default async function AccessRedirect({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  redirect(`/tc/${vendorId}/requests`);
}
