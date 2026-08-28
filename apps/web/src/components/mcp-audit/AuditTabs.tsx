"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string][] = [
  ["/audit/scans", "Scans"],
  ["/audit/new", "New scan"],
  ["/audit/settings", "Controls & credentials"],
];

export function AuditTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="MCP Audit" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map(([href, label]) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition " +
              (active
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
