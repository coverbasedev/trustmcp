import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NewScanForm, type ModelChoice } from "@/components/mcp-audit/NewScanForm";
import { MODEL_CATALOG, PROVIDER_LABEL, type LlmProvider } from "@/lib/mcp-audit/llm";
import { availableProviders, primaryOrgId } from "@/lib/mcp-audit/store";

export const dynamic = "force-dynamic";

export default async function NewScanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const orgId = await primaryOrgId(session.user.id);
  const providers = orgId ? await availableProviders(orgId) : [];

  // Build the model choices from the providers the org actually has credentials
  // for. Each provider's whole catalog is offered, plus its stored default.
  const seen = new Set<string>();
  const models: ModelChoice[] = [];
  for (const p of providers) {
    const catalog = MODEL_CATALOG[p.provider as LlmProvider] ?? [];
    for (const m of catalog) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      models.push({ id: m.id, label: m.label, provider: PROVIDER_LABEL[p.provider as LlmProvider] });
    }
    if (p.model && !seen.has(p.model)) {
      seen.add(p.model);
      models.push({ id: p.model, label: p.model, provider: PROVIDER_LABEL[p.provider as LlmProvider] });
    }
  }

  if (models.length === 0) {
    return (
      <div className="card text-center">
        <h2 className="text-lg font-semibold">Add a model credential first</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
          Scans run on your own OpenAI or Anthropic key. Add one and pick the models you want to make
          available for scanning.
        </p>
        <Link href="/audit/settings" className="btn-primary mt-4 inline-block">
          Add credentials
        </Link>
      </div>
    );
  }

  return <NewScanForm models={models} />;
}
