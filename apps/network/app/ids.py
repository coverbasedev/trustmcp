from __future__ import annotations

import re
import secrets

_slug_re = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    s = _slug_re.sub("_", value.strip().lower()).strip("_")
    return s or "x"


def new_id(prefix: str, n: int = 8) -> str:
    return f"{prefix}_{secrets.token_hex(n // 2 + 1)[:n]}"


def vendor_id_from_name(legal_name: str) -> str:
    return f"vnd_{slugify(legal_name)[:24]}_{secrets.token_hex(2)}"


def artifact_id(type_: str) -> str:
    return f"art_{slugify(type_)[:20]}_{secrets.token_hex(2)}"


def request_id() -> str:
    return new_id("req", 8)


def key_id() -> str:
    return new_id("key", 8)


def agreement_id() -> str:
    return new_id("agr", 8)
