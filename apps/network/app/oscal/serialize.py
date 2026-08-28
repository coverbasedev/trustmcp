"""Serializing OSCAL documents to JSON, YAML, and XML.

OSCAL defines three interchangeable formats. JSON is the native shape we build,
YAML is a direct restatement of it, and XML needs real work: OSCAL's XML binding
differs structurally from the JSON one — `metadata` is an element, `uuid` is an
attribute, and JSON arrays become repeated sibling elements rather than a
wrapper element.

The converter below encodes those rules for the vocabulary this exporter emits
rather than trying to be a universal OSCAL JSON→XML bridge. It is driven by two
tables: which keys are XML attributes, and which JSON object keys hold prose
that becomes element text. Everything else follows the general rule (object →
element, array → repeated elements, scalar → element text). A key the tables do
not cover still converts correctly under the general rule; the tables only exist
for the cases where OSCAL's XML binding departs from it.
"""

from __future__ import annotations

import json
from xml.etree import ElementTree as ET

OSCAL_XML_NS = "http://csrc.nist.gov/ns/oscal/1.0"

# JSON keys that OSCAL's XML binding renders as attributes on the parent element.
ATTRIBUTE_KEYS = {
    "uuid",
    "id",
    "name",
    "ns",
    "class",
    "value",
    "href",
    "rel",
    "media-type",
    "algorithm",
    "control-id",
    "statement-id",
    "component-uuid",
    "observation-uuid",
    "risk-uuid",
    "role-id",
    "param-id",
    "position",
    "identifier-type",
    "target-id",
    "type",
    "state",
    "reason",
    "actor-uuid",
    "system-id",
}

# Keys whose XML element carries the value as text rather than as a child
# element — OSCAL's "markup-line" and "markup-multiline" fields.
TEXT_KEYS = {"prose", "text", "remarks", "description", "statement", "purpose", "title"}

# JSON keys that are *not* attributes even though they appear in ATTRIBUTE_KEYS,
# because at these paths OSCAL models them as elements. Keyed by parent key.
ELEMENT_OVERRIDES = {
    ("part", "prose"),
    ("prop", "remarks"),
}

# Singular element names for JSON arrays whose key is plural. OSCAL's XML uses
# the singular for each repeated element.
SINGULAR = {
    "components": "component",
    "capabilities": "capability",
    "parties": "party",
    "roles": "role",
    "props": "prop",
    "links": "link",
    "resources": "resource",
    "rlinks": "rlink",
    "hashes": "hash",
    "groups": "group",
    "controls": "control",
    "parts": "part",
    "imports": "import",
    "alters": "alter",
    "adds": "add",
    "observations": "observation",
    "findings": "finding",
    "risks": "risk",
    "results": "result",
    "tasks": "task",
    "users": "user",
    "statements": "statement",
    "by-components": "by-component",
    "poam-items": "poam-item",
    "information-types": "information-type",
    "system-ids": "system-id",
    "assessment-platforms": "assessment-platform",
    "assessment-subjects": "assessment-subject",
    "control-selections": "control-selection",
    "include-controls": "include-control",
    "with-ids": "with-id",
    "implemented-requirements": "implemented-requirement",
    "control-implementations": "control-implementation",
    "set-parameters": "set-parameter",
    "values": "value",
    "responsible-roles": "responsible-role",
    "responsible-parties": "responsible-party",
    "party-uuids": "party-uuid",
    "role-ids": "role-id",
    "authorized-privileges": "authorized-privilege",
    "functions-performed": "function-performed",
    "related-observations": "related-observation",
    "related-risks": "related-risk",
    "relevant-evidence": "relevant-evidence",
    "incorporates-components": "incorporates-component",
    "origins": "origin",
    "actors": "actor",
    "methods": "method",
    "types": "type",
    "assessment-methods": "assessment-method",
}


def to_json(document: dict, *, indent: int | None = 2) -> str:
    return json.dumps(document, indent=indent, sort_keys=False, default=str)


