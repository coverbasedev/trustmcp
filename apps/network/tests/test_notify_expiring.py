from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import app.notify_expiring as notify
from app.db import SessionLocal
from app.models import Artifact, Vendor
from app.security import hash_secret


def _seed_expiring_vendor(notify_email: str | None) -> str:
    db = SessionLocal()
    try:
        vid = f"vnd_test_{datetime.now(UTC).timestamp()}".replace(".", "")
        v = Vendor(
            id=vid,
            legal_name="Test Co",
            domains=[],
            branding={},
            owner_token_hash=hash_secret("x"),
            notify_email=notify_email,
            published_at=datetime.now(UTC),
        )
        db.add(v)
        db.add(
            Artifact(
                id=f"art_{vid}",
                vendor_id=vid,
                type="soc2_type2",
                issued_at=date.today() - timedelta(days=400),
                valid_until=date.today() - timedelta(days=1),  # expired
                access="key_required",
            )
        )
        db.commit()
        return vid
    finally:
        db.close()


def test_nudge_emails_once_then_is_idempotent(client, monkeypatch):
    # `client` fixture builds the schema; reuse its engine/session.
    sent: list[tuple] = []
    monkeypatch.setattr(
        notify, "send_email", lambda settings, to, subject, body: sent.append((to, subject)) or True
    )
    _seed_expiring_vendor("owner@test.co")

    assert notify.run() == 1
    assert len(sent) == 1

    # Second run is a no-op: the artifact was already notified for this window.
    assert notify.run() == 0
    assert len(sent) == 1


def test_nudge_skips_vendor_without_email(client, monkeypatch):
    sent: list[tuple] = []
    monkeypatch.setattr(
        notify, "send_email", lambda settings, to, subject, body: sent.append((to, subject)) or True
    )
    _seed_expiring_vendor(None)
    assert notify.run() == 0
    assert sent == []
