"""Structural validation for OSCAL documents.

Full OSCAL validation means running the NIST JSON Schema or Metaschema, which we
do not bundle — the schemas are large and versioned independently of this
service. What this module does instead is check the invariants that actually
break interoperability in practice, on both the documents we emit and the ones
we accept on import:

  * exactly one recognized root model,
  * a `metadata` block with title, last-modified, version, and oscal-version,
  * a syntactically valid UUID everywhere OSCAL requires one,
  * no duplicate UUIDs within a document,
  * no `#fragment` link that points at a UUID the document does not define.

That last check is the one that catches real damage: a dangling evidence
reference silently loses the link between a claim and the artifact backing it.
"""

from __future__ import annotations

import re
import uuid as uuid_mod

ROOT_MODELS = {
    "catalog",
    "profile",
    "component-definition",
    "system-security-plan",
    "assessment-plan",
    "assessment-results",
    "plan-of-action-and-milestones",
    "mapping",
}

REQUIRED_METADATA = ("title", "last-modified", "version", "oscal-version")

_UUID_KEYS = re.compile(r"(^|-)uuid$|-uuids$")


class ValidationIssue:
    def __init__(self, severity: str, path: str, message: str):
        self.severity = severity  # error | warning
        self.path = path
        self.message = message

    def as_dict(self) -> dict:
        return {"severity": self.severity, "path": self.path, "message": self.message}


def validate(document: object) -> dict:
    """Return `{"valid": bool, "model": str|None, "issues": [...]}`."""
    issues: list[ValidationIssue] = []

    if not isinstance(document, dict):
        return {
            "valid": False,
            "model": None,
            "issues": [ValidationIssue("error", "$", "document must be a JSON object").as_dict()],
        }
    if len(document) != 1:
        issues.append(
            ValidationIssue(
                "error", "$", f"expected exactly one root model, found {len(document)}"
            )
        )
    model = next(iter(document), None)
    if model not in ROOT_MODELS:
        issues.append(
            ValidationIssue("error", "$", f"'{model}' is not an OSCAL root model")
        )
        return _result(model, issues)

    body = document[model]
    if not isinstance(body, dict):
        issues.append(ValidationIssue("error", f"$.{model}", "root model must be an object"))
        return _result(model, issues)

    _check_uuid(body.get("uuid"), f"$.{model}.uuid", issues, required=True)
    _check_metadata(body.get("metadata"), f"$.{model}.metadata", issues)

    declared: set[str] = set()
    duplicates: set[str] = set()
    fragments: list[tuple[str, str]] = []
    _walk(body, f"$.{model}", issues, declared, duplicates, fragments)

    for dup in sorted(duplicates):
        issues.append(ValidationIssue("error", "$", f"duplicate uuid {dup}"))
    for path, target in fragments:
        if target not in declared:
            issues.append(
                ValidationIssue(
                    "error", path, f"link points at undefined uuid #{target}"
                )
            )

    return _result(model, issues)


def _result(model: str | None, issues: list[ValidationIssue]) -> dict:
    return {
        "valid": not any(i.severity == "error" for i in issues),
        "model": model,
        "issues": [i.as_dict() for i in issues],
    }


def _check_metadata(meta: object, path: str, issues: list[ValidationIssue]) -> None:
    if not isinstance(meta, dict):
        issues.append(ValidationIssue("error", path, "metadata block is missing"))
        return
    for field in REQUIRED_METADATA:
        if not meta.get(field):
            issues.append(ValidationIssue("error", f"{path}.{field}", "required field is missing"))
    version = meta.get("oscal-version")
    if version and not re.match(r"^\d+\.\d+\.\d+", str(version)):
        issues.append(
            ValidationIssue(
                "warning", f"{path}.oscal-version", f"unexpected version string '{version}'"
            )
        )


def _check_uuid(
    value: object, path: str, issues: list[ValidationIssue], *, required: bool = False
) -> bool:
    if value is None:
        if required:
            issues.append(ValidationIssue("error", path, "required uuid is missing"))
        return False
    try:
        uuid_mod.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        issues.append(ValidationIssue("error", path, f"'{value}' is not a valid uuid"))
        return False


def _walk(
    node: object,
    path: str,
    issues: list[ValidationIssue],
    declared: set[str],
    duplicates: set[str],
    fragments: list[tuple[str, str]],
) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}"
            if key == "uuid" and isinstance(value, str):
                if _check_uuid(value, child, issues):
                    if value in declared:
                        duplicates.add(value)
                    declared.add(value)
            elif _UUID_KEYS.search(key):
                for i, entry in enumerate(value if isinstance(value, list) else [value]):
                    if isinstance(entry, str):
                        _check_uuid(entry, f"{child}[{i}]", issues)
            elif key == "href" and isinstance(value, str) and value.startswith("#"):
                fragments.append((child, value[1:]))
            _walk(value, child, issues, declared, duplicates, fragments)
    elif isinstance(node, list):
        for i, entry in enumerate(node):
            _walk(entry, f"{path}[{i}]", issues, declared, duplicates, fragments)
