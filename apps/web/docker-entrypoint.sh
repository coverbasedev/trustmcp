#!/bin/sh
set -e

# The web app keeps its Prisma tables in a dedicated `web` schema so it can share
# one Postgres with the network API (whose tables live in `public`). If the
# DATABASE_URL doesn't already pin a schema (e.g. a host like Render hands us a
# plain connection string), default it to `web`. Prisma creates the schema on
# `migrate deploy` if it doesn't exist.
if [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    *schema=*) : ;;                                              # already scoped
    *\?*) export DATABASE_URL="${DATABASE_URL}&schema=web" ;;    # has a query string
    *)    export DATABASE_URL="${DATABASE_URL}?schema=web" ;;
  esac
fi

# Apply database migrations before starting the server. Idempotent: `migrate
# deploy` only runs migrations that haven't been applied yet.
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] running prisma migrate deploy (schema=web)..."
  prisma migrate deploy --schema apps/web/prisma/schema.prisma || {
    echo "[entrypoint] migrate deploy failed" >&2
    exit 1
  }
fi

echo "[entrypoint] starting Next.js server..."
exec node apps/web/server.js
