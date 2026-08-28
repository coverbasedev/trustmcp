import ChromeFrame from "@/components/chrome-frame";

// Shell for every signed-in page (dashboard, team, account, trust-center
// builder). The persistent sidebar + top bar live in ChromeFrame.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ChromeFrame>{children}</ChromeFrame>;
}
