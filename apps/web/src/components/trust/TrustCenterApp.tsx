"use client";

import { useEffect, useState } from "react";
import type {
  Badge,
  ControlItem,
  DataTypeItem,
  FaqItem,
  SubprocessorItem,
  UpdateItem,
} from "@trustmcp/sdk";
import type { RequestResult } from "@/app/(public)/trust/[vendorId]/actions";
import { Select } from "@/components/select";
import { StandardMark } from "@/components/standard-mark";

// SVG fractal-noise grain, inlined as a data URI so the hero gets a tactile
// texture with no extra request. Tiled small and laid down at low opacity with a
// soft-light blend over the brand color.
const NOISE_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

/**
 * Build a premium, color-agnostic backdrop from a single configured brand color:
 * a soft diagonal gradient that lightens toward the top-left and deepens toward
 * the bottom-right. `color-mix` derives the lighter/darker stops from whatever
 * hex the customer set, so any brand color reads as a tasteful gradient rather
 * than a flat block.
 */
function heroBackground(primary: string): React.CSSProperties {
  return {
    backgroundColor: primary,
    backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${primary} 82%, white 18%) 0%, ${primary} 46%, color-mix(in srgb, ${primary} 80%, black 20%) 100%)`,
  };
}

// ---------------------------------------------------------------------------
// Types - mirrors the network's /public payload (see getPublicProfile).
// ---------------------------------------------------------------------------

type Artifact = {
  id: string;
  type: string;
  title: string | null;
  category: string | null;
  issued_at: string;
  valid_until: string | null;
  access: string;
  freshness: string | null;
  product_ids?: string[];
  // Presentation, set by the vendor. All optional: an older /public payload
  // simply renders the way it always did.
  description?: string | null;
  featured?: boolean;
  position?: number;
  sha256?: string | null;
};

/** How the vendor asked for the resource list to be laid out. */
type ResourceDisplay = {
  layout: "list" | "grid" | "table";
  group_by: "category" | "type" | "product" | "none";
  category_order: string[];
  show_descriptions: boolean;
  show_dates: boolean;
  show_hashes: boolean;
  feature_band: boolean;
  empty_message?: string | null;
};

const DEFAULT_DISPLAY: ResourceDisplay = {
  layout: "list",
  group_by: "category",
  category_order: [],
  show_descriptions: true,
  show_dates: true,
  show_hashes: false,
  feature_band: true,
};

export type PublicProfile = {
  vendor: {
    id: string;
    legal_name: string;
    product: string | null;
    products?: { id: string; name: string }[];
    domains: string[];
    branding: {
      display_name?: string;
      logo_url?: string;
      wide_logo_url?: string;
      primary_color?: string;
      accent_color?: string;
      support_email?: string;
      headline?: string;
      description?: string;
      privacy_policy_url?: string;
      marketplace_url?: string;
      company_url?: string;
    };
  };
  mark: string;
  artifacts: Artifact[];
  /** Grouped and ordered resource listing. Absent on older payloads, in which
   * case the component groups `artifacts` itself, exactly as before. */
  resources?: {
    display: ResourceDisplay;
    featured: Artifact[];
    groups: { title: string; resources: Artifact[] }[];
  };
  badges: Badge[];
  controls: ControlItem[];
  controls_updated_at?: string | null;
  data_types: DataTypeItem[];
  subprocessors: SubprocessorItem[];
  faqs: FaqItem[];
  updates: UpdateItem[];
  claim_keys: string[];
  accepts_contract?: boolean;
  nda_required?: boolean;
  nda_text?: string | null;
  dpa_self_serve?: boolean;
  dpa_intro?: string | null;
  ask_enabled?: boolean;
};

type Actions = {
  requestAccess: (vendorId: string, data: RequestData) => Promise<RequestResult>;
  subscribe: (vendorId: string, email: string) => Promise<RequestResult>;
  ask: (vendorId: string, q: string) => Promise<{ available: boolean; answer: string }>;
  reclaim: (vendorId: string, email: string) => Promise<RequestResult>;
  submitDpa: (vendorId: string, data: DpaData) => Promise<RequestResult>;
  artifactUrl: (vendorId: string, artifactId: string) => Promise<{ url?: string; contentType?: string | null }>;
};

type RequestData = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  reason: string;
  accessLevel: "full" | "limited";
  artifactIds: string[];
  ndaAccepted?: boolean;
  contract?: File | null;
};

type DpaData = {
  company_name: string;
  signer_name: string;
  signer_email: string;
  signer_title: string;
  contact_details: string;
  address: Record<string, string>;
  doing_business_as: string;
  registration_number: string;
  subscribe_email: string;
};

const TABS = ["Overview", "Resources", "Controls", "Subprocessors", "FAQ", "Updates"] as const;
type Tab = (typeof TABS)[number];

const FRESH_STYLE: Record<string, string> = {
  valid: "bg-emerald-50 text-emerald-700",
  expiring: "bg-amber-50 text-amber-700",
  expired: "bg-red-50 text-red-600",
};

const REASONS = [
  "Vendor security review",
  "Customer due diligence",
  "Procurement / purchasing",
  "Compliance audit",
  "Other",
];

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------

function Lock() {
  return (
    <svg viewBox="0 0 20 20" className="inline h-3.5 w-3.5 text-slate-400" fill="currentColor" aria-label="requires access">
      <path d="M5 9V7a5 5 0 0 1 10 0v2h1v9H4V9h1zm2 0h6V7a3 3 0 1 0-6 0v2z" />
    </svg>
  );
}

function Check({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="10" fill={color} opacity="0.15" />
      <path d="M6 10.5l2.5 2.5L14 7.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className={`mt-10 w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl bg-white p-6 shadow-xl`}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TrustCenterApp({
  profile,
  actions,
}: {
  profile: PublicProfile;
  actions: Actions;
}) {
  const { vendor } = profile;
  const b = vendor.branding ?? {};
  const primary = b.primary_color ?? "#4f46e5";
  const accent = b.accent_color ?? "#06b6d4";
  const name = b.display_name || vendor.legal_name;
  const vendorId = vendor.id;

  const [tab, setTab] = useState<Tab>("Overview");
  const [modal, setModal] = useState<null | "subscribe" | "ask" | "request" | "reclaim" | "dpa">(null);
  const [viewer, setViewer] = useState<Artifact | null>(null);

  const controlsByCategory = groupBy(profile.controls, (c) => c.category);

  return (
    <div className="ui-90 space-y-8">
      {/* Header */}
      <header className="relative isolate overflow-hidden rounded-2xl text-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.55)]" style={heroBackground(primary)}>
        {/* Soft top-left highlight for depth (color-agnostic). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 120% at 0% 0%, rgba(255,255,255,0.22), rgba(255,255,255,0) 45%), radial-gradient(140% 120% at 100% 100%, rgba(0,0,0,0.28), rgba(0,0,0,0) 55%)",
          }}
        />
        {/* Fine grain texture (very low opacity, soft-light blend) for a tactile, "expensive" finish. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-soft-light" style={{ backgroundImage: `url("${NOISE_URI}")`, backgroundSize: "180px 180px" }} />
        {/* Subtle inner ring/sheen. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />

        <div className="relative flex flex-wrap items-start justify-between gap-4 p-8">
          <div className="max-w-2xl space-y-3">
            <div className="flex items-center gap-3">
              {b.wide_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.wide_logo_url} alt={name} className="h-10 max-w-[260px] object-contain object-left" />
              ) : b.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logo_url} alt="" className="h-10 w-10 rounded bg-white/10 object-contain" />
              ) : null}
              {!b.wide_logo_url && <div className="text-2xl font-semibold">{name}</div>}
              {profile.mark === "agent-ready" && (
                <span className="badge bg-white/15 text-white">◎ Verified</span>
              )}
            </div>
            <h1 className="text-2xl font-bold">{b.headline || "Trust Center"}</h1>
            {b.description ? <p className="opacity-90">{b.description}</p> : null}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm opacity-90">
              {b.support_email && <a className="underline" href={`mailto:${b.support_email}`}>✉ {b.support_email}</a>}
              {b.privacy_policy_url && <a className="underline" href={b.privacy_policy_url} target="_blank">Privacy Policy</a>}
              {b.marketplace_url && <a className="underline" href={b.marketplace_url} target="_blank">Marketplace listing</a>}
              {b.company_url && <a className="underline" href={b.company_url} target="_blank">Website</a>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn bg-white/15 text-white hover:bg-white/25" onClick={() => setModal("subscribe")}>
              🔔 Subscribe to updates
            </button>
            <button className="btn bg-white/15 text-white hover:bg-white/25" onClick={() => setModal("ask")}>
              ✦ Ask a question
            </button>
            <button className="btn bg-white text-slate-900 hover:bg-slate-100" onClick={() => setModal("request")}>
              Request access
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="Trust center sections">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={
              tab === t
                ? "border-b-2 px-4 py-2 text-sm font-medium"
                : "px-4 py-2 text-sm text-slate-500 hover:text-slate-800"
            }
            style={tab === t ? { borderColor: primary, color: primary } : undefined}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {tab === "Overview" && (
        <div className="space-y-8">
          <ComplianceSection badges={profile.badges} />
          <ControlsSection
            controlsByCategory={controlsByCategory}
            accent={accent}
            updatedAt={profile.controls_updated_at}
            preview
          />
          <DataCollectedSection dataTypes={profile.data_types} />
          <SubprocessorsSection subs={profile.subprocessors} preview />
          {profile.faqs.length > 0 && <FaqSection faqs={profile.faqs} preview onMore={() => setTab("FAQ")} />}
          {profile.updates.length > 0 && <UpdatesSection updates={profile.updates} preview onMore={() => setTab("Updates")} />}
        </div>
      )}
      {tab === "Resources" && (
        <ResourcesSection
          artifacts={profile.artifacts}
          resources={profile.resources}
          products={profile.vendor.products ?? []}
          onView={setViewer}
          onRequest={() => setModal("request")}
          accent={accent}
        />
      )}
      {tab === "Controls" && (
        <ControlsSection
          controlsByCategory={controlsByCategory}
          accent={accent}
          updatedAt={profile.controls_updated_at}
        />
      )}
      {tab === "Subprocessors" && <SubprocessorsSection subs={profile.subprocessors} />}
      {tab === "FAQ" && <FaqSection faqs={profile.faqs} />}
      {tab === "Updates" && <UpdatesSection updates={profile.updates} />}

      {/* DPA banner */}
      {profile.dpa_self_serve && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Data Processing Addendum</div>
            <p className="text-sm text-slate-500">{profile.dpa_intro || "Generate and sign our DPA online."}</p>
          </div>
          <button className="btn-primary" onClick={() => setModal("dpa")}>Request DPA</button>
        </section>
      )}

      <p className="text-center text-xs text-slate-400">
        Powered by TrustMCP
      </p>

      {/* Modals */}
      {modal === "subscribe" && (
        <SubscribeModal name={name} accent={primary} privacyUrl={b.privacy_policy_url} onClose={() => setModal(null)} action={(e) => actions.subscribe(vendorId, e)} />
      )}
      {modal === "ask" && (
        <AskModal
          name={name}
          enabled={profile.ask_enabled !== false}
          accent={primary}
          subprocessorsKnown={profile.subprocessors.length > 0}
          onClose={() => setModal(null)}
          action={(q) => actions.ask(vendorId, q)}
        />
      )}
      {modal === "request" && (
        <RequestAccessModal
          accent={primary}
          artifacts={profile.artifacts}
          ndaRequired={!!profile.nda_required}
          ndaText={profile.nda_text}
          acceptsContract={!!profile.accepts_contract}
          onClose={() => setModal(null)}
          onReclaim={() => setModal("reclaim")}
          action={(d) => actions.requestAccess(vendorId, d)}
        />
      )}
      {modal === "reclaim" && (
        <ReclaimModal
          name={name}
          accent={primary}
          onClose={() => setModal(null)}
          onRequest={() => setModal("request")}
          action={(e) => actions.reclaim(vendorId, e)}
        />
      )}
      {modal === "dpa" && (
        <DpaModal name={name} intro={profile.dpa_intro} accent={primary} onClose={() => setModal(null)} action={(d) => actions.submitDpa(vendorId, d)} />
      )}
      {viewer && (
        <DocumentViewer
          artifact={viewer}
          accent={primary}
          onClose={() => setViewer(null)}
          onRequest={() => {
            setViewer(null);
            setModal("request");
          }}
          fetchUrl={() => actions.artifactUrl(vendorId, viewer.id)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function ComplianceSection({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Compliance</h2>
      <div className="flex flex-wrap gap-3">
        {badges.map((b, i) => (
          <div
            key={i}
            className="flex min-h-[3.75rem] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"
          >
            <StandardMark name={b.name} code={b.standard} logoUrl={b.logo_url} />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{b.name}</span>
              {b.valid_until && (
                <span className="block text-[11px] text-slate-400">Valid until {b.valid_until}</span>
              )}
              {b.evidence && (
                <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400">
                  {b.evidence.access === "public" ? "✓ Evidence attached" : (
                    <>
                      <Lock /> Evidence on request
                    </>
                  )}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ControlsSection({
  controlsByCategory,
  accent,
  preview,
  updatedAt,
}: {
  controlsByCategory: Map<string, ControlItem[]>;
  accent: string;
  preview?: boolean;
  updatedAt?: string | null;
}) {
  if (controlsByCategory.size === 0) return null;
  const entries = [...controlsByCategory.entries()];
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Controls</h2>
        {updatedAt && (
          <span className="badge bg-emerald-50 text-emerald-700">✓ Updated {timeAgo(updatedAt)}</span>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {entries.map(([category, items]) => {
          const shown = preview ? items.slice(0, 3) : items;
          return (
            <div key={category} className="card">
              <div className="mb-2 font-semibold">{category}</div>
              <ul className="space-y-2">
                {shown.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check color={c.status === "operating" ? accent : "#94a3b8"} />
                    <span>{c.name}</span>
                  </li>
                ))}
              </ul>
              {preview && items.length > shown.length && (
                <div className="mt-2 text-xs text-slate-400">+{items.length - shown.length} more {category} controls</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DataCollectedSection({ dataTypes }: { dataTypes: DataTypeItem[] }) {
  if (dataTypes.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Data collected</h2>
      <div className="card grid gap-2 sm:grid-cols-2">
        {dataTypes.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {d.collected ? (
              <span className="text-emerald-600">✓</span>
            ) : (
              <span className="text-slate-400">✕</span>
            )}
            <span className={d.collected ? "" : "text-slate-400"}>{d.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SubprocessorsSection({ subs, preview }: { subs: SubprocessorItem[]; preview?: boolean }) {
  if (subs.length === 0) return null;
  const shown = preview ? subs.slice(0, 4) : subs;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Subprocessors</h2>
      <div className="card divide-y divide-slate-100">
        {shown.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-center gap-3">
              <SubprocessorLogo name={s.name} domain={s.domain} logoUrl={s.logo_url} />
              <div className="min-w-0">
                <div className="font-medium">
                  {s.name}
                  {s.purpose ? <span className="text-slate-500"> · {s.purpose}</span> : null}
                </div>
                {s.category ? <div className="text-xs text-slate-400">{s.category}</div> : null}
              </div>
            </div>
            {s.location ? <span className="shrink-0 text-sm text-slate-500">{s.location}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function FaqSection({ faqs, preview, onMore }: { faqs: FaqItem[]; preview?: boolean; onMore?: () => void }) {
  if (faqs.length === 0) return <p className="text-sm text-slate-400">No FAQs published.</p>;
  const shown = preview ? faqs.slice(0, 4) : faqs;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">FAQ</h2>
      <div className="space-y-2">
        {shown.map((f, i) => (
          <details key={i} className="card">
            <summary className="cursor-pointer list-none font-medium">{f.question}</summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{f.answer}</p>
          </details>
        ))}
      </div>
      {preview && faqs.length > shown.length && onMore && (
        <button onClick={onMore} className="mt-2 text-sm font-medium text-indigo-600 hover:underline">View all FAQ →</button>
      )}
    </section>
  );
}

function UpdatesSection({ updates, preview, onMore }: { updates: UpdateItem[]; preview?: boolean; onMore?: () => void }) {
  if (updates.length === 0) return <p className="text-sm text-slate-400">No updates published.</p>;
  const shown = preview ? updates.slice(0, 4) : updates;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Updates</h2>
      <div className="card space-y-4">
        {shown.map((u, i) => (
          <div key={i} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{u.title}</div>
              {u.category && <span className="badge bg-slate-100 text-slate-500">{u.category}</span>}
            </div>
            {u.published_at && <div className="text-xs text-slate-400">Published {u.published_at}</div>}
            {u.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{u.body}</p>}
          </div>
        ))}
      </div>
      {preview && updates.length > shown.length && onMore && (
        <button onClick={onMore} className="mt-2 text-sm font-medium text-indigo-600 hover:underline">View all updates →</button>
      )}
    </section>
  );
}

function ResourcesSection({
  artifacts,
  resources,
  products,
  onView,
  onRequest,
  accent,
}: {
  artifacts: Artifact[];
  resources?: PublicProfile["resources"];
  products: { id: string; name: string }[];
  onView: (a: Artifact) => void;
  onRequest: () => void;
  accent: string;
}) {
  // Filter by product line. A document with no product association is universal,
  // so it shows under every product as well as "All".
  const [product, setProduct] = useState<string>("all");
  const display = resources?.display ?? DEFAULT_DISPLAY;
  const matchesProduct = (a: Artifact) =>
    product === "all" ||
    !a.product_ids ||
    a.product_ids.length === 0 ||
    a.product_ids.includes(product);

  const visible = artifacts.filter(matchesProduct);
  // Use the server's grouping and ordering when it sent one — that is where the
  // vendor's category order lives. Fall back to grouping here so an older
  // /public payload still renders.
  const groups: [string, Artifact[]][] = resources
    ? resources.groups
        .map((g) => [g.title, g.resources.filter(matchesProduct)] as [string, Artifact[]])
        .filter(([, items]) => items.length > 0)
    : [...groupBy(visible, (a) => a.category || "Documents").entries()];
  const featured = (resources?.featured ?? []).filter(matchesProduct);

  return (
    <div className="space-y-6">
      {products.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Product:</span>
          <button
            onClick={() => setProduct("all")}
            className={
              product === "all"
                ? "badge bg-slate-900 text-white"
                : "badge bg-slate-100 text-slate-600 hover:bg-slate-200"
            }
          >
            All products
          </button>
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => setProduct(p.id)}
              className={
                product === p.id
                  ? "badge bg-slate-900 text-white"
                  : "badge bg-slate-100 text-slate-600 hover:bg-slate-200"
              }
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      {display.feature_band && featured.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Featured</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((a) => (
              <div key={a.id} className="card">
                <ResourceRow
                  artifact={a}
                  display={display}
                  onView={onView}
                  onRequest={onRequest}
                  accent={accent}
                  stacked
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-slate-400">
          {display.empty_message || "No resources published."}
        </p>
      ) : (
        groups.map(([category, items]) => (
          <section key={category}>
            {display.group_by !== "none" && (
              <h2 className="mb-3 text-lg font-semibold">{category}</h2>
            )}
            {display.layout === "grid" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((a) => (
                  <div key={a.id} className="card">
                    <ResourceRow
                      artifact={a}
                      display={display}
                      onView={onView}
                      onRequest={onRequest}
                      accent={accent}
                      stacked
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="card divide-y divide-slate-100">
                {items.map((a) => (
                  <div key={a.id} className="py-2 first:pt-0 last:pb-0">
                    <ResourceRow
                      artifact={a}
                      display={display}
                      onView={onView}
                      onRequest={onRequest}
                      accent={accent}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** One resource, in the list or as a card. `stacked` puts the actions below the
 * text instead of beside it, which is what a card needs. */
function ResourceRow({
  artifact: a,
  display,
  onView,
  onRequest,
  accent,
  stacked = false,
}: {
  artifact: Artifact;
  display: ResourceDisplay;
  onView: (a: Artifact) => void;
  onRequest: () => void;
  accent: string;
  stacked?: boolean;
}) {
  const actions = (
    <div className="flex shrink-0 items-center gap-2">
      {a.freshness && (
        <span className={`badge ${FRESH_STYLE[a.freshness] ?? "bg-slate-100 text-slate-500"}`}>
          {a.freshness}
        </span>
      )}
      {a.access === "public" ? (
        <button
          className="badge bg-emerald-50 text-emerald-700 hover:underline"
          onClick={() => onView(a)}
        >
          View / download
        </button>
      ) : (
        <button
          className="badge text-white hover:opacity-90"
          style={{ background: accent }}
          onClick={onRequest}
        >
          Request access
        </button>
      )}
    </div>
  );

  const body = (
    <div className="min-w-0">
      <div className="flex items-center gap-2 font-medium">
        {a.access !== "public" && <Lock />}
        <span className="truncate">{a.title || a.type}</span>
        {a.featured && <span className="badge bg-amber-50 text-amber-700">featured</span>}
      </div>
      {display.show_descriptions && a.description && (
        <p className="mt-0.5 text-sm text-slate-500">{a.description}</p>
      )}
      {display.show_dates && (
        <div className="text-xs text-slate-400">
          issued {a.issued_at}
          {a.valid_until ? ` · valid until ${a.valid_until}` : ""}
        </div>
      )}
      {display.show_hashes && a.sha256 && (
        <div className="font-mono text-[11px] text-slate-400">sha256 {a.sha256}</div>
      )}
    </div>
  );

  if (stacked) {
    return (
      <div className="space-y-2">
        {body}
        {actions}
      </div>
    );
  }
  return <div className="flex items-center justify-between gap-3">{body}{actions}</div>;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function SubscribeModal({
  name,
  accent,
  privacyUrl,
  onClose,
  action,
}: {
  name: string;
  accent: string;
  privacyUrl?: string;
  onClose: () => void;
  action: (email: string) => Promise<RequestResult>;
}) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<RequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Subscribe to updates" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">
        Receive email notifications when {name} publishes updates to their Trust Center.
      </p>
      {result?.ok ? (
        <div className="banner-success">{result.message}</div>
      ) : (
        <>
          {result && <div className="banner-error mb-3">{result.message}</div>}
          <Field label="Email">
            <input className="input" type="email" placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <p className="mt-2 text-xs text-slate-400">
            By signing up for email notifications you agree to the{" "}
            {privacyUrl ? (
              <a className="underline" href={privacyUrl} target="_blank" rel="noreferrer">privacy policy</a>
            ) : (
              "privacy policy"
            )}
            .
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              style={{ background: accent }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setResult(await action(email));
                setBusy(false);
              }}
            >
              Subscribe
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function AskModal({
  name,
  enabled,
  accent,
  subprocessorsKnown,
  onClose,
  action,
}: {
  name: string;
  enabled: boolean;
  accent: string;
  subprocessorsKnown: boolean;
  onClose: () => void;
  action: (q: string) => Promise<{ available: boolean; answer: string }>;
}) {
  type Msg = { role: "user" | "assistant"; text: string };
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const examples = [
    subprocessorsKnown ? `Can you list all the subprocessors for ${name}?` : `What compliance frameworks does ${name} follow?`,
    `How does ${name} handle access controls and authentication?`,
    `How is data encrypted at rest and in transit?`,
  ];

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setQ("");
    setBusy(true);
    const res = await action(text);
    setMsgs((m) => [...m, { role: "assistant", text: res.answer }]);
    setBusy(false);
  }

  return (
    <Modal title={`Ask ${name} a question`} onClose={onClose}>
      <div className="flex max-h-[60vh] min-h-[280px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="flex gap-2">
            <span style={{ color: accent }}>✦</span>
            <div>
              <div className="font-medium">Hello!</div>
              <div className="text-slate-500">What can we help with today?</div>
            </div>
          </div>
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-2"}>
              {m.role === "assistant" && <span style={{ color: accent }}>✦</span>}
              <div className={m.role === "user" ? "max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm" : "max-w-[85%] whitespace-pre-wrap text-sm text-slate-700"}>
                {m.text}
              </div>
            </div>
          ))}
          {busy && <div className="flex gap-2 text-sm text-slate-400"><span style={{ color: accent }}>✦</span>Thinking…</div>}
          {msgs.length === 0 && (
            <div className="pt-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Example questions</div>
              <div className="space-y-2">
                {examples.map((ex) => (
                  <button key={ex} onClick={() => send(ex)} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(q);
          }}
        >
          <input className="input" placeholder="Ask here" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
          <button className="btn-primary" style={{ background: accent }} type="submit" disabled={busy} aria-label="Send">➤</button>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          {enabled
            ? "AI-generated responses may not always be accurate. This chat may be logged for quality and improvement purposes."
            : "The AI assistant isn't enabled yet - answers come from published FAQs and resources."}
        </p>
      </div>
    </Modal>
  );
}

function RequestAccessModal({
  accent,
  artifacts,
  ndaRequired,
  ndaText,
  acceptsContract,
  onClose,
  onReclaim,
  action,
}: {
  accent: string;
  artifacts: Artifact[];
  ndaRequired?: boolean;
  ndaText?: string | null;
  acceptsContract?: boolean;
  onClose: () => void;
  onReclaim: () => void;
  action: (d: RequestData) => Promise<RequestResult>;
}) {
  const [d, setD] = useState<RequestData>({
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    reason: "",
    accessLevel: "full",
    artifactIds: [],
    ndaAccepted: false,
    contract: null,
  });
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<RequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof RequestData, v: RequestData[keyof RequestData]) => setD((p) => ({ ...p, [k]: v }));
  const filtered = artifacts.filter((a) => (a.title || a.type).toLowerCase().includes(search.toLowerCase()));

  if (result?.ok) {
    return (
      <Modal title="Request access" onClose={onClose}>
        <div className="banner-success">{result.message}</div>
        {result.key && (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300">{result.key}</pre>
        )}
        <div className="mt-5 flex justify-end">
          <button className="btn-primary" style={{ background: accent }} onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Request access" onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-500">
        Already have access?{" "}
        <button onClick={onReclaim} className="font-medium" style={{ color: accent }}>Reclaim access</button>
      </p>
      {result && <div className="banner-error mb-3">{result.message}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name"><input className="input" value={d.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
        <Field label="Last name"><input className="input" value={d.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={d.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Company name"><input className="input" value={d.company} onChange={(e) => set("company", e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Reason">
          <Select
            value={d.reason}
            onChange={(v) => set("reason", v)}
            placeholder="Select a reason"
            options={REASONS.map((r) => ({ value: r, label: r }))}
          />
        </Field>
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-4">
        <div className="mb-2 font-medium">Resources</div>
        <div className="mb-3 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={d.accessLevel === "full"} onChange={() => set("accessLevel", "full")} />
            Full access
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={d.accessLevel === "limited"} onChange={() => set("accessLevel", "limited")} />
            Limited access
          </label>
        </div>
        {d.accessLevel === "limited" && (
          <div>
            <input className="input mb-2" placeholder="Search resources" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
              {filtered.map((a) => {
                const checked = d.artifactIds.includes(a.id);
                return (
                  <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        set("artifactIds", e.target.checked ? [...d.artifactIds, a.id] : d.artifactIds.filter((x) => x !== a.id))
                      }
                    />
                    {a.access !== "public" && <Lock />}
                    <span className="truncate">{a.title || a.type}</span>
                  </label>
                );
              })}
              {filtered.length === 0 && <div className="px-2 py-1 text-sm text-slate-400">No matching resources.</div>}
            </div>
            {d.artifactIds.length > 0 && <div className="mt-1 text-xs text-slate-500">{d.artifactIds.length} selected</div>}
          </div>
        )}
      </div>

      {acceptsContract && (
        <div className="mt-4">
          <span className="label">Contract / agreement (optional)</span>
          <input
            type="file"
            className="text-sm"
            onChange={(e) => set("contract", e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-xs text-slate-400">
            Attaching proof of an existing agreement may grant access automatically.
          </p>
        </div>
      )}

      {ndaRequired && (
        <div className="mt-4 space-y-2">
          {ndaText && (
            <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap">
              {ndaText}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!d.ndaAccepted} onChange={(e) => set("ndaAccepted", e.target.checked)} />
            I have read and accept the NDA.
          </label>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          style={{ background: accent }}
          disabled={busy || (ndaRequired && !d.ndaAccepted)}
          onClick={async () => {
            setBusy(true);
            setResult(await action(d));
            setBusy(false);
          }}
        >
          Request access
        </button>
      </div>
    </Modal>
  );
}

function ReclaimModal({
  name,
  accent,
  onClose,
  onRequest,
  action,
}: {
  name: string;
  accent: string;
  onClose: () => void;
  onRequest: () => void;
  action: (email: string) => Promise<RequestResult>;
}) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<RequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Reclaim access" onClose={onClose}>
      {result?.ok ? (
        <div className="banner-success">{result.message}</div>
      ) : (
        <>
          {result && <div className="banner-error mb-3">{result.message}</div>}
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button onClick={onRequest} className="mt-3 block text-sm font-medium" style={{ color: accent }}>
            Never seen the Trust Center before? Request access
          </button>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              style={{ background: accent }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setResult(await action(email));
                setBusy(false);
              }}
            >
              Reclaim access
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function DpaModal({
  name,
  intro,
  accent,
  onClose,
  action,
}: {
  name: string;
  intro?: string | null;
  accent: string;
  onClose: () => void;
  action: (d: DpaData) => Promise<RequestResult>;
}) {
  const [d, setD] = useState<DpaData>({
    company_name: "",
    signer_name: "",
    signer_email: "",
    signer_title: "",
    contact_details: "",
    address: {},
    doing_business_as: "",
    registration_number: "",
    subscribe_email: "",
  });
  const [result, setResult] = useState<RequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof DpaData, v: string) => setD((p) => ({ ...p, [k]: v }));
  const setAddr = (k: string, v: string) => setD((p) => ({ ...p, address: { ...p.address, [k]: v } }));

  if (result?.ok) {
    return (
      <Modal title={`${name} DPA`} onClose={onClose}>
        <div className="banner-success">{result.message}</div>
        <div className="mt-5 flex justify-end"><button className="btn-primary" style={{ background: accent }} onClick={onClose}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title={`${name} DPA`} onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-500">
        {intro || "Complete the fields below to generate the DPA for execution. Upon submitting, a signature request will be sent to the signer email."}
      </p>
      {result && <div className="banner-error mb-3">{result.message}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name *"><input className="input" value={d.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
        <Field label="Doing Business As"><input className="input" value={d.doing_business_as} onChange={(e) => set("doing_business_as", e.target.value)} /></Field>
        <Field label="Company signer name *"><input className="input" value={d.signer_name} onChange={(e) => set("signer_name", e.target.value)} /></Field>
        <Field label="Company signer title *"><input className="input" value={d.signer_title} onChange={(e) => set("signer_title", e.target.value)} /></Field>
        <Field label="Company signer email *"><input className="input" type="email" value={d.signer_email} onChange={(e) => set("signer_email", e.target.value)} /></Field>
        <Field label="Official registration number"><input className="input" value={d.registration_number} onChange={(e) => set("registration_number", e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="DPA contact details *">
          <input className="input" placeholder="Name, position and email of the data exporter's point of contact" value={d.contact_details} onChange={(e) => set("contact_details", e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <span className="label">Company address *</span>
        <div className="space-y-2">
          <input className="input" placeholder="Address line 1" onChange={(e) => setAddr("line1", e.target.value)} />
          <input className="input" placeholder="Address line 2" onChange={(e) => setAddr("line2", e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" placeholder="Locality (City, Town)" onChange={(e) => setAddr("locality", e.target.value)} />
            <input className="input" placeholder="Region (State, Province)" onChange={(e) => setAddr("region", e.target.value)} />
            <input className="input" placeholder="Postcode" onChange={(e) => setAddr("postcode", e.target.value)} />
            <input className="input" placeholder="Country" onChange={(e) => setAddr("country", e.target.value)} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Field label="Email to subscribe to subprocessor updates (optional)">
          <input className="input" type="email" value={d.subscribe_email} onChange={(e) => set("subscribe_email", e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          style={{ background: accent }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(await action(d));
            setBusy(false);
          }}
        >
          Submit
        </button>
      </div>
    </Modal>
  );
}

function DocumentViewer({
  artifact,
  accent,
  onClose,
  onRequest,
  fetchUrl,
}: {
  artifact: Artifact;
  accent: string;
  onClose: () => void;
  onRequest: () => void;
  fetchUrl: () => Promise<{ url?: string; contentType?: string | null }>;
}) {
  const [state, setState] = useState<{ loading: boolean; url?: string; contentType?: string | null }>({ loading: true });
  const isPublic = artifact.access === "public";
  // Fetch the signed URL exactly once on mount (only for public artifacts) - never
  // as a render side effect, which would re-fire on every re-render and race.
  useEffect(() => {
    if (!isPublic) return;
    let cancelled = false;
    fetchUrl().then((r) => {
      if (!cancelled) setState({ loading: false, url: r.url, contentType: r.contentType });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Public artifacts only reach here; private ones route to request access.
  if (!isPublic) {
    return (
      <Modal title={artifact.title || artifact.type} onClose={onClose}>
        <p className="text-sm text-slate-600">This document requires access. Request a scoped key to view it.</p>
        <div className="mt-5 flex justify-end"><button className="btn-primary" style={{ background: accent }} onClick={onRequest}>Request access</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={artifact.title || artifact.type} onClose={onClose} wide>
      {state.loading ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading document…</div>
      ) : state.url ? (
        <>
          <div className="mb-3 flex justify-end">
            <a className="btn-ghost" href={state.url} target="_blank" rel="noreferrer">↓ Download</a>
          </div>
          {(state.contentType || "").includes("pdf") ? (
            <iframe title={artifact.title || artifact.type} src={state.url} className="h-[70vh] w-full rounded-lg border border-slate-200" />
          ) : (
            <div className="py-10 text-center text-sm text-slate-500">
              Preview not available for this file type. <a className="underline" href={state.url} target="_blank" rel="noreferrer">Open in a new tab</a>.
            </div>
          )}
        </>
      ) : (
        <div className="py-10 text-center text-sm text-slate-400">Could not load the document.</div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function SubprocessorLogo({
  name,
  domain,
  logoUrl,
}: {
  name: string;
  domain?: string | null;
  logoUrl?: string | null;
}) {
  // Prefer an explicit logo; otherwise use the domain's favicon; otherwise initials.
  const src = logoUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="h-8 w-8 shrink-0 rounded object-contain" />
    );
  }
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-slate-100 text-xs font-bold text-slate-500">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(months / 12)} year${months >= 24 ? "s" : ""} ago`;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    (m.get(k) ?? m.set(k, []).get(k)!).push(it);
  }
  return m;
}
