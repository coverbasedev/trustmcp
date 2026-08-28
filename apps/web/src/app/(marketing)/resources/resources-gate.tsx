"use client";

import { useState } from "react";

const RESOURCES = [
  {
    title: "TrustMCP",
    href: "https://trustmcp.app/",
    description: "Trust centers for the machine age. Claim yours — free forever.",
  },
  {
    title: "TrustMCP on GitHub",
    href: "https://github.com/coverbasedev/trustmcp",
    description: "The open-source standard and reference network. Star it, fork it, contribute.",
  },
  {
    title: "SOC 2 Report Analyzer",
    href: "https://www.coverbase.com/soc2",
    description: "Upload a SOC 2 Type 2 report and get an instant structured analysis. Free.",
  },
  {
    title: "Coverbase Radar",
    href: "https://www.coverbase.com/radar",
    description: "Plain-English vendor incident alerts across cyber, financial, operational, and reputational risk. Free.",
  },
];

// Soft gate: we ask for contact details first, but "Skip" (and the page copy)
// makes clear the links are free either way — nothing is actually locked.
export default function ResourcesGate() {
  const [unlocked, setUnlocked] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, company, source: "resources" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong — please try again.");
        return;
      }
      setThanked(true);
      setUnlocked(true);
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (unlocked) {
    return (
      <div className="mt-8">
        {thanked && (
          <p className="banner-success mb-6" role="status">
            Thanks{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ""}! We&apos;ll follow up by
            email — the resources are all yours below.
          </p>
        )}
        <ul className="space-y-3">
          {RESOURCES.map((r) => (
            <li key={r.href}>
              <a
                href={r.href}
                target="_blank"
                rel="noreferrer"
                className="card block transition hover:border-slate-300 hover:shadow-sm"
              >
                <span className="flex items-center justify-between gap-3 font-medium text-slate-900">
                  {r.title}
                  <span aria-hidden className="text-slate-400">
                    →
                  </span>
                </span>
                <span className="mt-1 block text-sm text-slate-600">{r.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card mt-8 space-y-4">
      <div>
        <label htmlFor="lead-name" className="label">
          Name
        </label>
        <input
          id="lead-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
          placeholder="Ada Lovelace"
        />
      </div>
      <div>
        <label htmlFor="lead-email" className="label">
          Work email
        </label>
        <input
          id="lead-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="ada@example.com"
        />
      </div>
      <div>
        <label htmlFor="lead-company" className="label">
          Company
        </label>
        <input
          id="lead-company"
          className="input"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          required
          autoComplete="organization"
          placeholder="Analytical Engines Inc."
        />
      </div>
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 pt-1">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Sending…" : "Get the resources"}
        </button>
        <button
          type="button"
          className="text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
          onClick={() => setUnlocked(true)}
        >
          Skip — just show me the links
        </button>
      </div>
    </form>
  );
}
