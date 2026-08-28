from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from pathlib import Path

from .config import Settings


class Storage:
    """Artifact blob storage. Uses S3 when configured, otherwise the local
    filesystem with network-signed redirect URLs (good for dev / self-hosting)."""

    def __init__(self, settings: Settings):
        self.s = settings
        if settings.use_s3:
            import boto3

            self._s3 = boto3.client(
                "s3",
                region_name=settings.s3_region,
                endpoint_url=settings.s3_endpoint_url or None,
                aws_access_key_id=settings.s3_access_key_id or None,
                aws_secret_access_key=settings.s3_secret_access_key or None,
            )
        else:
            self._s3 = None
            Path(settings.storage_local_dir).mkdir(parents=True, exist_ok=True)

    # --- write ---
    def put(self, storage_key: str, data: bytes, content_type: str | None) -> str:
        """Stores bytes and returns the sha256 hex digest."""
        digest = hashlib.sha256(data).hexdigest()
        if self._s3 is not None:
            self._s3.put_object(
                Bucket=self.s.s3_bucket,
                Key=storage_key,
                Body=data,
                ContentType=content_type or "application/octet-stream",
            )
        else:
            path = self._local_path(storage_key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return digest

    # --- read ---
    def presign_get(self, storage_key: str, filename: str | None = None) -> str:
        if self._s3 is not None:
            params = {"Bucket": self.s.s3_bucket, "Key": storage_key}
            if filename:
                params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
            return self._s3.generate_presigned_url(
                "get_object", Params=params, ExpiresIn=self.s.signed_url_ttl_seconds
            )
        token = self._sign_local(storage_key)
        return f"{self.s.public_base_url}/v1/files?token={token}"

    def read_local(self, storage_key: str) -> bytes:
        return self._local_path(storage_key).read_bytes()

    def get(self, storage_key: str) -> bytes:
        """Read object bytes from S3 or local storage."""
        if self._s3 is not None:
            obj = self._s3.get_object(Bucket=self.s.s3_bucket, Key=storage_key)
            return obj["Body"].read()
        return self.read_local(storage_key)

    def _local_path(self, storage_key: str) -> Path:
        # Prevent path traversal: keys are app-generated, but be safe.
        safe = storage_key.replace("..", "_").lstrip("/")
        return Path(self.s.storage_local_dir) / safe

    # --- local signed URLs ---
    def _sign_local(self, storage_key: str) -> str:
        exp = int(time.time()) + self.s.signed_url_ttl_seconds
        payload = json.dumps({"k": storage_key, "exp": exp}, separators=(",", ":")).encode()
        body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
        sig = self._hmac(body)
        return f"{body}.{sig}"

    def verify_local(self, token: str) -> str:
        try:
            body, sig = token.split(".", 1)
        except ValueError as e:
            raise ValueError("malformed token") from e
        if not hmac.compare_digest(sig, self._hmac(body)):
            raise ValueError("bad signature")
        padded = body + "=" * (-len(body) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        if int(data["exp"]) < int(time.time()):
            raise ValueError("expired")
        return data["k"]

    def _hmac(self, body: str) -> str:
        return hmac.new(
            self.s.service_token.encode(), body.encode(), hashlib.sha256
        ).hexdigest()[:32]
