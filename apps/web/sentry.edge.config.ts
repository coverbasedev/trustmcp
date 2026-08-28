import * as Sentry from "@sentry/nextjs";

// Edge-runtime error tracking (middleware, edge routes). No-op without a DSN.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
