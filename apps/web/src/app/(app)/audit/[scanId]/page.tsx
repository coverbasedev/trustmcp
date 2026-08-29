import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { DescriptionEditor } from "@/components/mcp-audit/DescriptionEditor";
import { Interrogate } from "@/components/mcp-audit/Interrogate";
import { ScanPoller } from "@/components/mcp-audit/ScanPoller";
import { GradeBadge, OutcomeChip, RiskMeter, SeverityChip } from "@/components/mcp-audit/ui";
import { aggregateDataClasses, DATA_CLASS_LABEL } from "@/lib/mcp-audit/classify";
import { getDimension } from "@/lib/mcp-audit/taxonomy";
import { getScanForUser } from "@/lib/mcp-audit/store";
import { listTrustCenters } from "@/lib/trustcenter";
import type {
  ControlResult,
  DynamicProbe,
  Scorecard,
  ScanLogEntry,
  ToolRecord,
} from "@/lib/mcp-audit/types";
import { deleteScan, publishScan, rescan, unpublishScan } from "../actions";

export const dynamic = "force-dynamic";

const ACTIVE = new Set(["pending", "inspecting", "researching", "probing", "scoring"]);

export default async function ScanReportPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const scan = await getScanForUser(session.user.id, scanId);
  if (!scan) notFound();

  const log = (Array.isArray(scan.log) ? scan.log : []) as unknown as ScanLogEntry[];
  const tools = (scan.toolInventory as unknown as ToolRecord[]) ?? [];
  const probes = (scan.probes as unknown as DynamicProbe[]) ?? [];
  const controls = (scan.controls as unknown as ControlResult[]) ?? [];
  const scorecard = (scan.scorecard as unknown as Scorecard) ?? null;
  const evidence = scan.evidence as
    | { bundle?: { contentHash?: string }; attestation?: { submitted?: boolean; proofId?: string; verifyUrl?: string; note?: string; contentHash?: string } }
    | null;
  const active = ACTIVE.has(scan.status);
  const dataClasses = aggregateDataClasses(tools);
  const trustCenters = await listTrustCenters(session.user.id);

  return (
    <div className="space-y-6">
      <ScanPoller status={scan.status} />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/audit/scans" className="text-xs text-slate-400 hover:text-slate-600">
            ← All scans
          </Link>
          <h1 className="mt-0.5 text-2xl font-semibold">{scan.name}</h1>
          <div className="truncate text-sm text-slate-500">{scan.targetUrl}</div>
          <div className="mt-1 text-xs text-slate-400">
            {scan.model} · {scan.authKind === "none" ? "no auth" : scan.authDetail}
            {scan.published && " · published"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {scan.status === "completed" && <GradeBadge grade={scan.grade} score={scan.overallScore} />}
          <form action={rescan.bind(null, scanId)}>
            <button className="btn-ghost" type="submit" disabled={active}>
              Re-scan
            </button>
          </form>
          <form action={deleteScan.bind(null, scanId)}>
            <button className="btn-ghost text-red-600" type="submit">
              Delete
            </button>
          </form>
        </div>
      </div>

      {/* Progress / status */}
      {(active || scan.status === "failed") && (
        <div className={scan.status === "failed" ? "banner-error" : "card"}>
          <div className="flex items-center gap-2">
            {active && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />}
            <span className="font-medium capitalize">{scan.status}</span>
            <span className="text-sm text-slate-600">{scan.statusDetail}</span>
          </div>
          {log.length > 0 && (
            <ol className="mt-3 space-y-1 border-l border-slate-200 pl-4 text-xs text-slate-500">
              {log.slice(-12).map((e, i) => (
                <li key={i}>
                  <span className="font-medium text-slate-600">{e.phase}</span> — {e.detail}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {scorecard && (
        <>
          {/* Executive summary */}
          <section className="card space-y-3">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold">{scorecard.headline}</h2>
              <GradeBadge grade={scorecard.grade} score={scorecard.overallScore} />
            </div>
            {scorecard.executiveSummary && (
              <p className="text-sm leading-relaxed text-slate-700">{scorecard.executiveSummary}</p>
            )}
            {scorecard.typicalUse && (
              <div>
                <div className="text-xs font-medium uppercase text-slate-400">Typical use</div>
                <p className="text-sm text-slate-700">{scorecard.typicalUse}</p>
              </div>
            )}
            <div>
              <div className="text-xs font-medium uppercase text-slate-400">Description</div>
              <DescriptionEditor scanId={scanId} initial={scan.description} />
            </div>
          </section>

          {/* Data exchanged — the types of data fields the server can move */}
          {dataClasses.length > 0 && (
            <section className="card space-y-2">
              <h3 className="font-semibold">Data fields exchanged</h3>
              <p className="text-sm text-slate-600">
                Data classes the tool surface can read or write, and the tools that expose each. This is
                the data your integration is likely to share with the server.
              </p>
              <div className="space-y-1">
                {dataClasses.map((d) => (
                  <div key={d.dataClass} className="flex items-center justify-between gap-3 text-sm">
                    <span className="badge bg-slate-100 text-slate-700">
                      {DATA_CLASS_LABEL[d.dataClass] ?? d.dataClass}
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {d.tools.length} tool{d.tools.length === 1 ? "" : "s"}: {d.tools.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Security & threat model */}
          {(scorecard.securityModel || scorecard.threatModel) && (
            <section className="grid gap-4 md:grid-cols-2">
              {scorecard.securityModel && (
                <div className="card">
                  <h3 className="font-semibold">Security model</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{scorecard.securityModel}</p>
                </div>
              )}
              {scorecard.threatModel && (
                <div className="card">
                  <h3 className="font-semibold">Threat model</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{scorecard.threatModel}</p>
                </div>
              )}
            </section>
          )}

          {/* What to audit / watch */}
          {(scorecard.whatToAudit.length > 0 || scorecard.whatToWatch.length > 0) && (
            <section className="grid gap-4 md:grid-cols-2">
              {scorecard.whatToAudit.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold">What to audit</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {scorecard.whatToAudit.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {scorecard.whatToWatch.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold">What to watch for</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {scorecard.whatToWatch.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Risk dimensions */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Risk by dimension</h2>
            <div className="space-y-2">
              {scorecard.dimensions.map((d) => {
                const meta = getDimension(d.dimension);
                return (
                  <div key={d.dimension} className="card space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{meta?.name ?? d.dimension}</div>
                        <div className="text-xs text-slate-500">{meta?.summary}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <SeverityChip severity={d.severity} />
                        <span className="text-sm font-semibold text-slate-700">{d.score}</span>
                      </div>
                    </div>
                    <RiskMeter score={d.score} />
                    {d.summary && <p className="text-sm text-slate-700">{d.summary}</p>}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {d.safeFactors.length > 0 && (
                        <div>
                          <div className="text-xs font-medium uppercase text-emerald-600">Safe factors</div>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                            {d.safeFactors.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {d.unsafeFactors.length > 0 && (
                        <div>
                          <div className="text-xs font-medium uppercase text-red-600">Unsafe factors</div>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                            {d.unsafeFactors.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Findings */}
          {scorecard.findings.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Findings</h2>
              <div className="space-y-2">
                {scorecard.findings.map((f) => (
                  <div key={f.id} className="card">
                    <div className="flex items-center gap-2">
                      <SeverityChip severity={f.severity} />
                      <span className="font-medium">{f.title}</span>
                      <span className="badge bg-slate-100 text-slate-500">{getDimension(f.dimension)?.name}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{f.detail}</p>
                    {f.recommendation && (
                      <p className="mt-1 text-sm text-slate-600">
                        <span className="font-medium">Recommendation:</span> {f.recommendation}
                      </p>
                    )}
                    {f.evidence.length > 0 && (
                      <div className="mt-1 text-xs text-slate-400">Evidence: {f.evidence.join(", ")}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Integration analysis */}
          {scorecard.integrationAnalysis.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Integration analysis</h2>
              {scorecard.integrationAnalysis.map((a, i) => (
                <div key={i} className="card space-y-2">
                  <div className="font-medium">{a.description}</div>
                  {a.likelyDataTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {a.likelyDataTypes.map((t, j) => (
                        <span key={j} className="badge bg-slate-100 text-slate-600">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.interactionPattern && (
                    <p className="text-sm text-slate-700">
                      <span className="font-medium">Interaction:</span> {a.interactionPattern}
                    </p>
                  )}
                  {a.keyRisks.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                      {a.keyRisks.map((r, j) => (
                        <li key={j}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {a.recommendation && <p className="text-sm text-slate-600">{a.recommendation}</p>}
                </div>
              ))}
            </section>
          )}

          {/* Controls */}
          {controls.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Controls &amp; clauses</h2>
              <div className="card divide-y divide-slate-100">
                {controls.map((c) => (
                  <div key={c.controlId} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.title}</span>
                        {c.custom && <span className="badge bg-brand-50 text-brand-700">clause</span>}
                      </div>
                      <div className="text-xs text-slate-500">{c.rationale}</div>
                    </div>
                    <OutcomeChip outcome={c.outcome} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tools + probes */}
          <section className="grid gap-4 md:grid-cols-2">
            <div className="card">
              <h3 className="font-semibold">Tool inventory ({tools.length})</h3>
              <div className="mt-2 space-y-1 text-xs">
                {tools.map((t) => (
                  <div key={t.name} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono">{t.name}</span>
                    <span className="flex shrink-0 gap-1">
                      <span className="badge bg-slate-100 text-slate-600">{t.action}</span>
                      {t.injectionSuspected && <span className="badge bg-red-50 text-red-700">injection?</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 className="font-semibold">Dynamic probes ({probes.length})</h3>
              <div className="mt-2 space-y-2 text-xs">
                {probes.map((p) => (
                  <div key={p.id} className="rounded border border-slate-100 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-700">{p.hypothesis}</span>
                      <span className={`badge ${p.executed ? "bg-emerald-50 text-emerald-700" : p.safety === "read_only" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>
                        {p.executed ? "ran" : p.safety === "read_only" ? "read-only" : "review only"}
                      </span>
                    </div>
                    {p.observation && <div className="mt-1 text-slate-500">{p.observation}</div>}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Evidence / Corsair */}
          {evidence?.bundle && (
            <section className="card space-y-1">
              <h3 className="font-semibold">Evidence &amp; proof</h3>
              <p className="text-sm text-slate-600">
                Raw evidence bundle (handshake, tool contract, read-only probe transcript) is stored and
                content-hashed so the scorecard is verifiable.
              </p>
              <div className="mt-1 font-mono text-xs text-slate-500">
                sha256: {evidence.bundle.contentHash}
              </div>
              {evidence.attestation?.submitted ? (
                <div className="text-xs text-emerald-700">
                  Corsair proof {evidence.attestation.proofId}
                  {evidence.attestation.verifyUrl && (
                    <>
                      {" · "}
                      <a href={evidence.attestation.verifyUrl} className="underline" target="_blank" rel="noreferrer">
                        verify
                      </a>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-400">{evidence.attestation?.note}</div>
              )}
            </section>
          )}

          {/* Interrogation */}
          <section className="card space-y-3">
            <div>
              <h3 className="font-semibold">Interrogate this audit</h3>
              <p className="text-sm text-slate-600">
                Ask a follow-up. The assistant answers from the scan evidence and can propose fresh
                dynamic probes for a deeper live inspection.
              </p>
            </div>
            <Interrogate scanId={scanId} />
          </section>

          {/* Publish */}
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Publish to a trust center</h3>
              {scan.published && <span className="badge bg-brand-50 text-brand-700">live</span>}
            </div>
            <p className="text-sm text-slate-600">
              Publish this scorecard on one of your trust centers so customers can see how your MCP
              server scores. Add a description and pick which version to publish.
            </p>
            {trustCenters.length === 0 ? (
              <div className="text-sm text-slate-500">You don&apos;t manage any trust centers yet.</div>
            ) : scan.published ? (
              <form action={unpublishScan.bind(null, scanId)}>
                <div className="text-sm text-slate-600">
                  Published as version <span className="font-mono">{scan.publishedVersion}</span> on{" "}
                  <span className="font-mono">{scan.publishedVendorId}</span>.
                  {scan.publishSlug && (
                    <>
                      {" "}
                      <Link
                        href={`/trust/${scan.publishedVendorId}/audit/${scan.publishSlug}`}
                        className="underline"
                        target="_blank"
                      >
                        View public page ↗
                      </Link>
                    </>
                  )}
                </div>
                <button className="btn-ghost mt-2 text-red-600" type="submit">
                  Unpublish
                </button>
              </form>
            ) : (
              <form action={publishScan.bind(null, scanId)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="label">Trust center</label>
                  <select name="vendor_id" className="input">
                    {trustCenters.map((tc) => (
                      <option key={tc.vendorId} value={tc.vendorId}>
                        {tc.legalName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Version</label>
                  <input name="version" className="input" placeholder="v1.0" />
                </div>
                <button className="btn-primary" type="submit">
                  Publish
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
