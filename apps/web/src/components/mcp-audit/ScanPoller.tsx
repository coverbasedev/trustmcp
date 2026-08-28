"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ACTIVE = new Set(["pending", "inspecting", "researching", "probing", "scoring"]);

/** Refreshes the server component on an interval while the scan is still running,
 *  so the progress log and final scorecard appear without a manual reload. */
export function ScanPoller({ status }: { status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!ACTIVE.has(status)) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [status, router]);
  return null;
}
