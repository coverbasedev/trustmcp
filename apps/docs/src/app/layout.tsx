import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: { default: "TrustMCP Docs", template: "%s · TrustMCP Docs" },
  description: "Documentation for the TrustMCP - the open, agent-first trust standard.",
  openGraph: {
    title: "TrustMCP - Docs",
    description: "Publish once. Assess on your own terms. The open, agent-first trust standard.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="ui-90">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <svg
                className="h-7 w-7 text-brand-600"
                viewBox="0 0 48 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="24" cy="24" r="20" />
                <circle cx="24" cy="14.5" r="8.5" />
                <circle cx="15.77" cy="28.75" r="8.5" />
                <circle cx="32.23" cy="28.75" r="8.5" />
                <circle cx="24" cy="24" r="1.7" fill="currentColor" stroke="none" />
              </svg>
              TrustMCP
              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">docs</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <a href="https://github.com/coverbasedev/trustmcp" className="hover:text-slate-900">GitHub</a>
              <a href="/reference/api" className="hover:text-slate-900">API</a>
            </nav>
          </div>
        </header>
        <div className="mx-auto flex max-w-7xl gap-10 px-4 py-10">
          <aside className="hidden w-60 shrink-0 md:block">
            <div className="sticky top-20">
              <Sidebar />
            </div>
          </aside>
          <article className="min-w-0 max-w-3xl flex-1 pb-12">
            {children}
            <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-400">
              TrustMCP · Apache-2.0 standard ·{" "}
              <a className="text-brand-600 hover:underline" href="https://github.com/coverbasedev/trustmcp">
                Edit on GitHub
              </a>
            </footer>
          </article>
        </div>
      </body>
    </html>
  );
}
