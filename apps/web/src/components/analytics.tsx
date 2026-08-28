"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import posthog from "posthog-js";

// PostHog product analytics. No-ops entirely unless NEXT_PUBLIC_POSTHOG_KEY is
// set, so local/dev and unconfigured deploys send nothing. Pageviews are captured
// manually because the App Router does not emit them automatically.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

export function Analytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!KEY || initialized) return;
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: false, // captured manually below for App Router navigations
      capture_pageleave: true,
      person_profiles: "identified_only",
    });
    initialized = true;
  }, []);

  useEffect(() => {
    if (!KEY || !initialized) return;
    let url = window.location.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
