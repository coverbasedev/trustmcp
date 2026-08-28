"""Ed25519 signing for tamper-evident responses.

The network signs the exact JSON bytes of manifest/attestations responses with an
Ed25519 key. Consumers fetch the public key from `GET /v1/network/key` and verify the
`X-TrustMCP-Signature` header against the response body.

Configure a stable key in production via TRUSTMCP_SIGNING_PRIVATE_KEY (base64 of the 32-byte
Ed25519 seed). In dev, an ephemeral key is generated at startup.
"""

from __future__ import annotations

import base64
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .config import get_settings


class Signer:
    def __init__(self, private_key: Ed25519PrivateKey):
        self._key = private_key
        pub = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
        )
        self.public_key_b64 = base64.b64encode(pub).decode()
        # key id = first 16 hex chars of the public key (stable identifier)
        self.key_id = pub.hex()[:16]

    def sign(self, data: bytes) -> str:
        return base64.b64encode(self._key.sign(data)).decode()


def _load_key() -> Ed25519PrivateKey:
    settings = get_settings()
    seed = settings.signing_private_key
    if seed:
        raw = base64.b64decode(seed)
        return Ed25519PrivateKey.from_private_bytes(raw)
    return Ed25519PrivateKey.generate()


@lru_cache
def get_signer() -> Signer:
    return Signer(_load_key())


def verify(public_key_b64: str, signature_b64: str, data: bytes) -> bool:
    """Helper consumers can use (also exercised in tests)."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
    try:
        pub.verify(base64.b64decode(signature_b64), data)
        return True
    except InvalidSignature:
        return False
