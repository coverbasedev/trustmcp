"""Google Drive API client.

Small and deliberate: list a folder, read a file's metadata, download its bytes.
No Google client library — the three calls we need are plain HTTPS, and avoiding
the dependency keeps the deployment surface (and the OAuth scope story) small.

Two credential shapes are supported, because trust-center owners split cleanly
between them:

  oauth            The owner authorized their own Drive. We hold a refresh token
                   and exchange it for short-lived access tokens. Best when the
                   documents live in someone's My Drive.
  service_account  The owner shared a folder with a service account. We sign a
                   JWT and exchange it. Best for a shared drive that should not
                   depend on one employee's account surviving.

Both are read-only: the scope requested is `drive.readonly`. TrustMCP pulls
documents out of Drive and never writes back.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger("trustmcp.drive")

TOKEN_URL = "https://oauth2.googleapis.com/token"
FILES_URL = "https://www.googleapis.com/drive/v3/files"
READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"

# Google-native formats have no downloadable bytes; they must be exported. The
# choices here are what a trust center actually wants to publish.
EXPORT_FORMATS = {
    "application/vnd.google-apps.document": ("application/pdf", "pdf"),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
    ),
    "application/vnd.google-apps.presentation": ("application/pdf", "pdf"),
    "application/vnd.google-apps.drawing": ("application/pdf", "pdf"),
}

FOLDER_MIME = "application/vnd.google-apps.folder"

# Fields worth asking for. Requesting everything makes listing slower and the
# responses much larger for no gain.
FILE_FIELDS = (
    "id,name,mimeType,md5Checksum,modifiedTime,size,webViewLink,trashed,parents"
)


class DriveError(Exception):
    """A Drive call failed in a way the owner needs to see.

    Carries the message through to the API response so a trust-center owner gets
    "the folder was not found or is not shared with this account" rather than a
    bare 500.
    """


@dataclass
class DriveFileInfo:
    id: str
    name: str
    mime_type: str
    md5: str | None
    modified_time: str | None
    size: int | None
    web_view_link: str | None
    path: str

    @property
    def is_folder(self) -> bool:
        return self.mime_type == FOLDER_MIME

    @property
    def is_google_native(self) -> bool:
        return self.mime_type.startswith("application/vnd.google-apps.")

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "mime_type": self.mime_type,
            "md5": self.md5,
            "modified_time": self.modified_time,
            "size": self.size,
            "web_view_link": self.web_view_link,
            "path": self.path,
        }


class DriveClient:
    """Read-only Drive access for one connection's credentials."""

    def __init__(
        self,
        *,
        auth_type: str = "oauth",
        client_id: str | None = None,
        client_secret: str | None = None,
        refresh_token: str | None = None,
        service_account_json: str | None = None,
        http: httpx.Client | None = None,
    ):
        self.auth_type = auth_type
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.service_account_json = service_account_json
        self._http = http or httpx.Client(timeout=60)
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    @classmethod
    def for_connection(cls, connection, http: httpx.Client | None = None) -> DriveClient:
        return cls(
            auth_type=connection.auth_type,
            client_id=connection.client_id,
            client_secret=connection.client_secret,
            refresh_token=connection.refresh_token,
            service_account_json=connection.service_account_json,
            http=http,
        )

    # --- auth ---
    def access_token(self) -> str:
        """A valid access token, refreshed with 60s of headroom."""
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token
        if self.auth_type == "service_account":
            token, ttl = self._service_account_token()
        else:
            token, ttl = self._refresh_token_grant()
        self._token = token
        self._token_expires_at = time.time() + ttl
        return token

    def _refresh_token_grant(self) -> tuple[str, int]:
        if not (self.client_id and self.client_secret and self.refresh_token):
            raise DriveError(
                "This connection is missing OAuth credentials. Reconnect the Drive folder."
            )
        r = self._http.post(
            TOKEN_URL,
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token,
                "grant_type": "refresh_token",
            },
        )
        if r.status_code >= 400:
            raise DriveError(
                "Google rejected the stored authorization. Reconnect the Drive folder. "
                f"({_error_detail(r)})"
            )
        body = r.json()
        return body["access_token"], int(body.get("expires_in", 3600))

    def _service_account_token(self) -> tuple[str, int]:
        if not self.service_account_json:
            raise DriveError("This connection has no service-account key.")
        try:
            key = json.loads(self.service_account_json)
        except json.JSONDecodeError as e:
            raise DriveError("The service-account key is not valid JSON.") from e
        try:
            import jwt  # PyJWT, already a dependency for Docusign
        except ImportError as e:  # pragma: no cover
            raise DriveError("PyJWT is required for service-account authentication.") from e

        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": key.get("client_email"),
                "scope": READONLY_SCOPE,
                "aud": TOKEN_URL,
                "iat": now,
                "exp": now + 3600,
            },
            key.get("private_key"),
            algorithm="RS256",
        )
        r = self._http.post(
            TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
        if r.status_code >= 400:
            raise DriveError(
                f"Google rejected the service-account key. ({_error_detail(r)})"
            )
        body = r.json()
        return body["access_token"], int(body.get("expires_in", 3600))

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.access_token()}"}

    # --- reads ---
    def get_folder(self, folder_id: str) -> dict:
        r = self._http.get(
            f"{FILES_URL}/{folder_id}",
            headers=self._headers(),
            params={"fields": "id,name,mimeType", "supportsAllDrives": "true"},
        )
        if r.status_code == 404:
            raise DriveError(
                "That folder was not found, or it is not shared with the connected account."
            )
        if r.status_code >= 400:
            raise DriveError(f"Could not read the folder. ({_error_detail(r)})")
        body = r.json()
        if body.get("mimeType") != FOLDER_MIME:
            raise DriveError("That Drive item is a file, not a folder.")
        return body

    def list_folder(
        self, folder_id: str, *, recursive: bool = True, path: str = "", _depth: int = 0
    ) -> list[DriveFileInfo]:
        """Every non-trashed file under a folder.

        Recursion is bounded: a folder tree deep enough to hit the limit is
        almost certainly a loop (Drive shortcuts can make one) and silently
        walking it forever would hang the sync.
        """
        if _depth > 10:
            log.warning("[drive:depth-limit] folder=%s path=%s", folder_id, path)
            return []

        files: list[DriveFileInfo] = []
        page_token: str | None = None
        while True:
            params = {
                "q": f"'{folder_id}' in parents and trashed = false",
                "fields": f"nextPageToken,files({FILE_FIELDS})",
                "pageSize": "200",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            }
            if page_token:
                params["pageToken"] = page_token
            r = self._http.get(FILES_URL, headers=self._headers(), params=params)
            if r.status_code >= 400:
                raise DriveError(f"Could not list the folder. ({_error_detail(r)})")
            body = r.json()
            for entry in body.get("files", []):
                info = DriveFileInfo(
                    id=entry["id"],
                    name=entry.get("name", "untitled"),
                    mime_type=entry.get("mimeType", ""),
                    md5=entry.get("md5Checksum"),
                    modified_time=entry.get("modifiedTime"),
                    size=int(entry["size"]) if entry.get("size") else None,
                    web_view_link=entry.get("webViewLink"),
                    path=f"{path}/{entry.get('name', '')}".lstrip("/"),
                )
                if info.is_folder:
                    if recursive:
                        files.extend(
                            self.list_folder(
                                info.id,
                                recursive=True,
                                path=info.path,
                                _depth=_depth + 1,
                            )
                        )
                    continue
                files.append(info)
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        return files

    def list_subfolders(self, parent_id: str = "root") -> list[dict]:
        """Folders directly inside `parent_id`, for the picker.

        Only folders — the picker chooses where to sync from, and listing every
        file would bury that choice in noise.
        """
        folders: list[dict] = []
        page_token: str | None = None
        while True:
            params = {
                "q": (
                    f"'{parent_id}' in parents and mimeType = '{FOLDER_MIME}' "
                    "and trashed = false"
                ),
                "fields": "nextPageToken,files(id,name,parents)",
                "pageSize": "200",
                "orderBy": "name",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            }
            if page_token:
                params["pageToken"] = page_token
            r = self._http.get(FILES_URL, headers=self._headers(), params=params)
            if r.status_code >= 400:
                raise DriveError(f"Could not list folders. ({_error_detail(r)})")
            body = r.json()
            folders.extend(
                {"id": f["id"], "name": f.get("name", "untitled")} for f in body.get("files", [])
            )
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        return folders

    def count_files(self, folder_id: str, *, recursive: bool = True) -> int:
        """How many publishable files a folder holds — shown in the picker so the
        owner can tell an empty folder from the right one before committing."""
        try:
            return len(self.list_folder(folder_id, recursive=recursive))
        except DriveError:
            return 0

    def shared_drives(self) -> list[dict]:
        """Shared drives the account can see, listed alongside My Drive."""
        r = self._http.get(
            "https://www.googleapis.com/drive/v3/drives",
            headers=self._headers(),
            params={"pageSize": "100", "fields": "drives(id,name)"},
        )
        if r.status_code >= 400:
            # A personal account with no shared drives 403s here. That is a normal
            # state, not a failure worth blocking the picker over.
            return []
        return [
            {"id": d["id"], "name": d.get("name", "Shared drive")}
            for d in r.json().get("drives", [])
        ]

    def download(self, file: DriveFileInfo) -> tuple[bytes, str, str]:
        """Return `(bytes, content_type, suggested_extension)`.

        Google-native documents are exported (Docs to PDF, Sheets to XLSX);
        everything else downloads as stored.
        """
        if file.is_google_native:
            target = EXPORT_FORMATS.get(file.mime_type)
            if target is None:
                raise DriveError(
                    f"'{file.name}' is a Google {file.mime_type.rsplit('.', 1)[-1]} and cannot "
                    "be exported to a publishable format."
                )
            mime, ext = target
            r = self._http.get(
                f"{FILES_URL}/{file.id}/export",
                headers=self._headers(),
                params={"mimeType": mime},
            )
            if r.status_code >= 400:
                raise DriveError(f"Could not export '{file.name}'. ({_error_detail(r)})")
            return r.content, mime, ext

        r = self._http.get(
            f"{FILES_URL}/{file.id}",
            headers=self._headers(),
            params={"alt": "media", "supportsAllDrives": "true"},
        )
        if r.status_code >= 400:
            raise DriveError(f"Could not download '{file.name}'. ({_error_detail(r)})")
        ext = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else "bin"
        return r.content, file.mime_type or "application/octet-stream", ext


