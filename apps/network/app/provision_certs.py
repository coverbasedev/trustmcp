"""Drive custom-domain TLS to completion and keep the stored status honest.

Webhooks don't tell us when Render finishes issuing a certificate, so this runs on
a schedule (a Render cron job) and, for every custom domain that isn't live yet:

  1. (re)registers it on the Render service so issuance is kicked off / retried, and
  2. re-probes the real serving state and flips the stored status to "active" once
     HTTPS is genuinely serving.

Idempotent and safe to run frequently. No-ops the Render calls when Render isn't
configured — it still refreshes the honest "provisioning"/"blocked" status.

Run:  python -m app.provision_certs
"""

from __future__ import annotations

from .config import get_settings
from .db import SessionLocal, init_db
from .models import Vendor
from .render_api import ensure_custom_domain as render_ensure_custom_domain

# Reuse the exact assessment the verify endpoint uses, so the poller and the
# interactive "Re-check" button can never disagree.
from .routers.manage import _assess_tls

# Domains in these states still have work to do; "active" ones are already done.
_PENDING_TLS = {"none", "pending", "provisioning", "blocked", "issued"}


def run() -> int:
    settings = get_settings()
    init_db()
    db = SessionLocal()
    activated = 0
    try:
        for vendor in db.query(Vendor).all():
            branding = vendor.branding or {}
            cd = branding.get("custom_domain")
            # Only domains whose ownership is verified but that aren't live yet.
            if not cd or cd.get("status") not in ("verified", "active"):
                continue
            if cd.get("tls") == "active":
                continue
            if cd.get("tls") not in _PENDING_TLS:
                continue

            cd = dict(cd)
            domain = cd["domain"]
            if settings.render_enabled:
                try:
                    rec = render_ensure_custom_domain(settings, domain)
                    cd["render_domain_id"] = rec.get("id")
                    cd["render_verification"] = rec.get("verification_status")
                except Exception as e:  # noqa: BLE001 - one tenant must not abort the sweep
                    print(f"render registration failed for {domain}: {e}")

            tls_state, tls_message = _assess_tls(domain, cd["cname_target"])
            new_status = "active" if tls_state == "active" else "verified"
            if tls_state == cd.get("tls") and new_status == cd.get("status"):
                continue  # nothing changed; don't churn the row

            cd["tls"] = tls_state
            cd["last_error"] = tls_message
            cd["status"] = new_status
            new_branding = dict(branding)
            new_branding["custom_domain"] = cd
            vendor.branding = new_branding
            db.add(vendor)
            db.commit()
            if tls_state == "active":
                activated += 1

        print(f"Cert provisioning sweep complete: {activated} domain(s) went live.")
        return activated
    finally:
        db.close()


if __name__ == "__main__":
    run()
