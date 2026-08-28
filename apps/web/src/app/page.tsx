import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import HomeReveal from "@/components/HomeReveal";
import { TrustMark } from "@/components/logo";

const DOCS_URL = "https://docs.trustmcp.app";
const GITHUB_URL = "https://github.com/coverbasedev/trustmcp";

export default async function Home() {
  const session = await auth();
  // The marketing homepage is for signed-out visitors only. Once authenticated,
  // the app shell (sidebar + top bar) owns the experience - never re-render the
  // marketing page inside it. Send signed-in users straight to their dashboard.
  if (session?.user) redirect("/dashboard");

  return (
    <div className="tm-home">
      <HomeReveal />

      {/* ===== HERO ===== */}
      <header id="main" className="hero">
        {/* nav - logo left, links centered, sign-in right, with comfortable
            breathing room above the bar */}
        <nav className="wrap flex items-center justify-between md:grid md:grid-cols-3 pt-4 pb-8 md:pb-10">
          <Link href="/" className="flex items-center gap-3 text-white justify-self-start">
            <TrustMark className="w-8 h-8 text-white" />
            <span className="text-[17px] font-semibold tracking-tight">TrustMCP</span>
          </Link>
          <div className="hidden md:flex items-center justify-self-center gap-8 text-sm font-medium">
            <a href="#manifest" className="nav-link">How it works</a>
            <Link href="/directory" className="nav-link">Trust Directory</Link>
            <a href={DOCS_URL} className="nav-link">Docs</a>
          </div>
          <Link href="/login" className="nav-link justify-self-end text-sm font-medium">
            Sign in
          </Link>
        </nav>

        {/* hero content - anchored about 30% down from the top of the viewport
            (not centered), so the badge sits in the upper third of the screen */}
        <div className="wrap flex flex-1 flex-col justify-start text-center pt-[8vh] pb-28">
          <div className="reveal in self-center inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/12 border border-white/25 text-white/90 text-xs font-medium backdrop-blur-sm mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-soft)]"></span>
            Open source
          </div>
          <h1 className="font-serif text-white font-semibold leading-[1.04] tracking-tight text-[33px] sm:text-[45px] md:text-[51px] max-w-5xl mx-auto">
            Trust centers for the machine age
          </h1>
          <p className="mt-6 text-white/85 text-[13.5px] md:text-[15px] max-w-xl mx-auto leading-relaxed">
            Build trust with your customers and their AI agents.
          </p>

          <form
            method="get"
            action="/dashboard"
            className="mt-5 flex items-center justify-center"
          >
            <button
              type="submit"
              className="btn-primary w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold whitespace-nowrap"
            >
              Claim now
            </button>
          </form>
          <p className="mt-5 text-white/70 text-sm">Free forever.</p>
        </div>
      </header>

      {/* ===== MANIFEST / MACHINE-READABLE ===== */}
      <section id="manifest" className="py-12 md:py-16">
        <div className="wrap grid lg:grid-cols-2 gap-14 items-center">
          <div className="reveal">
            <p className="eyebrow text-[var(--accent)] mb-4">Trust, made machine-readable</p>
            <h2 className="font-serif text-4xl md:text-[42px] leading-[1.08] tracking-tight">
              One manifest your customers and their agents can read.
            </h2>
            <p className="mt-5 text-[var(--muted)] text-lg leading-relaxed break-words">
              TrustMCP standardizes <em>access</em> to your evidence, never the verdict. Drop a single{" "}
              <span className="mono text-[var(--ink)]">/.well-known/trustmcp.json</span> on your domain
              and any agent that resolves it requests a scoped key, then reaches its own conclusion.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <div className="flex items-center gap-2 text-[var(--ink)]">
                <span className="text-[var(--accent)]">●</span> SOC 2, ISO, PCI &amp; SBOMs
              </div>
              <div className="flex items-center gap-2 text-[var(--ink)]">
                <span className="text-[var(--accent)]">●</span> Scoped, revocable access
              </div>
              <div className="flex items-center gap-2 text-[var(--ink)]">
                <span className="text-[var(--accent)]">●</span> Every read is logged
              </div>
            </div>
          </div>

          <div className="reveal codewin p-5 md:p-6">
            <div className="flex items-center gap-1.5 mb-4">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]"></span>
              <span className="w-3 h-3 rounded-full bg-[#febc2e]"></span>
              <span className="w-3 h-3 rounded-full bg-[#28c840]"></span>
              <span className="mono text-[11px] text-[#6b7088] ml-3">/.well-known/trustmcp.json</span>
            </div>
            <pre className="mono text-[13px] leading-relaxed overflow-x-auto">
              <code>
                <span className="tok-pun">{"{"}</span>
                {"\n  "}
                <span className="tok-key">&quot;schema_version&quot;</span>
                <span className="tok-pun">:</span> <span className="tok-str">&quot;0.1&quot;</span>
                <span className="tok-pun">,</span>
                {"\n  "}
                <span className="tok-key">&quot;vendor_id&quot;</span>
                <span className="tok-pun">:</span> <span className="tok-str">&quot;vnd_acme&quot;</span>
                <span className="tok-pun">,</span>
                {"\n  "}
                <span className="tok-key">&quot;legal_name&quot;</span>
                <span className="tok-pun">:</span> <span className="tok-str">&quot;Acme Corp&quot;</span>
                <span className="tok-pun">,</span>
                {"\n  "}
                <span className="tok-key">&quot;network&quot;</span>
                <span className="tok-pun">:</span>{" "}
                <span className="tok-str">&quot;https://network.trustmcp.app&quot;</span>
                <span className="tok-pun">,</span>
                {"\n  "}
                <span className="tok-key">&quot;manifest&quot;</span>
                <span className="tok-pun">:</span>{" "}
                <span className="tok-str">&quot;.../v1/vendors/vnd_acme/manifest&quot;</span>
                <span className="tok-pun">,</span>
                {"\n  "}
                <span className="tok-key">&quot;mark&quot;</span>
                <span className="tok-pun">:</span> <span className="tok-str">&quot;agent-ready&quot;</span>
                {"\n"}
                <span className="tok-pun">{"}"}</span>
              </code>
            </pre>
            <p className="mt-4 text-[#8b8fa3] text-[13px] leading-relaxed">
              An agent that knows your domain resolves from here, requests a scoped key, and reads
              your profile.
            </p>
          </div>
        </div>
      </section>

      {/* ===== FEATURE CARDS ===== */}
      <section className="pb-8">
        <div className="wrap grid md:grid-cols-3 gap-6">
          <div className="reveal card p-8">
            <div className="mark w-12 h-12 mb-5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 16V4m0 0l-4 4m4-4l4 4"
                  stroke="#fff"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"
                  stroke="#fff"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold tracking-tight">Publish once</h3>
            <p className="mt-3 text-[var(--muted)] leading-relaxed">
              Upload SOC 2, pentests, ISO, COI &amp; SBOMs and declare machine-readable claims. No
              more re-answering the same questionnaire.
            </p>
          </div>
          <div className="reveal card p-8">
            <div className="mark w-12 h-12 mb-5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3l7 3v5c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8V6l7-3z"
                  stroke="#fff"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="11" r="1.6" fill="#fff" />
                <path d="M12 12.6V15" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold tracking-tight">You stay in control</h3>
            <p className="mt-3 text-[var(--muted)] leading-relaxed">
              Every customer requests access; you approve, scope, and revoke on your own terms. Every
              read is logged.
            </p>
          </div>
          <div className="reveal card p-8">
            <div className="mark w-12 h-12 mb-5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M13 3L5 13h6l-1 8 8-10h-6l1-8z"
                  stroke="#fff"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold tracking-tight">Agent-ready by default</h3>
            <p className="mt-3 text-[var(--muted)] leading-relaxed">
              Any assessment agent reads your profile over MCP in a handful of tool calls, then
              reaches its own conclusion.
            </p>
          </div>
        </div>
      </section>

      {/* ===== WHY THIS WORKS ===== */}
      <section id="directory" className="py-10">
        <div className="wrap">
          <div className="reveal rounded-3xl bg-[var(--bg-soft)] border border-[var(--line)] p-9 md:p-14">
            <div className="grid md:grid-cols-[1.1fr_1fr] gap-10 items-center">
              <div>
                <p className="eyebrow text-[var(--accent)] mb-4">Why this works</p>
                <h2 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight">
                  Your evidence. Your customer&apos;s call.
                </h2>
                <p className="mt-5 text-[var(--muted)] text-lg leading-relaxed">
                  Older assessment networks shipped a single, one-size rating. TrustMCP shares the
                  raw, current evidence instead and lets each customer reach their own answer.
                  Everyone keeps their own standard; we just standardize access.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="stat rounded-2xl bg-white border border-[var(--line)] p-5">
                  <div className="font-serif text-3xl text-[var(--accent)]">$0</div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Free forever for any vendor publishing evidence.
                  </p>
                </div>
                <div className="stat rounded-2xl bg-white border border-[var(--line)] p-5">
                  <div className="font-serif text-3xl text-[var(--accent)]">1×</div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    One domain verification confirms you own where you publish.
                  </p>
                </div>
                <div className="stat rounded-2xl bg-white border border-[var(--line)] p-5">
                  <div className="font-serif text-3xl text-[var(--accent)]">∞</div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Reusable across every customer and agent.
                  </p>
                </div>
                <div className="stat rounded-2xl bg-white border border-[var(--line)] p-5">
                  <div className="font-serif text-3xl text-[var(--accent)]">MCP</div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Native to the agent tooling protocol teams already use.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="pt-6 pb-12">
        <div className="wrap">
          <div
            className="reveal relative overflow-hidden rounded-3xl px-8 py-12 md:py-14 text-center ring-1 ring-white/10"
            style={{ background: "linear-gradient(135deg,#141419 0%,#1c2150 55%,#1837ec 130%)" }}
          >
            <div
              className="absolute -top-24 -right-16 w-72 h-72 rounded-full"
              style={{ background: "radial-gradient(circle,rgba(165,180,252,.35),transparent 70%)" }}
            ></div>
            <div
              className="absolute -bottom-28 -left-20 w-80 h-80 rounded-full"
              style={{ background: "radial-gradient(circle,rgba(24,55,236,.45),transparent 70%)" }}
            ></div>
            <h2 className="relative font-serif text-white text-4xl md:text-5xl leading-tight tracking-tight">
              Stand up your trust center today.
            </h2>
            <p className="relative mt-5 text-white/75 text-lg max-w-lg mx-auto">
              Free forever, open for everyone. Publish once and let the network do the reading.
            </p>
            <form
              method="get"
              action="/dashboard"
              className="relative mt-9 flex items-center justify-center"
            >
              <button
                type="submit"
                className="btn-primary w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold whitespace-nowrap"
              >
                Get started free
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-[var(--line)] py-10">
        <div className="wrap flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 text-[var(--ink)]">
            <TrustMark className="w-8 h-8 text-[var(--ink)]" />
            <span className="text-[17px] font-semibold tracking-tight">TrustMCP</span>
          </Link>
          <p className="text-sm text-[var(--muted)] text-center">
            Powered by TrustMCP
          </p>
          <div className="flex items-center gap-6 text-sm text-[var(--muted)]">
            <a href={DOCS_URL} className="hover:text-[var(--ink)] transition">Docs</a>
            <a href={GITHUB_URL} className="hover:text-[var(--ink)] transition">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
