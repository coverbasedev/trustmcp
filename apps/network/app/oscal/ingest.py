"""Importing OSCAL into TrustMCP.

Export alone is half an exchange. A vendor whose GRC platform already holds an
OSCAL component-definition or SSP should be able to hand it to TrustMCP and have
their trust center populated from it, rather than retyping claims into a form.

The import is deliberately two-phase. `plan_import` is pure: it reads a document
and returns exactly what it *would* change, with the reason for each item. Only
`apply_import` touches the database. That split means the API can offer a real
dry run, the web UI can show a diff before anything is written, and the parsing
logic is testable without a session.

What we read, and from where:

  claims        `trustmcp-claim-key` / `trustmcp-claim-value` props anywhere in
                the document; failing that, implemented-requirements whose
                control-id maps back to claim keys through the framework tables.
  controls      SSP `by-components` implementation-status, and
                assessment-results findings targeting a named control.
  subprocessors components carrying `trustmcp-subprocessor`, or any component of
                type `service` other than the primary one.
  artifacts     back-matter resources — recorded as *references*, never as
                content. TrustMCP will not fetch a URL a document tells it to.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..frameworks import FRAMEWORKS
from .validate import ROOT_MODELS, validate


# The reverse of the framework mapping: control-id -> claim keys it implies.
def _control_to_claims() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for fw in FRAMEWORKS.values():
        for control in fw["controls"]:
            out.setdefault(control["id"], [])
            for claim in control["claims"]:
                if claim not in out[control["id"]]:
                    out[control["id"]].append(claim)
    return out


CONTROL_TO_CLAIMS = _control_to_claims()

# Implementation states that mean "this control is not in force here". A claim is
# only inferred from a requirement the document says is actually implemented.
_UNIMPLEMENTED = {"not-implemented", "planned", "alternative", "not-applicable"}

# Keys that mark a node as an actual implemented-requirement rather than a
# control selector.
_IMPLEMENTATION_SIGNALS = {"uuid", "by-components", "implementation-status", "statements"}


@dataclass
class ProposedClaim:
    key: str
    value: Any
    evidence: list[str] = field(default_factory=list)
    source: str = "props"

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "value": self.value,
            "evidence": self.evidence,
            "source": self.source,
        }


@dataclass
class ProposedControl:
    category: str
    name: str
    description: str | None
    status: str

    def as_dict(self) -> dict:
        return {
            "category": self.category,
            "name": self.name,
            "description": self.description,
            "status": self.status,
        }


@dataclass
class ProposedSubprocessor:
    name: str
    purpose: str | None = None
    location: str | None = None
    domain: str | None = None

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "purpose": self.purpose,
            "location": self.location,
            "domain": self.domain,
        }


@dataclass
class EvidenceReference:
    """A back-matter resource seen on import.

    Recorded, never fetched. TrustMCP stores what the document says exists so the
    owner can decide whether to upload the real file; following an arbitrary URL
    from an uploaded document would make this endpoint a fetch primitive for
    whoever can post to it.
    """

    title: str
    href: str | None
    media_type: str | None
    sha256: str | None
    artifact_id: str | None

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "href": self.href,
            "media_type": self.media_type,
            "sha256": self.sha256,
            "artifact_id": self.artifact_id,
        }


@dataclass
class ImportPlan:
    model: str | None
    valid: bool
    issues: list[dict]
    claims: list[ProposedClaim] = field(default_factory=list)
    controls: list[ProposedControl] = field(default_factory=list)
    subprocessors: list[ProposedSubprocessor] = field(default_factory=list)
    evidence: list[EvidenceReference] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "model": self.model,
            "valid": self.valid,
            "issues": self.issues,
            "claims": [c.as_dict() for c in self.claims],
            "controls": [c.as_dict() for c in self.controls],
            "subprocessors": [s.as_dict() for s in self.subprocessors],
            "evidence": [e.as_dict() for e in self.evidence],
            "notes": self.notes,
            "counts": {
                "claims": len(self.claims),
                "controls": len(self.controls),
                "subprocessors": len(self.subprocessors),
                "evidence": len(self.evidence),
            },
        }


# --- Parsing -----------------------------------------------------------------


def _iter_nodes(node: object):
    """Every dict in the document, depth-first."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _iter_nodes(value)
    elif isinstance(node, list):
        for entry in node:
            yield from _iter_nodes(entry)


def _props(node: dict) -> dict[str, str]:
    """Flatten a node's props into name -> value (last one wins)."""
    return {
        p.get("name"): p.get("value")
        for p in node.get("props", [])
        if isinstance(p, dict) and p.get("name")
    }


def _coerce(value: str) -> Any:
    """Props are strings; recover the obvious types so a round trip through
    OSCAL doesn't turn `true` into `"true"`."""
    if value is None:
        return None
    lowered = str(value).strip().lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    text = str(value).strip()
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        pass
    if "," in text:
        parts = [p.strip() for p in text.split(",") if p.strip()]
        if len(parts) > 1:
            return parts
    return text


