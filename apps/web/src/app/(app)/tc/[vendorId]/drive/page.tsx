import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Select } from "@/components/select";
import { trustmcp } from "@/lib/trustmcp";
import { getTrustCenterForUser } from "@/lib/trustcenter";
import type { DriveFileItem } from "@trustmcp/sdk";
import {
  chooseDriveFolder,
  connectDrive,
  decideDriveFile,
  disconnectDrive,
  excludeDriveFiles,
  saveDriveRules,
  syncDrive,
  updateDriveConnection,
} from "../actions";

export const dynamic = "force-dynamic";

const TYPES = [
  "soc2_type2", "soc2_type1", "soc3", "iso_27001", "pentest", "insurance_coi",
  "financials", "dpa", "architecture", "subprocessor_list", "sbom", "policy",
  "questionnaire",
];

const ACCESS_OPTIONS = [
  { value: "key_required", label: "Private (request + approval)" },
  { value: "public", label: "Public (anyone can download)" },
];

function bytes(n: number | null): string {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default async function DrivePage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorId: string }>;
  searchParams?: Promise<{ drive_error?: string; pick?: string }>;
}) {
  const { vendorId } = await params;
  const { drive_error: driveError, pick } = (await searchParams) ?? {};
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tc = await getTrustCenterForUser(session.user.id, vendorId);
  if (!tc) redirect("/dashboard");

  const client = trustmcp();
  const connection = await client.getDriveConnection(vendorId, tc.ownerToken);

  // Fetch the consent URL only when the button will actually be shown.
  let consentUrl: string | null = null;
  if (connection.oauth_available && (!connection.connected || connection.needs_folder)) {
    consentUrl = (await client.driveOAuthStart(vendorId, tc.ownerToken)).authorization_url;
  }

  if (!connection.connected) {
    return (
      <ConnectForm
        vendorId={vendorId}
        consentUrl={consentUrl}
        oauthAvailable={connection.oauth_available}
        error={driveError}
      />
    );
  }

  // Authorized at Google, but not yet pointed at a folder.
  if (connection.needs_folder) {
    const parent = typeof pick === "string" && pick !== "1" ? pick : "root";
    const browse = await client.listDriveFolders(vendorId, tc.ownerToken, parent);
    return (
      <FolderPicker
        vendorId={vendorId}
        browse={browse}
        consentUrl={consentUrl}
        error={driveError}
      />
    );
  }

  const { files, counts } = await client.listDriveFiles(vendorId, tc.ownerToken);
  const pending = files.filter((f) => f.decision === "pending");
  const included = files.filter((f) => f.decision === "included");
  const excluded = files.filter((f) => f.decision === "excluded");
  const summary = connection.last_sync_summary as Record<string, number | string[]>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Google Drive</h1>
          <p className="text-sm text-slate-600">
            Syncing <strong>{connection.folder_name ?? connection.folder_id}</strong>. New files
            land in the review queue below — nothing is published until you say so.
          </p>
        </div>
        <form action={syncDrive.bind(null, vendorId)}>
          <button className="btn-primary" type="submit">Sync now</button>
        </form>
      </div>

      {driveError && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-900">
          {driveError}
        </div>
      )}

      {connection.status === "error" && connection.last_error && (
        <div className="card border-red-200 bg-red-50 text-sm text-red-800">
          <strong>Last sync failed.</strong> {connection.last_error}
        </div>
      )}

      <div className="card grid gap-3 text-sm sm:grid-cols-4">
        <Stat label="Pending review" value={counts.pending} />
        <Stat label="Published" value={counts.included} />
        <Stat label="Excluded" value={counts.excluded} />
        <Stat
          label="Last sync"
          value={
            connection.last_sync_at
              ? new Date(connection.last_sync_at).toLocaleString()
              : "never"
          }
        />
      </div>

      {connection.last_sync_at && (
        <p className="text-xs text-slate-500">
          Last run: {String(summary.discovered ?? 0)} file(s) seen,{" "}
          {String(summary.published ?? 0)} published, {String(summary.versioned ?? 0)} new
          version(s), {String(summary.queued ?? 0)} queued.
          {Array.isArray(summary.errors) && summary.errors.length > 0 && (
            <span className="text-red-600"> {summary.errors.length} error(s).</span>
          )}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Review queue{" "}
          <span className="badge bg-amber-50 text-amber-700">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <div className="card text-sm text-slate-500">
            Nothing waiting. Run a sync to pick up new files.
          </div>
        ) : (
          <>
            {pending.map((file) => (
              <ReviewCard key={file.id} vendorId={vendorId} file={file} />
            ))}
            <form action={excludeDriveFiles.bind(null, vendorId)} className="card space-y-2">
              <p className="text-sm text-slate-600">
                Clear several at once. Bulk <em>exclusion</em> only — publishing stays a
                per-file decision.
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                {pending.map((file) => (
                  <label key={file.id} className="flex items-center gap-1.5">
                    <input type="checkbox" name="file_ids" value={file.id} />
                    {file.name}
                  </label>
                ))}
              </div>
              <button className="btn-ghost" type="submit">Exclude selected</button>
            </form>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Published from Drive{" "}
          <span className="badge bg-emerald-50 text-emerald-700">{included.length}</span>
        </h2>
        {included.length === 0 ? (
          <div className="card text-sm text-slate-500">Nothing published from this folder yet.</div>
        ) : (
          included.map((file) => (
            <div key={file.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {file.artifact?.title ?? file.name}{" "}
                  {file.artifact && (
                    <span className="badge bg-slate-100 text-slate-700">
                      v{file.artifact.version}
                    </span>
                  )}{" "}
                  {file.artifact?.featured && (
                    <span className="badge bg-brand-50 text-brand-700">featured</span>
                  )}
                  {file.artifact?.hidden && (
                    <span className="badge bg-slate-100 text-slate-500">hidden</span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {file.path}
                  {file.synced_at ? ` · synced ${new Date(file.synced_at).toLocaleString()}` : ""}
                  {file.missing_since ? " · removed from Drive (still published)" : ""}
                </div>
              </div>
              <form action={decideDriveFile.bind(null, vendorId, file.id)}>
                <input type="hidden" name="decision" value="excluded" />
                <button className="btn-ghost" type="submit">Stop syncing</button>
              </form>
            </div>
          ))
        )}
      </section>

      {excluded.length > 0 && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-medium">
            Excluded ({excluded.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {excluded.map((file) => (
              <li key={file.id}>
                {file.path ?? file.name}
                {file.exclude_reason ? ` — ${file.exclude_reason}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Excluded files stay excluded across syncs, so they will not come back into the
            queue.
          </p>
        </details>
      )}

      <RulesForm vendorId={vendorId} rules={connection.rules} />

      <form
        action={updateDriveConnection.bind(null, vendorId)}
        className="card grid gap-3 sm:grid-cols-2"
      >
        <h2 className="font-semibold sm:col-span-2">Sync settings</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="recursive" defaultChecked={connection.recursive} />
          Include sub-folders
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="sync_mode"
            value="on_change"
            defaultChecked={connection.sync_mode === "on_change"}
          />
          Sync automatically (otherwise sync on demand)
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="auto_publish" defaultChecked={connection.auto_publish} />
          Publish rule-matched files without review
          <span className="text-xs text-slate-500">
            (files matching no rule always wait in the queue)
          </span>
        </label>
        <div>
          <label className="label" htmlFor="default_type">Default type</label>
          <Select
            id="default_type"
            name="default_type"
            defaultValue={connection.default_type}
            ariaLabel="Default artifact type"
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="default_category">Default category</label>
          <input
            id="default_category"
            name="default_category"
            className="input"
            defaultValue={connection.default_category ?? ""}
            placeholder="Compliance"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="default_access">Default visibility</label>
          <Select
            id="default_access"
            name="default_access"
            defaultValue={connection.default_access}
            ariaLabel="Default visibility"
            options={ACCESS_OPTIONS}
          />
        </div>
        <button className="btn-primary sm:col-span-2" type="submit">Save settings</button>
      </form>

      <form action={disconnectDrive.bind(null, vendorId)} className="card space-y-2">
        <h2 className="font-semibold">Disconnect</h2>
        <p className="text-sm text-slate-600">
          Unlinking stops the sync. Documents already published stay on your trust center
          unless you ask for them to be removed.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="purge" />
          Also delete the {included.length} document(s) published from this folder
        </label>
        <button className="btn-danger" type="submit">Disconnect folder</button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function ReviewCard({ vendorId, file }: { vendorId: string; file: DriveFileItem }) {
  return (
    <form
      action={decideDriveFile.bind(null, vendorId, file.id)}
      className="card grid gap-3 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <div className="font-medium">{file.name}</div>
        <div className="text-xs text-slate-400">
          {file.path}
          {file.size_bytes ? ` · ${bytes(file.size_bytes)}` : ""}
          {file.modified_time
            ? ` · modified ${new Date(file.modified_time).toLocaleDateString()}`
            : ""}
          {file.matched_rule ? ` · matched ${file.matched_rule}` : " · classified from the filename"}
        </div>
        {file.web_view_link && (
          <a
            href={file.web_view_link}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand-600 underline"
          >
            Open in Drive
          </a>
        )}
      </div>

      <div>
        <label className="label">Title</label>
        <input name="title" className="input" defaultValue={file.proposed.title ?? file.name} />
      </div>
      <div>
        <label className="label">Type</label>
        <Select
          name="type"
          defaultValue={file.proposed.type ?? "policy"}
          ariaLabel="Artifact type"
          options={TYPES.map((t) => ({ value: t, label: t }))}
        />
      </div>
      <div>
        <label className="label">Category</label>
        <input
          name="category"
          className="input"
          defaultValue={file.proposed.category ?? ""}
          placeholder="Compliance"
        />
      </div>
      <div>
        <label className="label">Visibility</label>
        <Select
          name="access"
          defaultValue={file.proposed.access ?? "key_required"}
          ariaLabel="Visibility"
          options={ACCESS_OPTIONS}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description (shown under the title)</label>
        <input name="description" className="input" placeholder="Independently audited annual report" />
      </div>
      <div>
        <label className="label">Valid until (optional)</label>
        <input name="valid_until" type="date" className="input" />
      </div>
      <div className="flex items-end gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="featured" /> Featured
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="hidden" /> Hidden
        </label>
      </div>

      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" type="submit" name="decision" value="included">
          Include &amp; publish
        </button>
        <button className="btn-ghost" type="submit" name="decision" value="excluded">
          Exclude
        </button>
      </div>
    </form>
  );
}

function RulesForm({
  vendorId,
  rules,
}: {
  vendorId: string;
  rules: { match: string; label?: string; action?: string; type?: string; category?: string; access?: string }[];
}) {
  // One blank row is always offered so a rule can be added without JavaScript.
  const rows = [...rules, { match: "", label: "", action: "include", type: "", category: "", access: "" }];
  return (
    <form action={saveDriveRules.bind(null, vendorId)} className="card space-y-3">
      <h2 className="font-semibold">Auto-classification rules</h2>
      <p className="text-sm text-slate-600">
        Rules run top to bottom and the first match wins. <code>match</code> is a glob over
        the file&apos;s path inside the folder (or its filename) — for example{" "}
        <code>Compliance/*</code> or <code>*Draft*</code>. An <strong>exclude</strong> rule
        keeps matching files out of the review queue entirely.
      </p>
      <div className="space-y-2">
        {rows.map((rule, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-6">
            <input
              name="rule_match"
              className="input sm:col-span-2"
              defaultValue={rule.match}
              placeholder="Compliance/*"
            />
            <input
              name="rule_label"
              className="input"
              defaultValue={rule.label ?? ""}
              placeholder="label"
            />
            <Select
              name="rule_action"
              defaultValue={rule.action ?? "include"}
              ariaLabel="Rule action"
              options={[
                { value: "include", label: "include" },
                { value: "review", label: "review" },
                { value: "exclude", label: "exclude" },
              ]}
            />
            <input
              name="rule_type"
              className="input"
              defaultValue={rule.type ?? ""}
              placeholder="type"
            />
            <input
              name="rule_category"
              className="input"
              defaultValue={rule.category ?? ""}
              placeholder="category"
            />
            <input type="hidden" name="rule_access" value={rule.access ?? ""} />
          </div>
        ))}
      </div>
      <button className="btn-primary" type="submit">Save rules</button>
    </form>
  );
}

/** Browse Drive and pick the folder to sync, after consent. */
function FolderPicker({
  vendorId,
  browse,
  consentUrl,
  error,
}: {
  vendorId: string;
  browse: {
    parent: string;
    current: { id: string; name: string | null };
    folders: { id: string; name: string }[];
    shared_drives: { id: string; name: string }[];
  };
  consentUrl: string | null;
  error?: string;
}) {
  const atRoot = browse.parent === "root";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Choose a folder</h1>
        <p className="text-sm text-slate-600">
          Google Drive is connected. Pick the folder to sync — TrustMCP will read it and show
          you what it finds before anything is published.
        </p>
      </div>

      {error && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-900">{error}</div>
      )}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium">
            {atRoot ? "My Drive" : (browse.current.name ?? "Folder")}
          </div>
          {!atRoot && (
            <Link href={`/tc/${vendorId}/drive?pick=root`} className="btn-ghost text-xs">
              ← Back to My Drive
            </Link>
          )}
        </div>

        {browse.folders.length === 0 ? (
          <p className="text-sm text-slate-500">
            No sub-folders here.
            {!atRoot && " You can sync this folder as-is."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {browse.folders.map((folder) => (
              <li key={folder.id} className="flex items-center justify-between gap-3 py-2">
                <Link
                  href={`/tc/${vendorId}/drive?pick=${encodeURIComponent(folder.id)}`}
                  className="min-w-0 truncate text-sm hover:underline"
                >
                  📁 {folder.name}
                </Link>
                <form action={chooseDriveFolder.bind(null, vendorId, folder.id)}>
                  <button className="btn-ghost text-xs" type="submit">
                    Sync this folder
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {!atRoot && (
          <form action={chooseDriveFolder.bind(null, vendorId, browse.current.id)}>
            <button className="btn-primary" type="submit">
              Sync “{browse.current.name ?? "this folder"}”
            </button>
          </form>
        )}
      </div>

      {browse.shared_drives.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Shared drives</h2>
          <ul className="divide-y divide-slate-100">
            {browse.shared_drives.map((drive) => (
              <li key={drive.id} className="flex items-center justify-between gap-3 py-2">
                <Link
                  href={`/tc/${vendorId}/drive?pick=${encodeURIComponent(drive.id)}`}
                  className="min-w-0 truncate text-sm hover:underline"
                >
                  🗂 {drive.name}
                </Link>
                <form action={chooseDriveFolder.bind(null, vendorId, drive.id)}>
                  <button className="btn-ghost text-xs" type="submit">
                    Sync this drive
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      {consentUrl && (
        <p className="text-xs text-slate-500">
          Connected to the wrong Google account?{" "}
          <a href={consentUrl} className="text-brand-600 underline">
            Sign in again
          </a>
          .
        </p>
      )}
    </div>
  );
}

function ConnectForm({
  vendorId,
  consentUrl,
  oauthAvailable,
  error,
}: {
  vendorId: string;
  consentUrl: string | null;
  oauthAvailable: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Google Drive</h1>
        <p className="text-sm text-slate-600">
          Link a folder and TrustMCP keeps the latest version of each document in sync with
          your trust center. Access is read-only — nothing is ever written back to Drive.
        </p>
      </div>

      {error && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-900">{error}</div>
      )}

      {consentUrl && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Connect with Google</h2>
          <p className="text-sm text-slate-600">
            Sign in to Google and approve read-only access, then choose the folder. Nothing to
            copy or paste.
          </p>
          <a href={consentUrl} className="btn-primary inline-block">
            Connect Google Drive
          </a>
          <p className="text-xs text-slate-500">
            TrustMCP requests <code>drive.readonly</code> and can never modify or delete
            anything in your Drive. You can revoke access from your Google account at any
            time.
          </p>
        </div>
      )}

      {!oauthAvailable && (
        <div className="card border-slate-200 bg-slate-50 text-sm text-slate-700">
          One-click Google sign-in isn&apos;t configured on this TrustMCP network, so the
          folder has to be linked with your own credentials below. An operator can enable it
          by setting a Google OAuth client on the network.
        </div>
      )}

      <details className="card" open={!oauthAvailable}>
        <summary className="cursor-pointer font-semibold">
          {oauthAvailable ? "Advanced: link with your own credentials" : "Link a folder"}
        </summary>
        <p className="mt-2 text-sm text-slate-600">
          Use a service account when the documents live on a shared drive that should not
          depend on one person&apos;s Google account.
        </p>

      <form action={connectDrive.bind(null, vendorId)} className="mt-3 grid gap-3 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Link a folder</h2>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="folder_id">Folder</label>
          <input
            id="folder_id"
            name="folder_id"
            required
            className="input"
            placeholder="Paste the folder URL or its id"
          />
          <p className="mt-1 text-xs text-slate-500">
            Open the folder in Drive and copy the address bar — the id is pulled out for you.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="auth_type">How should we read it?</label>
          <Select
            id="auth_type"
            name="auth_type"
            defaultValue="service_account"
            ariaLabel="Authentication method"
            options={[
              { value: "service_account", label: "Service account (share the folder with it)" },
              { value: "oauth", label: "OAuth (authorize your own Drive)" },
            ]}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="service_account_json">
            Service-account key JSON
          </label>
          <textarea
            id="service_account_json"
            name="service_account_json"
            rows={4}
            className="input font-mono text-xs"
            placeholder='{"type":"service_account","client_email":"…","private_key":"…"}'
          />
          <p className="mt-1 text-xs text-slate-500">
            Share the Drive folder with the key&apos;s <code>client_email</code> as a Viewer.
            Stored encrypted at rest and never shown again.
          </p>
        </div>

        <details className="sm:col-span-2 text-sm">
          <summary className="cursor-pointer text-slate-600">
            Using OAuth instead? Enter the credentials from the consent flow
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <input name="client_id" className="input" placeholder="client id" />
            <input name="client_secret" className="input" placeholder="client secret" />
            <input name="refresh_token" className="input" placeholder="refresh token" />
          </div>
        </details>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="recursive" defaultChecked />
          Include sub-folders
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sync_mode" value="on_change" />
          Sync automatically
        </label>

        <div>
          <label className="label" htmlFor="default_type">Default type</label>
          <Select
            id="default_type"
            name="default_type"
            defaultValue="policy"
            ariaLabel="Default artifact type"
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="default_access">Default visibility</label>
          <Select
            id="default_access"
            name="default_access"
            defaultValue="key_required"
            ariaLabel="Default visibility"
            options={ACCESS_OPTIONS}
          />
        </div>

        <button className="btn-primary sm:col-span-2" type="submit">Link folder</button>
      </form>
      </details>
    </div>
  );
}
