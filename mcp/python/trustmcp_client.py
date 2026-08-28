"""Reference client for the TrustMCP network.

Used by the MCP server and the end-to-end demo. Accepts an injected httpx.Client
so tests can drive it against an in-process ASGI app, and production can point it
at https://network.trustmcp.app.

Signed responses (manifest, attestations) are verified against the network's Ed25519
public key when the `X-TrustMCP-Signature` header is present.
"""

from __future__ import annotations

import base64
import json
import os

import httpx

DEFAULT_NETWORK = os.environ.get("TRUSTMCP_NETWORK", "https://network.trustmcp.app")


def load_keys() -> dict[str, str]:
    """Map of vendor_id -> access key, from the TRUSTMCP_KEYS env var (JSON)."""
    return json.loads(os.environ.get("TRUSTMCP_KEYS", "{}"))


def verify_signature(public_key_b64: str, signature_b64: str, body: bytes) -> bool:
    """Verify an Ed25519 signature over response bytes. Returns False if the optional
    `cryptography` dependency is unavailable."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:  # pragma: no cover
        return False
    try:
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        pub.verify(base64.b64decode(signature_b64), body)
        return True
    except Exception:
        return False


class SignatureError(Exception):
    pass


class TrustMCPClient:
    def __init__(
        self,
        network: str | None = None,
        keys: dict[str, str] | None = None,
        http: httpx.Client | None = None,
        verify_signatures: bool = True,
    ):
        self.network = (network or DEFAULT_NETWORK).rstrip("/")
        self.keys = keys if keys is not None else load_keys()
        self._http = http or httpx.Client(timeout=30)
        self._verify = verify_signatures
        self._network_key: str | None = None

    # --- helpers ---
    def _auth(self, vendor_id: str) -> dict:
        key = self.keys.get(vendor_id)
        return {"Authorization": f"Bearer {key}"} if key else {}

    def _get(self, path: str, vendor_id: str | None = None) -> dict:
        headers = self._auth(vendor_id) if vendor_id else {}
        r = self._http.get(f"{self.network}{path}", headers=headers)
        r.raise_for_status()
        return r.json()

    def _get_verified(self, path: str, vendor_id: str) -> dict:
        """GET a signed endpoint and verify the X-TrustMCP-Signature over the raw bytes."""
        r = self._http.get(f"{self.network}{path}", headers=self._auth(vendor_id))
        r.raise_for_status()
        sig = r.headers.get("X-TrustMCP-Signature")
        if self._verify and sig:
            key = self.get_network_key().get("public_key", "")
            if not key or not verify_signature(key, sig, r.content):
                raise SignatureError(f"signature verification failed for {path}")
        return r.json()

    # --- the operations ---
    def discover_vendor(self, domain: str) -> dict:
        r = self._http.get(f"https://{domain}/.well-known/trustmcp.json")
        r.raise_for_status()
        return r.json()

    def request_access(
        self, vendor_id: str, requester: dict, scope: list[str], nda_accepted: bool = False
    ) -> dict:
        r = self._http.post(
            f"{self.network}/v1/keys/request",
            json={
                "vendor_id": vendor_id,
                "requester": requester,
                "scope": scope,
                "nda_accepted": nda_accepted,
            },
        )
        r.raise_for_status()
        return r.json()

    def get_manifest(self, vendor_id: str) -> dict:
        return self._get_verified(f"/v1/vendors/{vendor_id}/manifest", vendor_id)

    def get_attestations(self, vendor_id: str, keys: list[str] | None = None) -> dict:
        data = self._get_verified(f"/v1/vendors/{vendor_id}/attestations", vendor_id)
        if keys:
            data["claims"] = [c for c in data.get("claims", []) if c["key"] in keys]
        return data

    def fetch_artifact(self, vendor_id: str, artifact_id: str) -> dict:
        return self._get(f"/v1/vendors/{vendor_id}/artifacts/{artifact_id}", vendor_id)

    def get_artifact_versions(self, vendor_id: str, artifact_id: str) -> dict:
        return self._get(f"/v1/vendors/{vendor_id}/artifacts/{artifact_id}/versions", vendor_id)

    def fetch_artifact_version(self, vendor_id: str, artifact_id: str, version: int) -> dict:
        return self._get(
            f"/v1/vendors/{vendor_id}/artifacts/{artifact_id}/versions/{version}", vendor_id
        )

    def check_freshness(self, vendor_id: str) -> dict:
        return self._get(f"/v1/vendors/{vendor_id}/freshness", vendor_id)

    def get_mark(self, vendor_id: str) -> dict:
        return self._get(f"/v1/mark/{vendor_id}")

    def get_subprocessors(self, vendor_id: str) -> dict:
        return self._get(f"/v1/vendors/{vendor_id}/subprocessors", vendor_id)

    def get_subprocessor_graph(self, vendor_id: str) -> dict:
        return self._get(f"/v1/vendors/{vendor_id}/graph", vendor_id)

    def get_frameworks(self) -> dict:
        return self._get("/v1/frameworks")

    def get_mapped_attestations(self, vendor_id: str, framework: str) -> dict:
        return self._get(
            f"/v1/vendors/{vendor_id}/attestations/mapped?framework={framework}", vendor_id
        )

    def get_oscal(self, vendor_id: str, framework: str = "soc2") -> dict:
        """The original single-model export. Kept for existing callers; new code
        should use `get_oscal_model` for any of the seven OSCAL models."""
        return self._get(
            f"/v1/vendors/{vendor_id}/attestations/oscal?framework={framework}", vendor_id
        )

    # --- OSCAL: point-in-time ---
    def get_oscal_capabilities(self) -> dict:
        return self._get("/v1/oscal/capabilities")

    def get_oscal_catalog(self) -> dict:
        return self._get("/v1/oscal/catalog")

    def get_oscal_profile(self, framework: str) -> dict:
        return self._get(f"/v1/oscal/profile/{framework}")

    def get_oscal_model(
        self,
        vendor_id: str,
        model: str,
        *,
        fmt: str = "json",
        frameworks: list[str] | None = None,
    ) -> dict | str:
        """One OSCAL model. Returns the parsed document for JSON, and the raw
        text for YAML/XML — those formats are for handing to another tool, and
        re-parsing them here would only lose fidelity."""
        query = [f"format={fmt}"]
        if frameworks:
            query.append("framework=" + ",".join(frameworks))
        path = f"/v1/vendors/{vendor_id}/oscal/{model}?" + "&".join(query)
        r = self._http.get(f"{self.network}{path}", headers=self._auth(vendor_id))
        r.raise_for_status()
        if fmt == "json":
            return r.json()
        return r.text

    def get_oscal_bundle(
        self, vendor_id: str, frameworks: list[str] | None = None
    ) -> dict:
        """Every vendor model plus per-document digests and the change cursor."""
        query = "?framework=" + ",".join(frameworks) if frameworks else ""
        return self._get(f"/v1/vendors/{vendor_id}/oscal/bundle{query}", vendor_id)

    def validate_oscal(self, document: dict) -> dict:
        r = self._http.post(f"{self.network}/v1/oscal/validate", json=document)
        r.raise_for_status()
        return r.json()

    # --- OSCAL: continuous ---
    def get_oscal_changes(
        self,
        vendor_id: str,
        since: int = 0,
        *,
        limit: int = 100,
        models: list[str] | None = None,
    ) -> dict:
        query = f"?since={since}&limit={limit}"
        if models:
            query += "&models=" + ",".join(models)
        return self._get(f"/v1/vendors/{vendor_id}/oscal/changes{query}", vendor_id)

    def subscribe_oscal(
        self,
        vendor_id: str,
        url: str,
        *,
        secret: str | None = None,
        models: list[str] | None = None,
    ) -> dict:
        r = self._http.post(
            f"{self.network}/v1/vendors/{vendor_id}/oscal/subscriptions",
            headers=self._auth(vendor_id),
            json={"url": url, "secret": secret, "models": models or []},
        )
        r.raise_for_status()
        return r.json()

    def list_oscal_subscriptions(self, vendor_id: str) -> dict:
        return self._get(f"/v1/vendors/{vendor_id}/oscal/subscriptions", vendor_id)

    def unsubscribe_oscal(self, vendor_id: str, subscription_id: str) -> bool:
        r = self._http.delete(
            f"{self.network}/v1/vendors/{vendor_id}/oscal/subscriptions/{subscription_id}",
            headers=self._auth(vendor_id),
        )
        r.raise_for_status()
        return True

    def stream_oscal_changes(self, vendor_id: str, since: int = 0):
        """Yield change events from the SSE stream as they arrive.

        A generator rather than a callback so a caller can stop simply by
        breaking out of the loop.
        """
        import json as _json

        url = f"{self.network}/v1/vendors/{vendor_id}/oscal/stream?since={since}"
        with self._http.stream("GET", url, headers=self._auth(vendor_id), timeout=None) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if line.startswith("data: "):
                    yield _json.loads(line[6:])

    def get_network_key(self) -> dict:
        if self._network_key is None:
            data = self._get("/v1/network/key")
            self._network_key = data.get("public_key", "")
            return data
        return {"public_key": self._network_key, "alg": "Ed25519"}
