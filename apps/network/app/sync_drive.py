"""Scheduled Google Drive sync.

Run by a cron job. Syncs every connection whose `sync_mode` is `on_change`,
which is what makes "the latest version of each document" true without anyone
pressing a button.

Connections set to `manual` are skipped entirely — that setting is the owner
saying they want to control when their folder is read.

    python -m app.sync_drive
"""

from __future__ import annotations

import logging

from .db import SessionLocal
from .deps import get_storage
from .drive_sync import sync_due_connections
from .oscal import feed as feed_mod

log = logging.getLogger("trustmcp.drive.cron")


def run() -> dict:
    db = SessionLocal()
    try:
        result = sync_due_connections(db, get_storage())
        network_url = _network_url()
        # Push each vendor's newest change to its OSCAL subscribers. A customer
        # monitoring continuously should learn about new evidence from the sync
        # that produced it, not from their next scheduled poll.
        for connection_id, summary in result["connections"].items():
            if summary.get("published") or summary.get("versioned"):
                _fan_out(db, connection_id, network_url)
        published = sum(
            int(s.get("published", 0) or 0) for s in result["connections"].values()
        )
        versioned = sum(
            int(s.get("versioned", 0) or 0) for s in result["connections"].values()
        )
        print(
            f"Drive sync complete: {result['synced']} connection(s), "
            f"{published} published, {versioned} new version(s)."
        )
        return result
    finally:
        db.close()


def _network_url() -> str:
    from .config import get_settings

    return get_settings().public_base_url.rstrip("/")


def _fan_out(db, connection_id: str, network_url: str) -> None:
    from sqlalchemy import select

    from .models import DriveConnection, OscalChange

    connection = db.get(DriveConnection, connection_id)
    if connection is None:
        return
    change = db.scalar(
        select(OscalChange)
        .where(OscalChange.vendor_id == connection.vendor_id)
        .order_by(OscalChange.sequence.desc())
        .limit(1)
    )
    if change is not None:
        feed_mod.fan_out(db, connection.vendor_id, change, network_url)


if __name__ == "__main__":
    run()
