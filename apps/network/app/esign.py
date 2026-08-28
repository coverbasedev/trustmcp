"""Docusign eSignature integration for self-service agreements (DPAs).

Uses the JWT Grant (impersonation) OAuth flow, then creates and sends an envelope
from a template with the visitor as the signer. Status updates flow back via a
Docusign Connect webhook (see routers/esign.py).

All functions are config-gated by Settings.esign_enabled - callers fall back to
capture-and-notify when Docusign isn't configured.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

from .config import Settings
from .models import Agreement, Vendor

log = logging.getLogger("trustmcp.esign")


@dataclass
class EsignConfig:
    """The effective Docusign config for one vendor: per-vendor credentials when
    set, otherwise the network-global defaults. Resolving once keeps every caller
    consistent and lets each trust center sign from its own Docusign account."""

    account_id: str
    integration_key: str
    user_id: str
    private_key: str
    auth_host: str
    base_uri: str
    role_name: str
    dpa_template_id: str
    connect_hmac_key: str

    @property
    def enabled(self) -> bool:
        return bool(self.account_id and self.integration_key and self.user_id and self.private_key)


def resolve_config(settings: Settings, vendor: Vendor | None) -> EsignConfig:
    """Vendor credentials win over the network-global config, field by field."""

    def pick(attr: str, default: str) -> str:
        val = getattr(vendor, attr, None) if vendor is not None else None
        return val or default

    return EsignConfig(
        account_id=pick("docusign_account_id", settings.docusign_account_id),
        integration_key=pick("docusign_integration_key", settings.docusign_integration_key),
        user_id=pick("docusign_user_id", settings.docusign_user_id),
        private_key=pick("docusign_private_key", settings.docusign_private_key),
        auth_host=pick("docusign_auth_host", settings.docusign_auth_host),
        base_uri=pick("docusign_base_uri", settings.docusign_base_uri),
        role_name=settings.docusign_role_name,
        dpa_template_id=pick("dpa_template_id", settings.docusign_dpa_template_id),
        connect_hmac_key=pick("docusign_connect_hmac_key", settings.docusign_connect_hmac_key),
    )


def esign_enabled_for(settings: Settings, vendor: Vendor | None) -> bool:
    """Whether DPA e-signature is configured for this vendor (per-vendor or global)."""
    return resolve_config(settings, vendor).enabled

# Docusign envelope status -> our Agreement.status.
_STATUS_MAP = {
    "sent": "sent",
    "delivered": "sent",
    "completed": "signed",
    "signed": "signed",
    "declined": "declined",
    "voided": "voided",
}


def map_envelope_status(docusign_status: str | None) -> str | None:
    if not docusign_status:
        return None
    return _STATUS_MAP.get(docusign_status.lower())


def _access_token(cfg: EsignConfig) -> str:
    """Mint a Docusign access token via JWT grant (impersonation)."""
    import jwt  # PyJWT

    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": cfg.integration_key,
            "sub": cfg.user_id,
            "aud": cfg.auth_host,
            "iat": now,
            "exp": now + 3600,
            "scope": "signature impersonation",
        },
        cfg.private_key,
        algorithm="RS256",
    )
    r = httpx.post(
        f"https://{cfg.auth_host}/oauth/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
        timeout=20,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def build_envelope_payload(settings: Settings, vendor: Vendor, agreement: Agreement) -> dict:
    """Construct the Docusign envelope creation body for a DPA template.

    Pure function (no I/O) so it can be unit-tested. Pre-fills the company/signer
    fields onto the template role's tabs by label."""
    cfg = resolve_config(settings, vendor)
    template_id = cfg.dpa_template_id
    address = agreement.address or {}
    text_tabs = [
        {"tabLabel": "company_name", "value": agreement.company_name},
        {"tabLabel": "company_address", "value": _format_address(address)},
        {"tabLabel": "signer_title", "value": agreement.signer_title or ""},
        {"tabLabel": "doing_business_as", "value": agreement.doing_business_as or ""},
        {"tabLabel": "registration_number", "value": agreement.registration_number or ""},
        {"tabLabel": "contact_details", "value": agreement.contact_details or ""},
    ]
    return {
        "templateId": template_id,
        "status": "sent",
        "emailSubject": f"Please sign: {vendor.legal_name} Data Processing Addendum",
        "templateRoles": [
            {
                "roleName": cfg.role_name,
                "name": agreement.signer_name,
                "email": agreement.signer_email,
                "tabs": {"textTabs": text_tabs},
            }
        ],
    }


def _format_address(address: dict) -> str:
    parts = [
        address.get("line1"),
        address.get("line2"),
        address.get("locality"),
        address.get("region"),
        address.get("postcode"),
        address.get("country"),
    ]
    return ", ".join(p for p in parts if p)


def send_dpa_envelope(settings: Settings, vendor: Vendor, agreement: Agreement) -> str:
    """Create and send a Docusign envelope for a DPA. Returns the envelope id.

    Raises on failure (caller records the error and leaves status as 'submitted')."""
    cfg = resolve_config(settings, vendor)
    if not cfg.dpa_template_id:
        raise RuntimeError("no DPA template configured (set docusign_dpa_template_id)")
    token = _access_token(cfg)
    payload = build_envelope_payload(settings, vendor, agreement)
    r = httpx.post(
        f"{cfg.base_uri}/v2.1/accounts/{cfg.account_id}/envelopes",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["envelopeId"]
