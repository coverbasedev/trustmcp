import MarketingChrome from "@/components/marketing-chrome";

// Shell for the public site (login, public trust pages, invites). The home page
// ("/") is intentionally outside this group: it ships its own full-bleed nav and
// footer from page.tsx and only needs the stable root layout.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingChrome>{children}</MarketingChrome>;
}
