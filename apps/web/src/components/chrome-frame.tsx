import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import AccountMenu from "@/components/account-menu";
import TrustCenterSwitcher, { type SwitcherCenter } from "@/components/trust-center-switcher";
import { listTrustCenters } from "@/lib/trustcenter";
import { trustmcp } from "@/lib/trustmcp";

/**
 * The single, persistent chrome for every signed-in page. The old left sidebar
 * is gone: global navigation now lives in two top-bar controls - a trust-center
 * environment switcher on the left (which shows the active center's brand logo,
 * or the TrustMCP mark) and an account menu on the right (Account, Team, Trust
 * Directory, Docs, Sign out). Per-trust-center navigation lives as tabs inside
 * the content area (see the builder layout).
 */
export default async function ChromeFrame({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const name = session?.user?.name ?? "";
  const userInitial = ((name || email).charAt(0) || "?").toUpperCase();

  // Centers for the switcher. We fetch each center's branding once so the
  // switcher can show its square logo; most accounts have a single center, so
  // this is one network call. Failures degrade to the name + TrustMCP mark.
  let centers: SwitcherCenter[] = [];
  if (session?.user?.id) {
    const rows = await listTrustCenters(session.user.id);
    const client = trustmcp();
    centers = await Promise.all(
      rows.map(async (tc): Promise<SwitcherCenter> => {
        try {
          const v = await client.getVendor(tc.vendorId, tc.ownerToken);
          return {
            vendorId: tc.vendorId,
            name: v.branding?.display_name || tc.legalName,
            logoUrl: v.branding?.logo_url ?? null,
          };
        } catch {
          return { vendorId: tc.vendorId, name: tc.legalName, logoUrl: null };
        }
      }),
    );
  }

  const cookieActiveId = (await cookies()).get("tmcp_tc")?.value ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
        <div className="ui-90 flex min-w-0 items-center">
          <TrustCenterSwitcher centers={centers} cookieActiveId={cookieActiveId} />
        </div>

        <div className="ui-90">
          <AccountMenu
            email={email}
            name={name}
            userInitial={userInitial}
            signOutSlot={
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button
                  type="submit"
                  className="block w-full rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  Sign out
                </button>
              </form>
            }
          />
        </div>
      </header>

      <main id="main" className="flex-1 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
