# TrustMCP Network (reference API)

The reference implementation of the **TrustMCP** network — a *thin
trust anchor*, not a rating agency. Built with FastAPI + SQLAlchemy.

## What it does

- Verifies **domain ownership** (DNS `TXT` or `.well-known/trustmcp-challenge.txt`).
- Issues and validates the **`agent-ready` mark** (`GET /v1/mark/{vendor_id}`).
- Mints, scopes, and validates **access keys**; revokes them on demand.
- Records an **audit log** of every read.
- Tracks artifact **freshness** (`valid` / `expiring` / `expired`).
- Stores artifacts in **S3** (prod) or the local filesystem with signed redirect
  URLs (dev / self-hosting).

It never scores, rates, or interprets evidence. Customers compute their own verdict.

## Run locally

```bash
uv venv .venv && uv pip install --python .venv -e ".[dev]"
source .venv/bin/activate
python -m app.seed                       # seed the Acme production profile
uvicorn app.main:app --reload --port 8000
open http://localhost:8000/docs
```

## Configuration

All settings are environment variables prefixed `TRUSTMCP_` (see `app/config.py`).
Key ones: `TRUSTMCP_DATABASE_URL`, `TRUSTMCP_SERVICE_TOKEN`, `TRUSTMCP_S3_BUCKET`,
`TRUSTMCP_PUBLIC_BASE_URL`, `TRUSTMCP_EXPIRING_WINDOW_DAYS`, `TRUSTMCP_KEY_TTL_DAYS`.

## Auth model

| Header | Who | Used for |
|--------|-----|----------|
| `X-TrustMCP-Service-Token` | the web backend | creating vendors on behalf of users |
| `X-TrustMCP-Owner-Token` | a vendor | managing its own trust center |
| `Authorization: Bearer tmcp_live_…` | a customer | reading a profile (scoped) |

## Tests

```bash
pytest
```
