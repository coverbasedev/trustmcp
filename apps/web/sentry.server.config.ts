import * as Sentry from "@sentry/nextjs";

// Server-side error tracking. Disabled (no events sent) unless a DSN is set.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
