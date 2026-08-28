"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Top-bar account dropdown. Unlike the native <details> it replaces, this closes
 * when you click anywhere outside it, press Escape, or navigate - matching the
 * behavior of every other dropdown in the app. The server-rendered sign-out form
 * (which carries the server action) is passed in as `signOutSlot`.
 */
export default function AccountMenu({
  email,
  name,
  userInitial,
  signOutSlot,
}: {
  email: string;
  name: string;
  userInitial: string;
  signOutSlot: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

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

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 rounded-full p-0.5 hover:bg-slate-100"
      >
        <span
          className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700"
          title={email}
        >
          {userInitial}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-60 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          <div className="px-3 py-2">
            {name && <div className="truncate text-sm font-medium text-slate-900">{name}</div>}
            <div className="truncate text-xs text-slate-500">{email}</div>
          </div>
          <div className="my-1 border-t border-slate-100" />
          <Link
            href="/account"
            className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Account settings
          </Link>
          <Link
            href="/team"
            className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Team &amp; members
          </Link>
          <Link
            href="/audit/scans"
            className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            MCP Audits
          </Link>
          <Link
            href="/directory"
            className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Trust Directory
          </Link>
          <a
            href="https://docs.trustmcp.app"
            target="_blank"
            rel="noreferrer"
            className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Docs
          </a>
          <div className="my-1 border-t border-slate-100" />
          {signOutSlot}
        </div>
      )}
    </div>
  );
}
