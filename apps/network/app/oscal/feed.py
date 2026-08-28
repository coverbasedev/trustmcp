"""The continuous half of the OSCAL exchange.

Point-in-time OSCAL is a GET: ask, and you get the vendor's posture right now.
That is fine for an annual review and useless for continuous monitoring, because
the consumer has no way to know *when* to ask again short of re-pulling every
document on a timer and diffing megabytes of JSON.

This module closes that gap with three mechanisms over one change log:

  poll       `GET .../oscal/changes?since=<cursor>` returns everything that has
             happened since the cursor, plus the new cursor. Cheap, stateless
             on the consumer side, and the only mechanism that survives a
             consumer being offline for a week.
  stream     Server-sent events over the same log, for consumers that want push
             without running a webhook endpoint.
  subscribe  A registered webhook, signed with the same HMAC scheme as the
             vendor's access webhooks, delivered as changes are recorded.

The change log is append-only and per-vendor. Its sequence number *is* the
cursor — monotonic and gapless within a vendor, so "since=12" is unambiguous and
a consumer can tell "nothing changed" from "I missed something" without a
timestamp comparison.

Every change carries which OSCAL models it invalidates, so a consumer polling
for POA&M changes can ignore a branding edit without re-rendering anything.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

log = logging.getLogger("trustmcp.oscal.feed")

# Which OSCAL models a given kind of change invalidates. A consumer uses this to
# decide what to re-pull; anything not listed here re-pulls everything, which is
# correct but wasteful, so keep the table complete.
EVENT_MODELS: dict[str, list[str]] = {
    "artifact.created": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
    "artifact.updated": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
    "artifact.version": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
    "artifact.deleted": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
    "artifact.expired": ["assessment-results", "plan-of-action-and-milestones"],
    "claims.replaced": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
    "controls.replaced": ["assessment-results", "plan-of-action-and-milestones"],
    "subprocessors.replaced": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
    ],
    "profile.updated": ["component-definition", "system-security-plan"],
    "mark.changed": [
        "component-definition",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
    "published": list(
        {
            "component-definition",
            "system-security-plan",
            "assessment-plan",
            "assessment-results",
            "plan-of-action-and-milestones",
        }
    ),
    "oscal.imported": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
    "drive.synced": [
        "component-definition",
        "system-security-plan",
        "assessment-results",
        "plan-of-action-and-milestones",
    ],
}

ALL_EVENTS = sorted(EVENT_MODELS)


def models_for(event: str) -> list[str]:
    from . import VENDOR_MODELS

    return EVENT_MODELS.get(event, list(VENDOR_MODELS))


def record_change(
    db: Session,
    vendor_id: str,
    event: str,
    *,
    subject: str | None = None,
    detail: dict | None = None,
    commit: bool = True,
):
    """Append one change to a vendor's log.

    Called from the management endpoints as evidence changes. The sequence is
    assigned per vendor rather than globally so a consumer's cursor is not
    perturbed by other vendors' activity.
    """
    from ..models import OscalChange

    last = db.scalar(
        select(OscalChange.sequence)
        .where(OscalChange.vendor_id == vendor_id)
        .order_by(OscalChange.sequence.desc())
        .limit(1)
    )
    change = OscalChange(
        vendor_id=vendor_id,
        sequence=(last or 0) + 1,
        event=event,
        subject=subject,
        models=models_for(event),
        detail=detail or {},
    )
    db.add(change)
    if commit:
        db.commit()
    return change


def current_cursor(db: Session, vendor_id: str) -> int:
    """The vendor's newest sequence number, or 0 when nothing is logged yet."""
    OscalChange = _change_model()
    return (
        db.scalar(
            select(OscalChange.sequence)
            .where(OscalChange.vendor_id == vendor_id)
            .order_by(OscalChange.sequence.desc())
            .limit(1)
        )
        or 0
    )


def _change_model():
    # Imported lazily: models imports services, which imports this package.
    from ..models import OscalChange

    return OscalChange


def changes_since(
    db: Session,
    vendor_id: str,
    since: int = 0,
    *,
    limit: int = 100,
    models: list[str] | None = None,
) -> dict:
    """Everything after `since`, oldest first, with the cursor to use next.

    `has_more` tells a consumer to keep paging before it treats itself as caught
    up — the difference between "nothing else happened" and "the page was full".
    """
    OscalChange = _change_model()
    query = (
        select(OscalChange)
        .where(OscalChange.vendor_id == vendor_id, OscalChange.sequence > since)
        .order_by(OscalChange.sequence.asc())
        .limit(limit + 1)
    )
    rows = list(db.scalars(query).all())
    has_more = len(rows) > limit
    rows = rows[:limit]

    if models:
        wanted = set(models)
        rows = [r for r in rows if wanted & set(r.models or [])]

    latest = current_cursor(db, vendor_id)
    return {
        "vendor_id": vendor_id,
        "since": since,
        "cursor": rows[-1].sequence if rows else max(since, latest if not has_more else since),
        "latest": latest,
        "has_more": has_more,
        "changes": [as_dict(r) for r in rows],
    }


