import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@trustmcp/sdk", "@trustmcp/spec"],
  // Logo/artifact uploads flow through Server Actions; raise the request body cap
  // above Next's 1 MB default so files up to the UI's 2 MB limit aren't rejected.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Stagehand drives a real browser and pulls in native/dynamic deps; keep it (and
  // the Anthropic SDK) external so Next doesn't try to bundle them for the server.
  serverExternalPackages: ["@browserbasehq/stagehand", "@anthropic-ai/sdk"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Next's standalone output traces used files, but it misses `nodemailer`
  // (pulled in by @auth/core's email provider through pnpm's symlinked modules),
  // which makes the email sign-in link fail at runtime with a "Configuration"
  // error while OAuth still works. Force it into the bundle.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/nodemailer/**/*"],
  },
};

// Sentry build-time wrapping. Source-map upload only happens when an auth token
// is provided (CI/deploy), so local builds stay self-contained and offline-safe.
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
