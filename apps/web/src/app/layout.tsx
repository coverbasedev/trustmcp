import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { Analytics } from "@/components/analytics";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// Self-hosted Geist (sans + mono) - exposed as CSS variables. Applied globally
// so both the marketing surfaces (.tm-home, via --font-geist) and the app
// chrome wordmark can use them on any route.
const geist = localFont({
  variable: "--font-geist",
  display: "swap",
  src: [
    { path: "./fonts/Geist-regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Geist-medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Geist-semibold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Geist-bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Geist-extrabold.ttf", weight: "800", style: "normal" },
  ],
});

const geistMono = localFont({
  variable: "--font-geist-mono",
  display: "swap",
  src: [
    { path: "./fonts/GeistMono-regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/GeistMono-medium.ttf", weight: "500", style: "normal" },
  ],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "TrustMCP",
    template: "%s · TrustMCP",
  },
  description: "Agent-ready trust centers. Publish once, assess on your own terms.",
  openGraph: {
    title: "TrustMCP",
    description: "Agent-ready trust centers. Publish once, assess on your own terms.",
    type: "website",
  },
};

// The root layout is intentionally stable: it never branches its structure on
// the current route. Per-area chrome lives in nested layouts (the (marketing)
// and (app) route groups, and directory/), so client-side navigation never
// reuses a frozen shell - which previously dropped the destination route's CSS.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