def as_dict(change) -> dict:
    return {
        "sequence": change.sequence,
        "event": change.event,
        "subject": change.subject,
        "models": change.models or [],
        "detail": change.detail or {},
        "at": change.created_at.isoformat() if change.created_at else None,
    }


def prune(db: Session, vendor_id: str, *, keep_days: int = 400, keep_min: int = 200) -> int:
    """Trim a vendor's log, keeping at least `keep_min` entries.

    An unbounded append-only log is a slow leak. Keeping a floor of recent
    entries regardless of age means a consumer that polls rarely still resumes
    from its cursor instead of being forced into a full re-pull.
    """
    OscalChange = _change_model()
    rows = list(
        db.scalars(
            select(OscalChange)
            .where(OscalChange.vendor_id == vendor_id)
            .order_by(OscalChange.sequence.desc())
        ).all()
    )
    if len(rows) <= keep_min:
        return 0
    cutoff = datetime.now(UTC) - timedelta(days=keep_days)
    removed = 0
    for row in rows[keep_min:]:
        created = row.created_at
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        if created is not None and created < cutoff:
            db.delete(row)
            removed += 1
    if removed:
        db.commit()
    return removed


# --- Subscriptions -----------------------------------------------------------


def deliver_change(subscription, change, network_url: str) -> bool:
    """POST one change to a subscriber, signed with its shared secret."""
    from ..webhooks import deliver

    payload = {
        "vendor_id": subscription.vendor_id,
        "cursor": change.sequence,
        "change": as_dict(change),
        "pull": {
            model: f"{network_url}/v1/vendors/{subscription.vendor_id}/oscal/{model}"
            for model in (change.models or [])
        },
    }
    return deliver(subscription.url, subscription.secret, "oscal.change", payload, attempts=3)


def fan_out(db: Session, vendor_id: str, change, network_url: str) -> int:
    """Deliver a change to every live subscription that cares about it.

    Runs in a BackgroundTask off the request path. A subscription that fails
    repeatedly is suspended rather than retried forever — a dead endpoint should
    not slow every future evidence update.
    """
    from ..models import OscalSubscription

    subs = list(
        db.scalars(
            select(OscalSubscription).where(
                OscalSubscription.vendor_id == vendor_id,
                OscalSubscription.status == "active",
            )
        ).all()
    )
    delivered = 0
    change_models = set(change.models or [])
    for sub in subs:
        wanted = set(sub.models or [])
        if wanted and not (wanted & change_models):
            continue
        ok = deliver_change(sub, change, network_url)
        sub.last_delivery_at = datetime.now(UTC)
        sub.last_status = "ok" if ok else "failed"
        if ok:
            sub.failures = 0
            sub.last_cursor = change.sequence
            delivered += 1
        else:
            sub.failures = (sub.failures or 0) + 1
            if sub.failures >= 10:
                sub.status = "suspended"
                log.warning(
                    "[oscal:subscription-suspended] id=%s url=%s", sub.id, sub.url
                )
        db.add(sub)
    db.commit()
    return delivered


def stream_events(
    db_factory, vendor_id: str, since: int, network_url: str, *, max_iterations: int = 600
):
    """A generator of SSE frames for `GET .../oscal/stream`.

    Polls the log on an interval rather than holding a listener, which keeps it
    working on SQLite and across replicas without a message bus. Emits a comment
    frame as a keepalive so proxies do not close an idle connection, and stops
    after `max_iterations` so a forgotten browser tab cannot pin a worker
    forever — the client reconnects with its last cursor.
    """
    import time

    cursor = since
    for _tick in range(max_iterations):
        with db_factory() as db:
            batch = changes_since(db, vendor_id, cursor, limit=50)
        for change in batch["changes"]:
            cursor = change["sequence"]
            yield _sse(
                "oscal.change",
                {
                    "vendor_id": vendor_id,
                    "cursor": cursor,
                    "change": change,
                    "pull": {
                        model: f"{network_url}/v1/vendors/{vendor_id}/oscal/{model}"
                        for model in change["models"]
                    },
                },
                event_id=str(cursor),
            )
        if not batch["changes"]:
            yield ": keepalive\n\n"
        time.sleep(1 if batch["has_more"] else 5)
    yield _sse("oscal.reconnect", {"vendor_id": vendor_id, "cursor": cursor})


def _sse(event: str, data: dict, *, event_id: str | None = None) -> str:
    frame = f"event: {event}\n"
    if event_id:
        frame += f"id: {event_id}\n"
    frame += f"data: {json.dumps(data, separators=(',', ':'), default=str)}\n\n"
    return frame
