// Clean shell for public-facing trust centers — a centered container and nothing
// else. Deliberately has NO TrustMCP chrome (header/nav/footer), so a published
// trust center is fully the vendor's brand, whether viewed at /trust/[vendorId] or
// on the vendor's own custom domain (/sites/[host]). The width matches the rest of
// the app (max-w-6xl) so it lines up with the in-app "Live values" preview.
export default function PublicTrustLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8">
      {children}
    </main>
  );
}