def to_yaml(document: dict) -> str:
    """YAML rendering. Uses PyYAML when available and falls back to a minimal
    emitter otherwise, so YAML output never depends on an optional install."""
    try:
        import yaml  # type: ignore
    except ImportError:
        return _yaml_fallback(document, 0)
    return yaml.safe_dump(
        json.loads(json.dumps(document, default=str)), sort_keys=False, allow_unicode=True
    )


def to_xml(document: dict) -> str:
    """OSCAL XML for the single root model in `document`."""
    if len(document) != 1:
        raise ValueError("an OSCAL document has exactly one root model")
    root_name, body = next(iter(document.items()))
    root = ET.Element(root_name, xmlns=OSCAL_XML_NS)
    _populate(root, body, root_name)
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(
        root, encoding="unicode"
    )


def _populate(element: ET.Element, value: dict, parent_key: str) -> None:
    for key, item in value.items():
        if item is None:
            continue
        if _is_attribute(parent_key, key, item):
            element.set(key, _scalar(item))
            continue
        if isinstance(item, list):
            child_name = SINGULAR.get(key, key)
            for entry in item:
                child = ET.SubElement(element, child_name)
                _assign(child, entry, child_name)
            continue
        child = ET.SubElement(element, key)
        _assign(child, item, key)


def _assign(element: ET.Element, value: object, key: str) -> None:
    if isinstance(value, dict):
        _populate(element, value, key)
    elif isinstance(value, list):
        # A nested list (rare: e.g. values inside set-parameter) repeats here.
        child_name = SINGULAR.get(key, key)
        for entry in value:
            child = ET.SubElement(element, child_name)
            _assign(child, entry, child_name)
    else:
        element.text = _scalar(value)


def _is_attribute(parent_key: str, key: str, value: object) -> bool:
    if isinstance(value, (dict, list)):
        return False
    if (parent_key, key) in ELEMENT_OVERRIDES:
        return False
    if key in TEXT_KEYS:
        return False
    return key in ATTRIBUTE_KEYS


def _scalar(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _yaml_fallback(value: object, depth: int) -> str:
    """A small YAML emitter for the JSON subset OSCAL documents use."""
    pad = "  " * depth
    if isinstance(value, dict):
        if not value:
            return "{}\n"
        out = []
        for k, v in value.items():
            rendered = _yaml_fallback(v, depth + 1)
            if isinstance(v, (dict, list)) and v:
                out.append(f"{pad}{k}:\n{rendered}")
            else:
                out.append(f"{pad}{k}: {rendered.strip()}\n")
        return "".join(out)
    if isinstance(value, list):
        if not value:
            return "[]\n"
        out = []
        for entry in value:
            if isinstance(entry, (dict, list)) and entry:
                # Children render at depth+1, whose indent is exactly the width
                # of the "- " marker — so swapping the first line's indent for
                # the marker lines the block up under the item.
                block = _yaml_fallback(entry, depth + 1)
                first, _, rest = block.partition("\n")
                out.append(f"{pad}- {first.strip()}\n")
                if rest:
                    out.append(rest if rest.endswith("\n") or not rest else rest + "\n")
            else:
                out.append(f"{pad}- {_yaml_fallback(entry, 0).strip()}\n")
        return "".join(out)
    if value is None:
        return "null\n"
    if isinstance(value, bool):
        return ("true" if value else "false") + "\n"
    if isinstance(value, (int, float)):
        return f"{value}\n"
    text = str(value)
    if any(ch in text for ch in ":#\n\"'") or text.strip() != text or text == "":
        escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"\n'
    return f"{text}\n"


MEDIA_TYPES = {
    "json": "application/json",
    "yaml": "application/yaml",
    "xml": "application/xml",
}


def render(document: dict, fmt: str = "json") -> tuple[str, str]:
    """Return `(body, media_type)` for the requested format."""
    fmt = (fmt or "json").lower()
    if fmt == "json":
        return to_json(document), MEDIA_TYPES["json"]
    if fmt in ("yaml", "yml"):
        return to_yaml(document), MEDIA_TYPES["yaml"]
    if fmt == "xml":
        return to_xml(document), MEDIA_TYPES["xml"]
    raise ValueError(f"unsupported OSCAL format: {fmt}")
