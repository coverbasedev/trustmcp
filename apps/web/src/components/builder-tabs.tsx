"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Trust center sections grouped into a handful of primary tabs. Each group's
// sub-pages appear as a secondary row when that group is active.
const GROUPS: { label: string; items: [string, string][] }[] = [
  { label: "Overview", items: [["", "Overview"], ["setup", "Guided setup"]] },
  { label: "Evidence", items: [["artifacts", "Resources"], ["drive", "Google Drive sync"], ["presentation", "Presentation"], ["sbom", "Bill of Materials"], ["attestations", "Attestations"], ["subprocessors", "Subprocessors"], ["mcp-audits", "MCP audits"], ["migrations", "AI migration"]] },
  {
    label: "Content",
    items: [
      ["compliance", "Compliance"],
      ["controls", "Controls"],
      ["data", "Data collected"],
      ["faq", "FAQ"],
      ["updates", "Updates"],
    ],
  },
  { label: "Trust page", items: [["branding", "Branding"], ["domains", "Domains & mark"]] },
  {
    label: "Access",
    items: [
      ["requests", "Requests"],
      ["subscribers", "Subscribers"],
      ["agreements", "Agreements (DPA)"],
      ["insights", "Insights"],
      ["audit", "Audit log"],
    ],
  },
  { label: "Settings", items: [["connections", "Connections"], ["settings", "Settings"]] },
];

export function BuilderTabs({ vendorId }: { vendorId: string }) {
  const pathname = usePathname();
  const base = `/tc/${vendorId}`;
  const href = (slug: string) => (slug ? `${base}/${slug}` : base);

  const current = pathname === base ? "" : pathname.slice(base.length + 1).split("/")[0] ?? "";
  const activeGroup = GROUPS.find((g) => g.items.some(([slug]) => slug === current)) ?? GROUPS[0];

  return (
    <div className="space-y-3">
      <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {GROUPS.map((group) => {
          const active = group === activeGroup;
          return (
            <Link
              key={group.label}
              href={href(group.items[0][0])}
              className={
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition " +
                (active
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
              }
            >
              {group.label}
            </Link>
          );
        })}
      </nav>

      {activeGroup.items.length > 1 && (
        <div className="flex gap-1 overflow-x-auto">
          {activeGroup.items.map(([slug, label]) => {
            const active = slug === current;
            return (
              <Link
                key={slug}
                href={href(slug)}
                aria-current={active ? "page" : undefined}
                className={
                  "whitespace-nowrap rounded px-3 py-1 text-sm transition " +
                  (active
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800")
                }
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
