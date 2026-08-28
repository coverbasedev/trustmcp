# TrustMCP docs site - production image (Next.js standalone, pnpm monorepo)
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY apps/docs ./apps/docs
RUN pnpm install --frozen-lockfile --filter @trustmcp/docs...
RUN pnpm --filter @trustmcp/docs build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/docs/.next/standalone ./
COPY --from=build /repo/apps/docs/.next/static ./apps/docs/.next/static
EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/docs/server.js"]
