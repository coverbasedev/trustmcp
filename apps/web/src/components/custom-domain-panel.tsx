"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomDomainStatus, DnsProviderDetection } from "@trustmcp/sdk";

type DiscoverResult = { supported: boolean; provider_name: string | null; apply_url: string | null };

export default function CustomDomainPanel({
  status,
  actions,
}: {
  status: CustomDomainStatus;
  actions: {
    set: (formData: FormData) => Promise<void>;
    verify: () => Promise<void>;
    remove: () => Promise<void>;
    detect: (domain: string) => Promise<DnsProviderDetection>;
    autoConfigure: (input: { domain: string; provider: string; credentials: Record<string, string> }) => Promise<{ ok: boolean; error?: string }>;
    connect: (domain: string) => Promise<DiscoverResult>;
  };
}) {
  const router = useRouter();
  const domain = status.domain;
  const records = status.instructions?.records ?? [];
  const verified = status.status === "verified" || status.status === "active";

  const [busy, setBusy] = useState<string | null>(null);
  const [autoMsg, setAutoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Auto-detection: run as soon as a domain is present so the user never has to tell
  // us who their DNS provider is. `dc` = Domain Connect one-click discovery; `det` =
  // nameserver-based provider detection (API-key path + deep-link + catalog).
  const [detecting, setDetecting] = useState<boolean>(!!domain && !verified);
  const [dc, setDc] = useState<DiscoverResult | null>(null);
  const [det, setDet] = useState<DnsProviderDetection | null>(null);

  // Selected provider for the API-key path (defaults to the detected one).
  const [provider, setProvider] = useState<string>("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  useEffect(() => {
    if (!domain || verified) return;
    let cancelled = false;
    setDetecting(true);
    (async () => {
      const [d1, d2] = await Promise.all([
        actions.connect(domain).catch(() => null),
        actions.detect(domain).catch(() => null),
      ]);
      if (cancelled) return;
      setDc(d1);
      setDet(d2);
      const oneClick = !!(d1 && d1.supported && d1.apply_url);
      if (d2?.provider && d2.can_auto) {
        setProvider(d2.provider);
        setShowApiKey(!oneClick); // surface the key form by default only if no one-click
      }
      setDetecting(false);
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the domain (or verified state) changes; the bound actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, verified]);

  const catalog = det?.catalog ?? [];
  const selectedEntry = catalog.find((c) => c.key === provider) ?? null;
  const hasOneClick = !!(dc && dc.supported && dc.apply_url);
  const detected = det?.provider ? det : null;
  const detectedAuto = !!(detected && detected.can_auto);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // Resolve once the provider-hosted consent popup finishes — either via a postMessage
  // from our callback page (when the provider redirects back) or when the user closes
  // the window.
  function waitForPopup(popup: Window | null): Promise<"approved" | "error" | "closed"> {
    return new Promise((resolve) => {
      if (!popup) {
        resolve("closed");
        return;
      }
      let settled = false;
      const finish = (v: "approved" | "error" | "closed") => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMsg);
        clearInterval(timer);
        resolve(v);
      };
      const onMsg = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        const d = e.data as { type?: string; error?: string | null } | null;
        if (d && d.type === "trustmcp:domain-connect") finish(d.error ? "error" : "approved");
      };
      window.addEventListener("message", onMsg);
      const timer = setInterval(() => {
        if (popup.closed) finish("closed");
      }, 600);
    });
  }

  // One-click Domain Connect: the customer approves the records in their own DNS
  // provider's UI. No credentials touch us. Reuses the apply URL discovered on load.
  async function openConnect() {
    if (!domain) return;
    setBusy("connect");
    setAutoMsg(null);
    try {
      let flow = dc;
      if (!flow || !flow.apply_url) flow = await actions.connect(domain);
      if (!flow || !flow.supported || !flow.apply_url) {
        setAutoMsg({
          ok: false,
          text: "One-click isn't available for this domain yet. Use a DNS API key or add the records manually below.",
        });
        setShowApiKey(true);
        return;
      }
      const name = flow.provider_name ?? "your DNS provider";
      const popup = window.open(flow.apply_url, "trustmcp-domain-connect", "width=640,height=760");
      const outcome = await waitForPopup(popup);
      if (outcome === "approved") {
        setAutoMsg({ ok: true, text: `Records approved at ${name}. Allow a few minutes to propagate, then verify.` });
      } else if (outcome === "error") {
        setAutoMsg({ ok: false, text: `${name} reported the setup was cancelled or failed. Retry, use an API key, or add the records manually below.` });
      } else {
        setAutoMsg({ ok: true, text: `Finish approving in the ${name} window, then click “Verify DNS”. The manual records below also work.` });
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function autoConfigure() {
    if (!domain || !provider) return;
    setBusy("auto");
    setAutoMsg(null);
    try {
      const res = await actions.autoConfigure({ domain, provider, credentials: creds });
      if (res.ok) {
        setAutoMsg({ ok: true, text: "DNS records created. Allow a few minutes to propagate, then verify." });
        router.refresh();
      } else {
        setAutoMsg({ ok: false, text: res.error || "Couldn't configure DNS automatically. Add the records manually below." });
      }
    } finally {
      setBusy(null);
    }
  }

  // No custom domain yet.
  if (!domain) {
    return (
      <div className="card space-y-3">
        <div>
          <div className="font-medium">Host on your own domain</div>
          <p className="text-sm text-slate-500">
            Serve your trust center at a subdomain you control, like{" "}
            <code className="rounded bg-slate-100 px-1">trust.yourcompany.com</code>, instead of{" "}
            <code className="rounded bg-slate-100 px-1">trustmcp.app/trust/…</code>.
          </p>
        </div>
        <form action={actions.set} className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="custom_domain">Custom domain</label>
            <input id="custom_domain" name="custom_domain" className="input" placeholder="trust.yourcompany.com" />
          </div>
          <button className="btn-primary" type="submit">Add domain</button>
        </form>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{domain}</div>
          <div className="text-xs text-slate-400">Custom trust center domain</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${verified ? "bg-emerald-50 text-emerald-700" : status.status === "error" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
            {verified ? "verified" : status.status === "error" ? "needs attention" : "pending DNS"}
          </span>
          {status.tls && status.tls !== "none" && (
            <span
              className={`badge ${
                status.tls === "active" || status.tls === "issued"
                  ? "bg-emerald-50 text-emerald-700"
                  : status.tls === "blocked"
                    ? "bg-red-50 text-red-600"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              TLS: {status.tls}
            </span>
          )}
          <button
            type="button"
            className="btn-ghost !py-1 text-xs"
            disabled={busy !== null}
            onClick={() => run("remove", actions.remove)}
          >
            Remove
          </button>
        </div>
      </div>

      {status.last_error && status.status === "error" && (
        <div className="banner-warning">{status.last_error}</div>
      )}

      {!verified && (
        <>
          {detecting ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-brand-400 align-middle" />{" "}
              Detecting your DNS provider…
            </div>
          ) : (
            <>
              {/* Primary path — chosen automatically from what we detected. */}
              {hasOneClick ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-800">
                      One-click setup{dc?.provider_name ? ` — ${dc.provider_name}` : ""}
                    </div>
                    <button type="button" className="btn-accent !py-1.5 text-xs" disabled={busy !== null} onClick={openConnect}>
                      {busy === "connect" ? "Opening…" : `Connect with ${dc?.provider_name ?? "your provider"}`}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    We&apos;ll open {dc?.provider_name ?? "your DNS provider"} so you can approve the
                    records directly — no API keys, nothing stored.
                  </p>
                </div>
              ) : detectedAuto ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <div className="text-sm font-medium text-slate-800">
                    We detected {detected?.label}. Connect it to set DNS up automatically.
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Enter a {detected?.label} API key below — we&apos;ll create the records for you.
                    Credentials are used once and never stored.
                  </p>
                </div>
              ) : detected ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-700">We detected {detected.label}.</div>
                    {detected.dns_panel_url && (
                      <a
                        className="btn-ghost !py-1 text-xs"
                        href={detected.dns_panel_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open {detected.label} DNS settings ↗
                      </a>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {detected.label} doesn&apos;t offer an automatic setup we can drive. Add the two
                    records below in your DNS panel, then verify.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  We couldn&apos;t auto-detect your DNS provider. Add the two records below at your
                  provider, then verify — or use a provider API key.
                </div>
              )}

              {/* API-key path: pre-selected to the detected provider, collapsible when a
                  one-click option already exists. The catalog comes from the server, so
                  there's no hardcoded provider list to keep in sync. */}
              {catalog.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-700">
                      {detectedAuto && !hasOneClick ? `Connect ${detected?.label}` : "Set up with a DNS API key"}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost !py-1 text-xs"
                      onClick={() => setShowApiKey((v) => !v)}
                    >
                      {showApiKey ? "Hide" : detectedAuto ? "Show" : "Choose provider"}
                    </button>
                  </div>
                  {showApiKey && (
                    <>
                      <p className="mt-1 text-xs text-slate-500">
                        Connect your DNS provider with an API key and we&apos;ll create the records for
                        you. Credentials are used once and never stored.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="label" htmlFor="dns_provider">Provider</label>
                          <select
                            id="dns_provider"
                            className="input"
                            value={provider}
                            onChange={(e) => {
                              setProvider(e.target.value);
                              setCreds({});
                            }}
                          >
                            <option value="">Select…</option>
                            {catalog.map((p) => (
                              <option key={p.key} value={p.key}>{p.label}</option>
                            ))}
                          </select>
                        </div>
                        {selectedEntry?.fields.map((f) => (
                          <div key={f.name}>
                            <label className="label" htmlFor={`cred_${f.name}`}>
                              {f.label}{f.optional ? " (optional)" : ""}
                            </label>
                            <input
                              id={`cred_${f.name}`}
                              type={f.secret ? "password" : "text"}
                              className="input"
                              value={creds[f.name] ?? ""}
                              onChange={(e) => setCreds((c) => ({ ...c, [f.name]: e.target.value }))}
                              autoComplete="off"
                            />
                          </div>
                        ))}
                      </div>
                      {selectedEntry && (
                        <button type="button" className="btn-primary mt-3" disabled={busy !== null} onClick={autoConfigure}>
                          {busy === "auto" ? "Configuring…" : `Configure ${selectedEntry.label} DNS`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {autoMsg && (
                <div className={`${autoMsg.ok ? "banner-success" : "banner-warning"}`}>{autoMsg.text}</div>
              )}

              {/* Manual fallback — always available, works at any provider. */}
              <div>
                <div className="text-sm font-medium text-slate-700">Or add these records manually</div>
                <p className="mt-1 text-xs text-slate-500">
                  Create the following records at your DNS provider, then verify. The CNAME routes traffic to
                  us; the TXT proves you control the domain.
                </p>
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="data-table">
                    <thead>
                      <tr><th>Type</th><th>Name / Host</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      {records.map((r, i) => (
                        <tr key={i}>
                          <td className="font-medium">{r.type}</td>
                          <td className="font-mono text-xs">{r.name}</td>
                          <td className="break-all font-mono text-xs">{r.value}</td>
                        </tr>
                      ))}
                      {records.length === 0 && (
                        <tr><td colSpan={3} className="text-slate-400">Re-add the domain to regenerate records.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null}
                onClick={() => run("verify", actions.verify)}
              >
                {busy === "verify" ? "Checking DNS…" : "Verify DNS"}
              </button>
            </>
          )}
        </>
      )}

      {verified && (
        <div className="space-y-3">
          {status.tls === "active" || status.tls === "issued" ? (
            <div className="banner-success">
              {domain} is verified and serving your trust center over HTTPS.
            </div>
          ) : status.tls === "blocked" ? (
            <div className="banner-warning">
              {domain} is verified, but it isn’t serving yet.
              {status.last_error ? ` ${status.last_error}` : ""}
            </div>
          ) : (
            <div className="banner-success">
              {domain} is verified. Your TLS certificate is being provisioned — this can take a few
              minutes. Use “Re-check status” to refresh.
            </div>
          )}
          <button
            type="button"
            className="btn-ghost !py-1 text-xs"
            disabled={busy !== null}
            onClick={() => run("verify", actions.verify)}
          >
            {busy === "verify" ? "Re-checking…" : "Re-check status"}
          </button>
        </div>
      )}
    </div>
  );
}
