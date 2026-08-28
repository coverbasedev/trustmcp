# TrustMCP Network API — production image
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install runtime deps (incl. Postgres + DNS for domain verification)
COPY pyproject.toml README.md ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN pip install --upgrade pip && pip install ".[postgres]" && chmod +x ./docker-entrypoint.sh

EXPOSE 8000
# Health check honors $PORT (Render injects it); defaults to 8000 locally.
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD python -c "import os,urllib.request,sys; p=os.environ.get('PORT','8000'); sys.exit(0 if urllib.request.urlopen(f'http://localhost:{p}/health').status==200 else 1)"

ENTRYPOINT ["./docker-entrypoint.sh"]
