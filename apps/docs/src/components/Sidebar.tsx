"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="space-y-6 text-sm">
      {NAV.map((section) => (
        <div key={section.title}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {section.title}
          </div>
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={
                      active
                        ? "block rounded-md bg-brand-50 px-3 py-1.5 font-medium text-brand-700"
                        : "block rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
                    }
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
