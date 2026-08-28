"""The snapshot a set of OSCAL documents is rendered from.

Every model builder takes an `OscalContext` rather than a SQLAlchemy `Vendor`.
That keeps the builders pure — they are exercised in tests with hand-built
contexts, and the ORM appears in exactly one place (`from_vendor`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any


@dataclass(frozen=True)
class ClaimRecord:
    key: str
    value: Any
    evidence: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ArtifactRecord:
    id: str
    type: str
    title: str | None
    format: str | None
    issued_at: date
    valid_until: date | None
    sha256: str | None
    access: str
    version: int
    category: str | None
    scope: str | None
    description: str | None
    product_ids: list[str]
    has_content: bool
    freshness: str  # valid | expiring | expired


@dataclass(frozen=True)
class ControlRecord:
    category: str
    name: str
    description: str | None
    status: str  # operating | not_operating


@dataclass(frozen=True)
class SubprocessorRecord:
    name: str
    purpose: str | None
    location: str | None
    domain: str | None
    category: str | None


@dataclass(frozen=True)
class BadgeRecord:
    name: str
    standard: str | None
    issued_on: date | None
    valid_until: date | None
    evidence_artifact_id: str | None


@dataclass(frozen=True)
class OscalContext:
    """Everything the OSCAL exporters need about one vendor at one instant."""

    vendor_id: str
    legal_name: str
    product: str | None
    products: list[dict]
    domains: list[str]
    mark_status: str
    published_at: datetime | None
    generated_at: datetime
    network_url: str
    claims: list[ClaimRecord] = field(default_factory=list)
    artifacts: list[ArtifactRecord] = field(default_factory=list)
    controls: list[ControlRecord] = field(default_factory=list)
    subprocessors: list[SubprocessorRecord] = field(default_factory=list)
    badges: list[BadgeRecord] = field(default_factory=list)
    data_types: list[dict] = field(default_factory=list)

    @property
    def provider_uuid(self) -> str:
        """UUID of the vendor party. Kept in lockstep with `common.vendor_party`
        so requirements can reference the provider without threading the party
        object through every builder."""
        from .common import derive_uuid

        return derive_uuid(self.vendor_id, "party", "vendor")

    @property
    def anchor_uuid(self) -> str:
        from .common import derive_uuid

        return derive_uuid("network", self.network_url, "party")

    @property
    def claims_by_key(self) -> dict[str, ClaimRecord]:
        return {c.key: c for c in self.claims}

    @property
    def artifacts_by_id(self) -> dict[str, ArtifactRecord]:
        return {a.id: a for a in self.artifacts}

    def artifact_uri(self, artifact_id: str) -> str:
        return f"{self.network_url}/v1/vendors/{self.vendor_id}/artifacts/{artifact_id}"


def from_vendor(vendor, settings, *, freshness: dict | None = None) -> OscalContext:
    """Build a context from the ORM `Vendor` and the current settings.

    `freshness` is the payload from `services.freshness_for`; passing it avoids
    recomputing expiry when the caller already has it.
    """
    from ..services import freshness_for

    fresh = freshness or freshness_for(vendor, settings)
    fresh_by_id = {item["id"]: item["status"] for item in fresh.get("items", [])}

    return OscalContext(
        vendor_id=vendor.id,
        legal_name=vendor.legal_name,
        product=vendor.product,
        products=list(vendor.products or []),
        domains=list(vendor.domains or []),
        mark_status=vendor.mark_status,
        published_at=vendor.published_at,
        generated_at=datetime.now(UTC),
        network_url=settings.public_base_url.rstrip("/"),
        claims=[
            ClaimRecord(key=c.key, value=c.value, evidence=list(c.evidence or []))
            for c in sorted(vendor.claims, key=lambda x: x.key)
        ],
        artifacts=[
            ArtifactRecord(
                id=a.id,
                type=a.type,
                title=a.title,
                format=a.format,
                issued_at=a.issued_at,
                valid_until=a.valid_until,
                sha256=a.sha256,
                access=a.access,
                version=a.version,
                category=a.category,
                scope=a.scope,
                description=getattr(a, "description", None),
                product_ids=list(a.product_ids or []),
                has_content=bool(a.storage_key),
                freshness=fresh_by_id.get(a.id, "valid"),
            )
            for a in sorted(vendor.artifacts, key=lambda x: x.id)
        ],
        controls=[
            ControlRecord(
                category=c.category, name=c.name, description=c.description, status=c.status
            )
            for c in sorted(vendor.controls, key=lambda x: (x.category, x.position, x.name))
        ],
        subprocessors=[
            SubprocessorRecord(
                name=s.name,
                purpose=s.purpose,
                location=s.location,
                domain=s.domain,
                category=s.category,
            )
            for s in sorted(vendor.subprocessors, key=lambda x: x.name)
        ],
        badges=[
            BadgeRecord(
                name=b.name,
                standard=b.standard,
                issued_on=b.issued_on,
                valid_until=b.valid_until,
                evidence_artifact_id=b.evidence_artifact_id,
            )
            for b in sorted(vendor.badges, key=lambda x: x.position)
        ],
        data_types=[
            {"label": d.label, "collected": d.collected}
            for d in sorted(vendor.data_types, key=lambda x: x.position)
        ],
    )