def _claims_from_props(document: object) -> dict[str, ProposedClaim]:
    """Claims carried explicitly — the round-trip path for documents we emitted."""
    found: dict[str, ProposedClaim] = {}
    for node in _iter_nodes(document):
        props = _props(node)
        key = props.get("trustmcp-claim-key")
        if not key:
            continue
        raw = props.get("trustmcp-claim-value")
        evidence = [
            p.get("value")
            for p in node.get("props", [])
            if isinstance(p, dict) and p.get("name") == "trustmcp-evidence" and p.get("value")
        ]
        existing = found.get(key)
        if existing and raw is None:
            continue
        found[key] = ProposedClaim(
            key=key,
            value=_coerce(raw) if raw is not None else True,
            evidence=evidence or (existing.evidence if existing else []),
            source="props",
        )
    return found


def _claims_from_requirements(document: object) -> dict[str, ProposedClaim]:
    """Claims inferred from control coverage — the path for third-party OSCAL.

    A foreign component-definition has no TrustMCP props, but its
    implemented-requirements name controls we already map. An implemented
    control implies the claims that control maps to. This is an inference, so
    every claim produced here is marked `source="inferred"` and the plan carries
    a note saying so — the owner confirms before anything is written.
    """
    found: dict[str, ProposedClaim] = {}
    for node in _iter_nodes(document):
        control_id = node.get("control-id") if isinstance(node, dict) else None
        if not control_id or control_id not in CONTROL_TO_CLAIMS:
            continue
        if not _IMPLEMENTATION_SIGNALS & node.keys():
            # A bare {"control-id": ...} is a *selector* — an include-controls
            # entry or a reviewed-controls row saying which controls were looked
            # at. It asserts nothing about implementation, so infer nothing.
            continue
        props = _props(node)
        if props.get("trustmcp-claim-key"):
            # The requirement names the exact claims behind it. Trust that over
            # the framework table, which would otherwise add every *other* claim
            # the control maps to as though the vendor had published it.
            continue
        if props.get("trustmcp-coverage") == "not-claimed":
            # A TrustMCP-emitted document says outright that no claim backs this
            # control. Re-importing it must not manufacture one.
            continue
        if _implementation_state(node) in _UNIMPLEMENTED:
            continue
        for key in CONTROL_TO_CLAIMS[control_id]:
            # A numeric claim (a notification window, an SLA) has no defensible
            # value to infer from "the control is implemented", so skip it
            # rather than invent one.
            if key.endswith(("_hours", ".count", ".sla", ".frequency")):
                continue
            found.setdefault(key, ProposedClaim(key=key, value=True, source="inferred"))
    return found


def _implementation_state(node: dict) -> str | None:
    status = node.get("implementation-status")
    if isinstance(status, dict) and status.get("state"):
        return str(status["state"])
    props = _props(node)
    return props.get("implementation-status")


def _controls_from_document(document: object) -> list[ProposedControl]:
    """Control status from SSP by-components and requirement statuses."""
    controls: dict[tuple[str, str], ProposedControl] = {}
    for node in _iter_nodes(document):
        if not isinstance(node, dict):
            continue
        control_id = node.get("control-id")
        if not control_id:
            continue
        state = _implementation_state(node)
        for sub in node.get("by-components", []) or []:
            state = _implementation_state(sub) or state
        if not state:
            continue
        title = node.get("description") or control_id
        category = _framework_for_control(str(control_id)) or "Imported"
        key = (category, str(control_id))
        controls[key] = ProposedControl(
            category=category,
            name=str(control_id),
            description=str(title)[:500],
            status="operating" if state in ("implemented", "operating") else "not_operating",
        )
    return list(controls.values())


def _framework_for_control(control_id: str) -> str | None:
    for fw in FRAMEWORKS.values():
        if any(c["id"] == control_id for c in fw["controls"]):
            return fw["name"]
    return None


def _subprocessors_from_document(document: object) -> list[ProposedSubprocessor]:
    out: dict[str, ProposedSubprocessor] = {}
    for node in _iter_nodes(document):
        if not isinstance(node, dict) or "type" not in node or "title" not in node:
            continue
        props = _props(node)
        is_sub = props.get("trustmcp-subprocessor") == "true"
        if not is_sub:
            continue
        name = str(node["title"])
        out[name] = ProposedSubprocessor(
            name=name,
            purpose=node.get("description") or node.get("purpose"),
            location=props.get("trustmcp-location"),
            domain=props.get("trustmcp-domain"),
        )
    return list(out.values())


def _evidence_from_document(document: object) -> list[EvidenceReference]:
    out: list[EvidenceReference] = []
    for node in _iter_nodes(document):
        if not isinstance(node, dict) or "back-matter" not in node:
            continue
        for res in (node["back-matter"] or {}).get("resources", []) or []:
            if not isinstance(res, dict):
                continue
            props = _props(res)
            if props.get("type") == "verification":
                continue  # the network's own key/mark endpoints, not vendor evidence
            rlinks = res.get("rlinks") or []
            first = rlinks[0] if rlinks and isinstance(rlinks[0], dict) else {}
            hashes = first.get("hashes") or []
            sha = next(
                (
                    h.get("value")
                    for h in hashes
                    if isinstance(h, dict) and h.get("algorithm", "").upper() == "SHA-256"
                ),
                None,
            )
            out.append(
                EvidenceReference(
                    title=str(res.get("title") or "Untitled resource"),
                    href=first.get("href"),
                    media_type=first.get("media-type"),
                    sha256=sha,
                    artifact_id=props.get("trustmcp-artifact-id"),
                )
            )
    return out


