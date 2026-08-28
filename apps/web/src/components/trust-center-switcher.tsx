"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { TrustMark } from "@/components/logo";

export type SwitcherCenter = {
  vendorId: string;
  name: string;
  logoUrl: string | null;
};

const COOKIE = "tmcp_tc";

function setActiveCookie(vendorId: string) {
  // One year; path=/ so every app route reads the same active context.
  document.cookie = `${COOKIE}=${encodeURIComponent(vendorId)}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Top-left environment switcher. Replaces the old sidebar wordmark: it shows the
 * active trust center's brand logo (falling back to the TrustMCP mark) and, on
 * click, lets you switch between trust centers - like a typical workspace/env
 * switcher. The active center is whichever /tc/<id> page you're on, otherwise the
 * one remembered in the `tmcp_tc` cookie, otherwise the first center.
 */
export default function TrustCenterSwitcher({
  centers,
  cookieActiveId,
}: {
  centers: SwitcherCenter[];
  cookieActiveId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  // No trust centers yet: just the brand mark linking home (creation is guided
  // on the dashboard itself).
  if (centers.length === 0) {
    return (
      <Link href="/dashboard" className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-100">
        <TrustMark className="h-7 w-7 shrink-0 text-zinc-900" />
        <span
          className="text-[15px] font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-geist), ui-sans-serif, system-ui, sans-serif" }}
        >
          TrustMCP
        </span>
      </Link>
    );
  }

  // Active center: the one in the URL if we're inside a builder, else the cookie,
  // else the first center.
  const urlMatch = pathname.match(/^\/tc\/([^/]+)/);
  const urlId = urlMatch?.[1] ?? null;
  const active =
    centers.find((c) => c.vendorId === urlId) ??
    centers.find((c) => c.vendorId === cookieActiveId) ??
    centers[0];

  function switchTo(vendorId: string) {
    setActiveCookie(vendorId);
    setOpen(false);
    // Land on the summary for the newly-active center.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch trust center"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-100"
      >
        <LogoBadge center={active} />
        <span className="hidden max-w-[12rem] truncate text-sm font-semibold tracking-tight text-slate-900 sm:block">
          {active.name}
        </span>
        <svg
          className="h-4 w-4 shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Trust centers
          </div>
          <div className="max-h-72 overflow-y-auto">
            {centers.map((c) => {
              const isActive = c.vendorId === active.vendorId;
              return (
                <button
                  key={c.vendorId}
                  role="menuitem"
                  onClick={() => switchTo(c.vendorId)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-slate-100"
                >
                  <LogoBadge center={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{c.name}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-400">{c.vendorId}</span>
                  </span>
                  {isActive && (
                    <svg
                      className="h-4 w-4 shrink-0 text-emerald-600"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <div className="my-1 border-t border-slate-100" />
          <Link
            href="/dashboard"
            className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Dashboard
          </Link>
          <Link
            href="/directory"
            className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Search Trust Directory
          </Link>
          <Link
            href="/dashboard?new=1"
            className="block rounded-md px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
          >
            + New trust center
          </Link>
        </div>
      )}
    </div>
  );
}

function LogoBadge({ center }: { center: SwitcherCenter }) {
  if (center.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={center.logoUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded-md border border-slate-200 bg-white object-contain"
      />
    );
  }
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
      <TrustMark className="h-5 w-5" />
    </span>
  );
}
