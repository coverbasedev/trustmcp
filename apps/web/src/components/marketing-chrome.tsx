import Link from "next/link";
import { auth, signOut } from "@/auth";
import { TrustMark } from "@/components/logo";

/**
 * Public-site chrome: the slim header + footer shown around signed-out pages
 * (login, public trust pages, invites) and the signed-out directory. Lives in a
 * shared component so the (marketing) route-group layout and the directory
 * layout render an identical shell.
 */
export default async function MarketingChrome({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <TrustMark className="h-7 w-7 text-zinc-900" />
            <span>TrustMCP</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
            <Link href="/directory" className="text-slate-600 hover:text-slate-900">
              Trust Directory
            </Link>
            <a href="https://docs.trustmcp.app" className="text-slate-600 hover:text-slate-900">
              Docs
            </a>
            {session?.user ? (
              <>
                <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                  Dashboard
                </Link>
                <Link href="/team" className="text-slate-600 hover:text-slate-900">
                  Team
                </Link>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <button className="btn-ghost" type="submit">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/login" className="btn-primary">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 py-10 text-xs text-slate-400">
        Powered by TrustMCP
      </footer>
    </>
  );
}
