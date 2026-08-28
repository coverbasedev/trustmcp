"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Warns before leaving a page with unsaved form input. Tracks "dirty" by
 * listening for any input/change inside the guarded subtree, clears it on submit,
 * and on navigation either intercepts in-app link clicks (showing a confirm
 * modal) or, for full unloads (refresh/close/external), triggers the browser's
 * native prompt. Reset whenever the route actually changes.
 */
export default function FormGuard() {
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Reset on a completed navigation.
  useEffect(() => {
    setDirty(false);
    setPending(null);
  }, [pathname]);

  // Track edits + clear on submit.
  useEffect(() => {
    const onEdit = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.matches("input, textarea, select") || t.isContentEditable)) setDirty(true);
    };
    const onSubmit = () => setDirty(false);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  // Native prompt for refresh / tab close / external navigation.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Intercept in-app link clicks while dirty.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || a.target === "_blank" || a.hasAttribute("download")) return;
      if (href === pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  if (!pending) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Leave without saving?</h2>
        <p className="mt-2 text-sm text-slate-600">
          This will be unsafe. If you navigate away, changes will not be saved. Are you sure?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setPending(null)}>
            Stay on page
          </button>
          <button
            className="btn-danger"
            onClick={() => {
              const href = pending;
              setDirty(false);
              setPending(null);
              if (href) router.push(href);
            }}
          >
            Leave anyway
          </button>
        </div>
      </div>
    </div>
  );
}
