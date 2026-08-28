import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManage } from "@/lib/roles";
import { getRole } from "@/lib/team";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import { migrationEnv } from "@/lib/browserbase";
import MigrationPanel, { type MigrationView } from "@/components/migration-panel";

export const dynamic = "force-dynamic";

export default async function MigrationsPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");

  const role = await getRole(session.user.id, tc.orgId);
  const manage = canManage(role);
  const configured = migrationEnv() !== null;

  const rows = await db.trustCenterMigration.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
  });

  const migrations: MigrationView[] = rows.map((m) => ({
    id: m.id,
    sourceUrl: m.sourceUrl,
    requesterEmail: m.requesterEmail,
    status: m.status,
    statusDetail: m.statusDetail,
    sessionReplayUrl: m.sessionReplayUrl,
    ndaSigned: m.ndaSigned,
    importedCount: m.importedCount,
    createdAt: m.createdAt.toISOString(),
    log: Array.isArray(m.log) ? (m.log as unknown as MigrationView["log"]) : [],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI migration</h1>
        <p className="mt-1 text-sm text-slate-600">
          Import an existing trust center into this one. We start a Browserbase session, request
          access to the source&apos;s documentation (signing an NDA if required), and pause so the
          source owner can release the documents. Press <strong>Resume</strong> and we pull every
          document and all profile content, AI-label the files, and copy everything here.
        </p>
      </div>

      {!configured && (
        <div className="banner-warning">
          AI migration isn&apos;t configured on this deployment. Set <code>BROWSERBASE_API_KEY</code>,{" "}
          <code>BROWSERBASE_PROJECT_ID</code> and <code>TRUSTMCP_ANTHROPIC_API_KEY</code> to enable it.
        </div>
      )}

      {!manage && (
        <div className="banner-warning">
          You need admin or owner access to run a migration.
        </div>
      )}

      <MigrationPanel
        vendorId={vendorId}
        migrations={migrations}
        canManage={manage}
        configured={configured}
      />
    </div>
  );
}
