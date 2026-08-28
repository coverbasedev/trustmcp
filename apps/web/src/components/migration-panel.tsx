"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  deleteMigration,
  resumeMigration,
  retryMigration,
  startMigration,
  type MigrationFormState,
} from "@/app/(app)/tc/[vendorId]/migrations/actions";

export interface MigrationLogEntry {
  at: string;
  step: string;
  detail: string;
}

export interface MigrationView {
  id: string;
  sourceUrl: string;
  requesterEmail: string | null;
  status: string;
  statusDetail: string | null;
  sessionReplayUrl: string | null;
  ndaSigned: boolean;
  importedCount: number;
  createdAt: string;
  log: MigrationLogEntry[];
}

const ACTIVE_STATUSES = new Set(["pending", "requesting", "importing"]);

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  requesting: "bg-amber-50 text-amber-700",
  awaiting_release: "bg-blue-50 text-blue-700",
  importing: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  requesting: "Requesting access",
  awaiting_release: "Awaiting release",
  importing: "Importing",
  completed: "Completed",
  failed: "Failed",
};

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>
      {pending ? busy : label}
    </button>
  );
}

function ActionButton({
  label,
  className = "btn-ghost",
}: {
  label: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? "…" : label}
    </button>
  );
}

export default function MigrationPanel({
  vendorId,
  migrations,
  canManage,
  configured,
}: {
  vendorId: string;
  migrations: MigrationView[];
  canManage: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<MigrationFormState, FormData>(
    startMigration.bind(null, vendorId),
    {},
  );

  // Poll for progress while any migration is mid-flight.
  const hasActive = migrations.some((m) => ACTIVE_STATUSES.has(m.status));
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [hasActive, router]);

  return (
    <div className="space-y-6">
      {canManage && (
        <form action={formAction} className="panel space-y-4 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Start a new migration</h2>
          {state?.error && <div className="banner-error">{state.error}</div>}

          <div>
            <label className="label" htmlFor="source_url">
              Source trust center URL
            </label>
            <input
              id="source_url"
              name="source_url"
              required
              className="input"
              placeholder="https://trust.acme.com"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="requester_email">
                Requester email
              </label>
              <input
                id="requester_email"
                name="requester_email"
                type="email"
                required
                className="input"
                placeholder="security@yourco.com"
              />
            </div>
            <div>
              <label className="label" htmlFor="requester_name">
                Requester name
              </label>
              <input
                id="requester_name"
                name="requester_name"
                className="input"
                placeholder="Jane Doe"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="requester_company">
              Requester company
            </label>
            <input
              id="requester_company"
              name="requester_company"
              className="input"
              placeholder="YourCo, Inc."
            />
          </div>

          <div>
            <label className="label" htmlFor="access_notes">
              Access details (optional)
            </label>
            <textarea
              id="access_notes"
              name="access_notes"
              rows={3}
              className="input"
              placeholder="Invite code, login email, or any instructions needed to reach the documents."
            />
          </div>

          <div className="flex justify-end">
            <SubmitButton label="Start AI migration" busy="Starting…" />
          </div>
          {!configured && (
            <p className="text-xs text-slate-500">
              Migrations are disabled until the deployment is configured.
            </p>
          )}
        </form>
      )}

      <div className="space-y-3">
        {migrations.length === 0 && (
          <div className="card text-sm text-slate-500">No migrations yet.</div>
        )}
        {migrations.map((m) => (
          <MigrationCard key={m.id} vendorId={vendorId} m={m} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

function MigrationCard({
  vendorId,
  m,
  canManage,
}: {
  vendorId: string;
  m: MigrationView;
  canManage: boolean;
}) {
  const [showLog, setShowLog] = useState(false);
  const active = ACTIVE_STATUSES.has(m.status);

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`badge ${STATUS_STYLE[m.status] ?? "bg-slate-100 text-slate-600"}`}>
              {active && (
                <span
                  className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]"
                  aria-hidden
                />
              )}
              {STATUS_LABEL[m.status] ?? m.status}
            </span>
            {m.ndaSigned && <span className="badge bg-slate-100 text-slate-600">NDA signed</span>}
            {m.importedCount > 0 && (
              <span className="badge bg-slate-100 text-slate-600">{m.importedCount} imported</span>
            )}
          </div>
          <a
            href={m.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate text-sm font-medium text-slate-900 hover:text-brand-700"
          >
            {m.sourceUrl}
          </a>
          {m.statusDetail && <p className="mt-0.5 text-sm text-slate-500">{m.statusDetail}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {m.sessionReplayUrl && (
            <a href={m.sessionReplayUrl} target="_blank" rel="noreferrer" className="btn-ghost">
              Watch session ↗
            </a>
          )}
          {canManage && m.status === "awaiting_release" && (
            <form action={resumeMigration.bind(null, vendorId, m.id)}>
              <ActionButton label="Resume" className="btn-primary" />
            </form>
          )}
          {canManage && m.status === "failed" && (
            <form action={retryMigration.bind(null, vendorId, m.id)}>
              <ActionButton label="Retry" />
            </form>
          )}
          {canManage && !active && (
            <form action={deleteMigration.bind(null, vendorId, m.id)}>
              <ActionButton label="Delete" />
            </form>
          )}
        </div>
      </div>

      {m.log.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="text-xs font-medium text-brand-600 hover:text-brand-500"
          >
            {showLog ? "Hide" : "Show"} log ({m.log.length})
          </button>
          {showLog && (
            <ol className="mt-2 space-y-1 border-l border-slate-200 pl-3 text-xs text-slate-500">
              {m.log.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-slate-400">
                    {new Date(e.at).toLocaleTimeString()}
                  </span>{" "}
                  <span className="font-medium text-slate-600">{e.step}</span> — {e.detail}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
