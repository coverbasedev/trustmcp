#!/bin/sh
set -e

# If a command is passed (e.g. the freshness-nudge cron's `python -m app.notify_expiring`),
# run it directly instead of migrating + starting the web server. Docker passes the
# image CMD / Render's dockerCommand as arguments to this ENTRYPOINT.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# Apply database migrations before starting (idempotent).
echo "[entrypoint] alembic upgrade head..."
alembic upgrade head || { echo "[entrypoint] migration failed" >&2; exit 1; }

# Respect the platform-provided $PORT (Render injects this); default to 8000 locally.
echo "[entrypoint] starting uvicorn on port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
