from __future__ import annotations

from functools import lru_cache

from .config import get_settings
from .storage import Storage


@lru_cache
def get_storage() -> Storage:
    return Storage(get_settings())