def _error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        error = body.get("error")
        if isinstance(error, dict):
            return f"{response.status_code}: {error.get('message', '')}".strip()
        if isinstance(error, str):
            return f"{response.status_code}: {body.get('error_description', error)}"
    except Exception:
        pass
    return str(response.status_code)


def sign_state(secret: str, vendor_id: str, ttl_seconds: int) -> str:
    """A tamper-proof `state` for the consent round-trip.

    The state carries the vendor the flow belongs to, so the callback knows which
    trust center to attach the credentials to. Signing it matters: an unsigned
    state is an open invitation to hand us a code for one vendor and have it
    stored against another. The expiry bounds replay of a captured URL.
    """
    payload = json.dumps(
        {"v": vendor_id, "exp": int(time.time()) + ttl_seconds},
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    return f"{body}.{_state_mac(secret, body)}"


def verify_state(secret: str, state: str) -> str:
    """Return the vendor id carried by a valid state, or raise DriveError."""
    try:
        body, mac = state.split(".", 1)
    except ValueError as e:
        raise DriveError("The sign-in response was malformed. Start the connection again.") from e
    if not hmac.compare_digest(mac, _state_mac(secret, body)):
        raise DriveError(
            "The sign-in response could not be verified. Start the connection again."
        )
    padded = body + "=" * (-len(body) % 4)
    data = json.loads(base64.urlsafe_b64decode(padded))
    if int(data.get("exp", 0)) < int(time.time()):
        raise DriveError("The sign-in request expired. Start the connection again.")
    return str(data["v"])


def _state_mac(secret: str, body: str) -> str:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]


def authorization_url(client_id: str, redirect_uri: str, state: str) -> str:
    """The consent URL for the OAuth flow.

    `access_type=offline` plus `prompt=consent` is what actually produces a
    refresh token; without both, a re-authorization returns only an access token
    and the sync stops working an hour later.
    """
    from urllib.parse import urlencode

    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": READONLY_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
    )


def exchange_code(
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
    http: httpx.Client | None = None,
) -> dict:
    """Trade an authorization code for tokens."""
    client = http or httpx.Client(timeout=30)
    r = client.post(
        TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    if r.status_code >= 400:
        raise DriveError(f"Google rejected the authorization code. ({_error_detail(r)})")
    body = r.json()
    if not body.get("refresh_token"):
        raise DriveError(
            "Google returned no refresh token. Revoke TrustMCP's access in your Google "
            "account and reconnect, so the consent screen is shown again."
        )
    return body


def _b64(data: bytes) -> str:  # pragma: no cover - used by callers building state
    return base64.urlsafe_b64encode(data).decode().rstrip("=")
