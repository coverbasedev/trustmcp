from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from .config import Settings

log = logging.getLogger("trustmcp.mailer")


def send_email(settings: Settings, to: str, subject: str, body: str) -> bool:
    """Best-effort transactional email via SMTP. No-ops (logs) when SMTP is
    unconfigured, so the network runs fine without email in dev."""
    if not settings.use_smtp or not to:
        log.info("[mail:skipped] to=%s subject=%r (smtp not configured)", to, subject)
        return False
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
            if settings.smtp_starttls:
                s.starttls()
            if settings.smtp_username:
                s.login(settings.smtp_username, settings.smtp_password)
            s.send_message(msg)
        return True
    except Exception as e:  # pragma: no cover - network dependent
        log.warning("[mail:error] to=%s subject=%r err=%s", to, subject, e)
        return False
