import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import AttestationsEditor from "@/components/attestations-editor";
import { autofillAttestations, saveAttestations } from "../actions";

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  empty: "Choose a questionnaire file first.",
  parse: "Couldn't read that questionnaire. Try CSV (key,value) or JSON.",
  nomatch: "No recognized claims were found in that questionnaire.",
};

export default async function AttestationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorId: string }>;
  searchParams: Promise<{ autofilled?: string; error?: string }>;
}) {
  const { vendorId } = await params;
  const { autofilled, error } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");
  const [{ claims }, artifacts] = await Promise.all([
    trustmcp().getOwnerAttestations(vendorId, tc.ownerToken),
    trustmcp().listArtifacts(vendorId, tc.ownerToken),
  ]);
  const artifactOpts = artifacts.map((a) => ({ id: a.id, title: a.title || a.type }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Attestations</h1>
      {autofilled && (
        <div className="banner-success">
          Auto-filled {autofilled} attestation{autofilled === "1" ? "" : "s"} from your questionnaire.
        </div>
      )}
      {error && ERROR_COPY[error] && <div className="banner-error">{ERROR_COPY[error]}</div>}
      <p className="text-sm text-slate-600">
        Structured claims let agents reason without parsing every PDF. Pick claims from the catalog
        (across security, privacy, legal, financial and more), set each value, and link evidence by
        selecting from your uploaded artifacts — no artifact IDs to key in. Or auto-fill everything
        from a completed questionnaire.
      </p>

      <AttestationsEditor
        initial={claims}
        artifacts={artifactOpts}
        action={saveAttestations.bind(null, vendorId)}
        autofillAction={autofillAttestations.bind(null, vendorId)}
      />
    </div>
  );
}