def plan_import(document: object) -> ImportPlan:
    """Read an OSCAL document and describe what importing it would change.

    Pure — no database, no network. Safe to call on anything a user uploads.
    """
    report = validate(document)
    plan = ImportPlan(model=report["model"], valid=report["valid"], issues=report["issues"])
    if report["model"] not in ROOT_MODELS:
        plan.notes.append("Not a recognized OSCAL root model; nothing was read.")
        return plan

    explicit = _claims_from_props(document)
    inferred = _claims_from_requirements(document)
    for key, claim in inferred.items():
        explicit.setdefault(key, claim)
    plan.claims = sorted(explicit.values(), key=lambda c: c.key)

    plan.controls = sorted(_controls_from_document(document), key=lambda c: (c.category, c.name))
    plan.subprocessors = sorted(_subprocessors_from_document(document), key=lambda s: s.name)
    plan.evidence = sorted(_evidence_from_document(document), key=lambda e: e.title)

    inferred_count = sum(1 for c in plan.claims if c.source == "inferred")
    if inferred_count:
        plan.notes.append(
            f"{inferred_count} claim(s) were inferred from implemented control coverage "
            "rather than read from explicit TrustMCP properties. Review them before applying."
        )
    if plan.evidence:
        plan.notes.append(
            f"{len(plan.evidence)} evidence reference(s) were recorded. TrustMCP does not "
            "download referenced files — upload the documents you want published."
        )
    if not plan.valid:
        plan.notes.append(
            "The document has structural errors. It can still be imported, but fix them "
            "before relying on a round trip."
        )
    return plan


# --- Applying ----------------------------------------------------------------


def apply_import(db, vendor, plan: ImportPlan, *, mode: str = "merge") -> dict:
    """Write a plan onto a vendor.

    `mode="merge"` adds and updates, leaving anything the document did not
    mention alone. `mode="replace"` makes the vendor's claims and controls match
    the document exactly. Evidence references are never applied — they are
    reported so the owner can upload the real files.
    """
    from datetime import UTC, datetime

    from ..models import Claim, Control, Subprocessor

    if mode not in ("merge", "replace"):
        raise ValueError("mode must be 'merge' or 'replace'")

    applied = {"claims": 0, "controls": 0, "subprocessors": 0, "removed": 0}

    existing_claims = {c.key: c for c in vendor.claims}
    incoming_keys = {c.key for c in plan.claims}
    for proposed in plan.claims:
        current = existing_claims.get(proposed.key)
        if current is None:
            db.add(
                Claim(
                    vendor_id=vendor.id,
                    key=proposed.key,
                    value=proposed.value,
                    evidence=proposed.evidence,
                )
            )
            applied["claims"] += 1
        elif current.value != proposed.value or (
            proposed.evidence and current.evidence != proposed.evidence
        ):
            current.value = proposed.value
            if proposed.evidence:
                current.evidence = proposed.evidence
            applied["claims"] += 1
    if mode == "replace":
        for key, claim in existing_claims.items():
            if key not in incoming_keys:
                db.delete(claim)
                applied["removed"] += 1

    if plan.controls:
        if mode == "replace":
            for control in list(vendor.controls):
                db.delete(control)
                applied["removed"] += 1
            existing_controls: dict[tuple[str, str], Control] = {}
        else:
            existing_controls = {(c.category, c.name): c for c in vendor.controls}
        for position, proposed in enumerate(plan.controls):
            current = existing_controls.get((proposed.category, proposed.name))
            if current is None:
                db.add(
                    Control(
                        vendor_id=vendor.id,
                        category=proposed.category,
                        name=proposed.name,
                        description=proposed.description,
                        status=proposed.status,
                        position=position,
                    )
                )
            else:
                current.description = proposed.description
                current.status = proposed.status
            applied["controls"] += 1
        vendor.controls_updated_at = datetime.now(UTC)

    existing_subs = {s.name for s in vendor.subprocessors}
    for proposed in plan.subprocessors:
        if proposed.name in existing_subs:
            continue
        db.add(
            Subprocessor(
                vendor_id=vendor.id,
                name=proposed.name,
                purpose=proposed.purpose,
                location=proposed.location,
                domain=proposed.domain,
            )
        )
        applied["subprocessors"] += 1

    if applied["claims"]:
        vendor.attestations_generated_at = datetime.now(UTC)

    db.commit()
    return {
        "mode": mode,
        "applied": applied,
        "evidence_references": [e.as_dict() for e in plan.evidence],
        "notes": plan.notes,
    }
