"""Auto-classification for files arriving from a linked Drive folder.

A synced folder produces a stream of filenames, and somebody has to decide what
each one is: a SOC 2 report or a marketing PDF, public or key-gated, filed under
"Compliance" or "Penetration Testing". Doing that by hand for every file defeats
the point of syncing.

So rules run first and propose an answer; the owner confirms. A rule is a glob
over the file's path plus the fields to apply:

    {"match": "Compliance/SOC 2*.pdf", "type": "soc2_type2",
     "category": "Compliance", "access": "key_required", "action": "include"}

Rules are ordered and the first match wins, which makes them predictable to
reason about — a specific rule above a general one behaves the way you would
read it top to bottom. A file matching nothing falls back to the connection's
defaults and waits in the review queue.

`action` is what makes exclusion durable: `"exclude"` on a rule means files
matching it never enter the queue at all, so a folder of working drafts beside
the real evidence does not generate review noise on every sync.
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass

# Filename fragments that reliably indicate a document type. Applied only when
# no explicit rule matched — a hint, never an override of what the owner said.
TYPE_HINTS: list[tuple[str, str]] = [
    (r"soc\s*2.*type\s*(ii|2)", "soc2_type2"),
    (r"soc\s*2.*type\s*(i|1)\b", "soc2_type1"),
    (r"soc\s*3", "soc3"),
    (r"soc\s*2", "soc2_type2"),
    (r"soc\s*1", "soc1"),
    (r"iso[\s_-]*27001", "iso_27001"),
    (r"iso[\s_-]*27017", "iso_27017"),
    (r"iso[\s_-]*27018", "iso_27018"),
    (r"pen[\s_-]*test|penetration", "pentest"),
    (r"\bsbom\b|cyclonedx|spdx", "sbom"),
    (r"\bdpa\b|data.processing.(addendum|agreement)", "dpa"),
    (r"\bcoi\b|certificate.of.insurance|insurance", "insurance_coi"),
    (r"architecture|network.diagram", "architecture"),
    (r"sub[\s_-]?processor", "subprocessor_list"),
    (r"\bcaiq\b|\bsig\b|\bvsa\b|questionnaire", "questionnaire"),
    (r"\bbcp\b|\bdr\b|continuity|disaster.recovery", "policy"),
    (r"policy|standard|procedure", "policy"),
    (r"financial|audited.statements", "financials"),
]

# Document type -> the resource category it lands in on the public page.
DEFAULT_CATEGORIES = {
    "soc2_type1": "Compliance",
    "soc2_type2": "Compliance",
    "soc3": "Compliance",
    "soc1": "Compliance",
    "iso_27001": "Compliance",
    "iso_27017": "Compliance",
    "iso_27018": "Compliance",
    "pentest": "Penetration Testing",
    "sbom": "Bill of Materials",
    "dpa": "Privacy",
    "insurance_coi": "Corporate",
    "financials": "Corporate",
    "architecture": "Product Security",
    "subprocessor_list": "Privacy",
    "questionnaire": "Questionnaires",
    "policy": "Policies",
}

# Types that are almost always confidential. A rule can still say otherwise;
# this only sets the *proposed* value the owner sees before confirming.
CONFIDENTIAL_TYPES = {
    "soc1",
    "soc2_type1",
    "soc2_type2",
    "pentest",
    "financials",
    "architecture",
    "insurance_coi",
}

# Extensions that are never publishable evidence. Filtered before rules run, so
# they never reach the queue.
IGNORED_EXTENSIONS = {
    "tmp", "part", "crdownload", "ds_store", "ini", "lnk", "url", "gdoc", "gsheet", "gslides",
}

IGNORED_NAME_PATTERNS = [
    r"^~\$",          # Office lock files
    r"^\._",          # macOS resource forks
    r"^\.",           # dotfiles
]


@dataclass
class Classification:
    action: str  # include | review | exclude
    type: str
    category: str | None
    access: str
    title: str
    rule: str | None
    reason: str | None = None

    def as_dict(self) -> dict:
        return {
            "action": self.action,
            "type": self.type,
            "category": self.category,
            "access": self.access,
            "title": self.title,
            "rule": self.rule,
            "reason": self.reason,
        }


def is_ignorable(name: str) -> bool:
    """Junk that should never reach the review queue."""
    lowered = name.lower()
    if any(re.match(p, name) for p in IGNORED_NAME_PATTERNS):
        return True
    ext = lowered.rsplit(".", 1)[-1] if "." in lowered else ""
    return ext in IGNORED_EXTENSIONS


def pretty_title(name: str) -> str:
    """A human title from a filename: drop the extension, tidy separators, and
    leave real capitalization alone (so "SOC 2" does not become "Soc 2")."""
    stem = name.rsplit(".", 1)[0] if "." in name else name
    stem = re.sub(r"[_]+", " ", stem)
    stem = re.sub(r"\s{2,}", " ", stem).strip(" -")
    return stem or name


def infer_type(path: str, fallback: str) -> str:
    lowered = path.lower()
    for pattern, type_ in TYPE_HINTS:
        if re.search(pattern, lowered):
            return type_
    return fallback


def classify(
    path: str,
    name: str,
    *,
    rules: list[dict] | None = None,
    default_type: str = "policy",
    default_category: str | None = None,
    default_access: str = "key_required",
) -> Classification:
    """Decide what a file should become. Pure — no I/O, no database."""
    if is_ignorable(name):
        return Classification(
            action="exclude",
            type=default_type,
            category=None,
            access=default_access,
            title=pretty_title(name),
            rule=None,
            reason="temporary or system file",
        )

    for index, rule in enumerate(rules or []):
        pattern = rule.get("match")
        if not pattern or not _matches(pattern, path, name):
            continue
        label = rule.get("label") or f"rule {index + 1}: {pattern}"
        if rule.get("action") == "exclude":
            return Classification(
                action="exclude",
                type=rule.get("type") or default_type,
                category=rule.get("category"),
                access=rule.get("access") or default_access,
                title=rule.get("title") or pretty_title(name),
                rule=label,
                reason=rule.get("reason") or "matched an exclude rule",
            )
        type_ = rule.get("type") or infer_type(path, default_type)
        return Classification(
            action=rule.get("action") or "include",
            type=type_,
            category=rule.get("category") or DEFAULT_CATEGORIES.get(type_) or default_category,
            access=rule.get("access") or _default_access_for(type_, default_access),
            title=rule.get("title") or pretty_title(name),
            rule=label,
        )

    type_ = infer_type(path, default_type)
    return Classification(
        action="review",
        type=type_,
        category=DEFAULT_CATEGORIES.get(type_) or default_category,
        access=_default_access_for(type_, default_access),
        title=pretty_title(name),
        rule=None,
        reason="no rule matched — classified from the filename",
    )


def _default_access_for(type_: str, fallback: str) -> str:
    return "key_required" if type_ in CONFIDENTIAL_TYPES else fallback


def _matches(pattern: str, path: str, name: str) -> bool:
    """Case-insensitive glob against the path, then the bare filename.

    Matching the filename too means `*.pdf` works without the owner having to
    know whether their folder is flat or nested.
    """
    pattern = pattern.lower()
    return fnmatch.fnmatch(path.lower(), pattern) or fnmatch.fnmatch(name.lower(), pattern)


def validate_rules(rules: list[dict]) -> list[str]:
    """Return human-readable problems with a rule list (empty = fine)."""
    problems: list[str] = []
    for index, rule in enumerate(rules):
        where = f"rule {index + 1}"
        if not isinstance(rule, dict):
            problems.append(f"{where} is not an object")
            continue
        if not (rule.get("match") or "").strip():
            problems.append(f"{where} has no 'match' pattern")
        action = rule.get("action")
        if action and action not in ("include", "review", "exclude"):
            problems.append(f"{where} has an unknown action '{action}'")
        access = rule.get("access")
        if access and access not in ("public", "key_required"):
            problems.append(f"{where} has an unknown access '{access}'")
    return problems
