from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .observability import AccessLogMiddleware, configure_logging, init_sentry
from .routers import (
    directory,
    drive,
    esign,
    files,
    keys,
    manage,
    mark,
    meta,
    oscal,
    public,
    read,
)

log = logging.getLogger("trustmcp")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # Fail loudly on a misconfigured production deploy rather than silently
    # weakening security (predictable admin token, ephemeral signing key, sqlite).
    errors = settings.validate_for_production()
    if errors:
        raise RuntimeError(
            "Refusing to start in production:\n  - " + "\n  - ".join(errors)
        )
    for warning in settings.production_warnings():
        log.warning("startup: %s", warning)
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings)
    init_sentry(settings)
    app = FastAPI(
        title="TrustMCP Network",
        version="0.1.0",
        lifespan=lifespan,
        description=(
            "TrustMCP reference network. "
            "It verifies domain ownership, issues/validates the agent-ready mark, "
            "mints/validates scoped access keys, logs reads, and tracks freshness."
        ),
    )

    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok", "environment": settings.environment, "version": "0.1.0"}

    @app.get("/readyz", tags=["meta"])
    def readyz() -> dict:
        """Readiness probe: verifies the database is reachable."""
        from sqlalchemy import text

        from .db import engine

        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as e:  # pragma: no cover
            from fastapi import HTTPException

            raise HTTPException(503, f"database unavailable: {e}") from e
        return {"status": "ready"}

    app.include_router(read.router)
    app.include_router(manage.router)
    app.include_router(keys.router)
    app.include_router(mark.router)
    app.include_router(public.router)
    app.include_router(public.domain_router)
    app.include_router(directory.router)
    app.include_router(meta.router)
    app.include_router(files.router)
    app.include_router(oscal.router)
    app.include_router(oscal.network_router)
    app.include_router(drive.router)
    app.include_router(esign.router)
    return app


app = create_app()
