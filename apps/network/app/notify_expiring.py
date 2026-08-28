"""Email vendors about expiring/expired artifacts (the spec's freshness nudge).

Run on a schedule (cron / a Render cron job):
    python -m app.notify_expiring
"""

from __future__ import annotations

from datetime import UTC, datetime

from .config import get_settings
from .db import SessionLocal, init_db
from .mailer import send_email
from .models import Vendor
from .services import freshness_for


def run() -> int:
    settings = get_settings()
    init_db()
    db = SessionLocal()
    notified = 0
    try:
        vendors = db.query(Vendor).all()
        for vendor in vendors:
            if not vendor.notify_email:
                continue
            by_id = {a.id: a for a in vendor.artifacts}
            fresh = freshness_for(vendor, settings)
            # Only nudge about artifacts in the window that we haven't already emailed
            # for this expiry (idempotent - avoids daily spam). The flag is cleared
            # when the vendor changes valid_until (see manage.update_artifact).
            attention = [
                i
                for i in fresh["items"]
                if i["status"] in ("expiring", "expired")
                and by_id.get(i["id"]) is not None
                and by_id[i["id"]].expiry_notified_at is None
            ]
            if not attention:
                continue
            lines = "\n".join(
                f"  - {i['id']}: {i['status']} (valid_until {i['valid_until']}, "
                f"{i['days_left']} days)"
                for i in attention
            )
            ok = send_email(
                settings,
                vendor.notify_email,
                f"[TrustMCP] {len(attention)} artifact(s) need attention for {vendor.legal_name}",
                f"The following artifacts are expiring or expired:\n\n{lines}\n\n"
                f"Refresh them in your trust center so every customer sees the update at once.",
            )
            if ok:
                now = datetime.now(UTC)
                for i in attention:
                    by_id[i["id"]].expiry_notified_at = now
                db.commit()
                notified += 1
        print(f"Freshness nudge complete: {notified} vendor(s) notified.")
        return notified
    finally:
        db.close()


if __name__ == "__main__":
    run()
