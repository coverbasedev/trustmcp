import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { acceptInvitation } from "@/lib/team";

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=/invite/${token}`);

  const result = await acceptInvitation(token, session.user.id);

  return (
    <div className="ui-90 mx-auto max-w-md">
      <div className="card space-y-3">
        {result.ok ? (
          <>
            <h1 className="text-xl font-semibold">You're in 🎉</h1>
            <p className="text-sm text-slate-600">You've joined the workspace.</p>
            <Link href="/dashboard" className="btn-primary">Go to dashboard</Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Invitation unavailable</h1>
            <p className="text-sm text-slate-600">
              {result.reason === "expired" && "This invitation has expired. Ask for a new one."}
              {result.reason === "already" && "You're already a member of this workspace."}
              {result.reason === "not-found" && "This invitation is invalid or was revoked."}
            </p>
            <Link href="/dashboard" className="btn-ghost">Go to dashboard</Link>
          </>
        )}
      </div>
    </div>
  );
}
