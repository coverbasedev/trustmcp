import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ClauseForm } from "@/components/mcp-audit/ClauseForm";
import { CredentialForm } from "@/components/mcp-audit/CredentialForm";
import { db } from "@/lib/db";
import { encryptionConfigured } from "@/lib/mcp-audit/crypto";
import { PROVIDER_LABEL, type LlmProvider } from "@/lib/mcp-audit/llm";
import { primaryOrgId } from "@/lib/mcp-audit/store";
import { RISK_DIMENSIONS } from "@/lib/mcp-audit/taxonomy";
import { STATIC_CONTROLS } from "@/lib/mcp-audit/controls";
import { deleteClause, deleteCredential } from "../actions";

const STATIC_CONTROLS_COUNT = STATIC_CONTROLS.length;

export const dynamic = "force-dynamic";

export default async function AuditSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const orgId = await primaryOrgId(session.user.id);
  if (!orgId) redirect("/dashboard");

  const [credentials, clauses] = await Promise.all([
    db.llmCredential.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
    db.auditClause.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
  ]);
  const dims = RISK_DIMENSIONS.map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="space-y-8">
      {/* Credentials */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Model credentials</h2>
          <p className="text-sm text-slate-600">
            Scans run on your own LLM keys. Add OpenAI and/or Anthropic keys and pick which models are
            available for scanning.
          </p>
        </div>
        {!encryptionConfigured() && (
          <div className="banner-warning">
            No encryption secret is set. Configure <code>AUDIT_ENCRYPTION_KEY</code> (or{" "}
            <code>AUTH_SECRET</code>) so credentials can be stored encrypted.
          </div>
        )}
        {credentials.length > 0 && (
          <div className="space-y-2">
            {credentials.map((c) => (
              <div key={c.id} className="card flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {PROVIDER_LABEL[c.provider as LlmProvider] ?? c.provider}
                    {c.label ? ` · ${c.label}` : ""}
                  </div>
                  <div className="text-xs text-slate-500">
                    default model {c.model}
                    {c.baseUrl ? ` · ${c.baseUrl}` : ""} ·{" "}
                    <span className={c.status === "ok" ? "text-emerald-600" : c.status === "error" ? "text-red-600" : "text-slate-400"}>
                      {c.status}
                    </span>
                  </div>
                </div>
                <form action={deleteCredential.bind(null, c.id)}>
                  <button className="btn-ghost text-red-600" type="submit">
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
        <div className="card">
          <CredentialForm />
        </div>
      </section>

      {/* Static controls + custom clauses */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Controls &amp; clauses</h2>
          <p className="text-sm text-slate-600">
            Every scan validates {STATIC_CONTROLS_COUNT} built-in controls plus any custom clauses you
            add here. Clauses are your reusable policy checks, evaluated against every MCP server you
            scan in this workspace.
          </p>
        </div>

        {clauses.length > 0 && (
          <div className="space-y-2">
            {clauses.map((c) => (
              <div key={c.id} className="card flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-slate-100 text-slate-600">
                      {dims.find((d) => d.id === c.dimension)?.name ?? c.dimension}
                    </span>
                    {!c.enabled && <span className="badge bg-slate-100 text-slate-400">disabled</span>}
                  </div>
                  <div className="mt-1 font-medium">{c.title}</div>
                  <div className="text-sm text-slate-600">{c.intent}</div>
                </div>
                <form action={deleteClause.bind(null, c.id)}>
                  <button className="btn-ghost text-red-600" type="submit">
                    Delete
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <ClauseForm dimensions={dims} />
        </div>
      </section>
    </div>
  );
}
