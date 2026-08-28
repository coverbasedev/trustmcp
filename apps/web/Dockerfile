# TrustMCP web app — production image (Next.js standalone, pnpm monorepo)
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
# Prisma needs openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
# Build shared packages then the web app
RUN pnpm --filter @trustmcp/spec build && pnpm --filter @trustmcp/sdk build
RUN pnpm --filter @trustmcp/web exec prisma generate

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so they
# must be present here — not just at runtime. Render passes a service's env vars
# as Docker build args for any ARG declared below (same for the SENTRY_* inputs
# that drive source-map upload). Anything left unset simply disables that
# integration — the client code no-ops without its key/DSN — so local/offline
# builds still work.
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_APP_URL
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT

RUN pnpm --filter @trustmcp/web build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Global prisma CLI for `migrate deploy` at boot (only needs schema + DATABASE_URL)
RUN npm install -g prisma@6.19.3
# Next standalone output bundles the server + traced node_modules (incl. @prisma/client)
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Schema + migrations for runtime migrate deploy
COPY --from=build /repo/apps/web/prisma ./apps/web/prisma
COPY apps/web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
