import { auth } from "@/auth";
import ChromeFrame from "@/components/chrome-frame";
import MarketingChrome from "@/components/marketing-chrome";

// /directory is public but dual-chromed: signed-in visitors see it inside the
// app shell (sidebar + top bar), signed-out visitors see the marketing shell.
// The decision is made on auth state (not the pathname), so it is stable across
// navigation within the route.
export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user) return <ChromeFrame>{children}</ChromeFrame>;
  return <MarketingChrome>{children}</MarketingChrome>;
}
