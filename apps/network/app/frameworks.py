"""Static claim → control mappings for common frameworks.

TrustMCP standardizes access to evidence, not the verdict - so these mappings tell a customer
*which controls a claim speaks to*, not whether the vendor passes. Customers apply their
own pass/fail logic. The set is intentionally small and extensible.
"""

from __future__ import annotations


def _c(id_: str, title: str, *claims: str) -> dict:
    return {"id": id_, "title": title, "claims": list(claims)}


# framework_id -> {name, controls: [{id, title, claims: [claim_key, ...]}]}
FRAMEWORKS: dict[str, dict] = {
    "soc2": {
        "name": "SOC 2 (Trust Services Criteria)",
        "controls": [
            _c("CC6.1", "Logical access controls", "mfa.enforced", "access_control.rbac"),
            _c("CC6.6", "Encryption in transit", "encryption.in_transit"),
            _c("CC6.7", "Encryption at rest", "encryption.at_rest"),
            _c("CC7.2", "Incident / breach response", "breach_notification_hours"),
            _c("A1.2", "Availability commitments", "availability.sla"),
            _c("CC9.2", "Vendor / subprocessor management", "subprocessors.count"),
        ],
    },
    "nist_800_53": {
        "name": "NIST SP 800-53 (selected)",
        "controls": [
            _c("IA-2", "Identification and authentication (MFA)", "mfa.enforced"),
            _c("SC-28", "Protection of information at rest", "encryption.at_rest"),
            _c("SC-8", "Transmission confidentiality", "encryption.in_transit"),
            _c("IR-6", "Incident reporting", "breach_notification_hours"),
            _c("CP-2", "Contingency / BCDR", "bcp_dr.tested"),
            _c("SA-9", "External system services", "subprocessors.count"),
        ],
    },
    "iso_27001": {
        "name": "ISO/IEC 27001:2022 Annex A (selected)",
        "controls": [
            _c("A.5.15", "Access control", "mfa.enforced", "access_control.rbac"),
            _c("A.8.24", "Use of cryptography", "encryption.at_rest", "encryption.in_transit"),
            _c("A.5.24", "Incident management planning", "breach_notification_hours"),
            _c("A.5.30", "ICT readiness for continuity", "bcp_dr.tested"),
            _c("A.5.19", "Supplier relationships", "subprocessors.count"),
        ],
    },
}


def list_frameworks() -> list[dict]:
    return [
        {"id": k, "name": v["name"], "controls": len(v["controls"])}
        for k, v in FRAMEWORKS.items()
    ]


def map_claims(framework_id: str, claims: list[dict]) -> dict:
    """Map a vendor's claims onto a framework's controls."""
    fw = FRAMEWORKS[framework_id]
    by_key = {c["key"]: c for c in claims}
    rows = []
    for control in fw["controls"]:
        matched = [by_key[k] for k in control["claims"] if k in by_key]
        rows.append(
            {
                "control": control["id"],
                "title": control["title"],
                "claims": [
                    {"key": m["key"], "value": m["value"], "evidence": m.get("evidence", [])}
                    for m in matched
                ],
                "present": len(matched) > 0,
            }
        )
    return {"framework": framework_id, "name": fw["name"], "controls": rows}
