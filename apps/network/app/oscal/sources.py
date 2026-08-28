"""Canonical source URIs for the frameworks TrustMCP maps onto.

OSCAL `control-implementation/source` and `profile/import/href` must point at
the catalog the control ids come from. Where NIST publishes an official OSCAL
catalog we use it; where a standard has no machine-readable catalog (SOC 2, ISO
27001) we point at the authoritative human document and flag it, so a consumer
can tell resolvable references apart from informative ones.
"""

from __future__ import annotations

SOURCES: dict[str, dict] = {
    "soc2": {
        "href": "https://www.aicpa.org/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022",
        "resolvable": False,
        "title": "AICPA Trust Services Criteria",
    },
    "nist_800_53": {
        "href": "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json",
        "resolvable": True,
        "title": "NIST SP 800-53 Rev 5 catalog (OSCAL)",
    },
    "iso_27001": {
        "href": "https://www.iso.org/standard/27001",
        "resolvable": False,
        "title": "ISO/IEC 27001:2022 Annex A",
    },
}


def source_href(framework: str) -> str:
    entry = SOURCES.get(framework)
    return entry["href"] if entry else f"https://trustmcp.org/frameworks/{framework}"


def source_title(framework: str) -> str:
    entry = SOURCES.get(framework)
    return entry["title"] if entry else framework


def is_resolvable(framework: str) -> bool:
    entry = SOURCES.get(framework)
    return bool(entry and entry["resolvable"])
