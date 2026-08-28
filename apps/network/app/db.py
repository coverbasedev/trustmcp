from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _normalize_db_url(url: str) -> str:
    """Accept the plain connection strings hosts hand out (Render/Heroku style) and
    pin them to the psycopg (v3) driver SQLAlchemy expects. `postgres://` and
    `postgresql://` (no explicit driver) both become `postgresql+psycopg://`."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def _make_engine():
    settings = get_settings()
    url = _normalize_db_url(settings.database_url)
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        # Ensure the directory for a file-based sqlite db exists.
        if ":///" in url and not url.endswith(":memory:"):
            db_path = url.split(":///", 1)[1]
            if db_path and db_path != ":memory:":
                Path(os.path.dirname(db_path) or ".").mkdir(parents=True, exist_ok=True)
    return create_engine(url, connect_args=connect_args, future=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    # Import models so they register on Base.metadata before create_all.
    from . import models  # noqa: F401

    # On sqlite (dev + tests) create tables directly. On Postgres, schema is owned
    # by Alembic (run via docker-entrypoint.sh `alembic upgrade head`); calling
    # create_all there would create tables outside Alembic's tracking and desync
    # alembic_version. So no-op for non-sqlite backends.
    if engine.url.get_backend_name().startswith("sqlite"):
        Base.metadata.create_all(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
