"""The click-through Google Drive connection.

The point of this flow is that a trust-center owner never handles a credential:
they click, approve at Google, and pick a folder. These tests cover the parts
that make that safe — the signed state, where credentials end up, and the
authorized-but-not-yet-pointed-at-anything intermediate state.

Google itself is stubbed. What is exercised here is our half of the handshake.
"""

from __future__ import annotations

import pytest

from app.drive import DriveError, sign_state, verify_state
from tests.conftest import owner_headers


@pytest.fixture()
def oauth_settings(monkeypatch):
    """Configure a network-level Google client, as an operator would."""
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("TRUSTMCP_GOOGLE_CLIENT_ID", "client-abc.apps.googleusercontent.com")
    monkeypatch.setenv("TRUSTMCP_GOOGLE_CLIENT_SECRET", "shhh")
    monkeypatch.setenv("TRUSTMCP_WEB_BASE_URL", "https://trustmcp.app")
    yield get_settings()
    get_settings.cache_clear()


@pytest.fixture()
def google(monkeypatch):
    """Stub the Google token exchange and the Drive calls the picker makes."""
    state = {"exchanges": 0}

    def fake_exchange(client_id, client_secret, code, redirect_uri, http=None):
        state["exchanges"] += 1
        state["last"] = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        }
        if code == "bad-code":
            raise DriveError("Google rejected the authorization code. (400)")
        return {"refresh_token": "refresh-xyz", "scope": "drive.readonly", "expires_in": 3599}

    monkeypatch.setattr("app.routers.drive.exchange_code", fake_exchange)

    class FakeClient:
        def get_folder(self, folder_id):
            if folder_id == "missing":
                raise DriveError("That folder was not found, or it is not shared.")
            return {"id": folder_id, "name": f"Folder {folder_id}", "mimeType": "folder"}

        def list_subfolders(self, parent="root"):
            return (
                [{"id": "f-compliance", "name": "Compliance"}, {"id": "f-legal", "name": "Legal"}]
                if parent == "root"
                else [{"id": "f-soc2", "name": "SOC 2"}]
            )

        def shared_drives(self):
            return [{"id": "sd-1", "name": "Security"}]

    monkeypatch.setattr(
        "app.routers.drive.DriveClient.for_connection",
        classmethod(lambda cls, c, http=None: FakeClient()),
    )
    return state


# --- Signed state ------------------------------------------------------------


def test_state_round_trips():
    state = sign_state("secret", "vnd_acme", 900)
    assert verify_state("secret", state) == "vnd_acme"


def test_state_rejects_tampering():
    """An unsigned state would let someone hand us a code for one trust center
    and have the credentials stored against another."""
    state = sign_state("secret", "vnd_acme", 900)
    body, mac = state.split(".", 1)
    forged = sign_state("secret", "vnd_victim", 900).split(".", 1)[0] + "." + mac
    with pytest.raises(DriveError):
        verify_state("secret", forged)
    with pytest.raises(DriveError):
        verify_state("different-secret", state)


def test_state_expires():
    assert verify_state("secret", sign_state("secret", "vnd_acme", 60)) == "vnd_acme"
    stale = sign_state("secret", "vnd_acme", -1)
    with pytest.raises(DriveError, match="expired"):
        verify_state("secret", stale)


def test_state_rejects_garbage():
    with pytest.raises(DriveError):
        verify_state("secret", "not-a-state")


# --- Availability ------------------------------------------------------------


def test_status_reports_oauth_availability(client, vendor, oauth_settings):
    vid, owner = vendor
    body = client.get(
        f"/v1/vendors/{vid}/integrations/drive", headers=owner_headers(owner)
    ).json()
    assert body["connected"] is False
    assert body["oauth_available"] is True
    assert body["redirect_uri"] == "https://trustmcp.app/api/integrations/drive/callback"


def test_one_click_is_unavailable_without_an_operator_client(client, vendor):
    """A self-hoster with no Google project still gets the paste-based path, and
    a message saying why the button is missing rather than a broken button."""
    vid, owner = vendor
    status = client.get(
        f"/v1/vendors/{vid}/integrations/drive", headers=owner_headers(owner)
    ).json()
    assert status["oauth_available"] is False

    r = client.get(
        f"/v1/vendors/{vid}/integrations/drive/oauth/start", headers=owner_headers(owner)
    )
    assert r.status_code == 501
    assert "service-account" in r.json()["detail"]


# --- Consent -----------------------------------------------------------------


def test_start_returns_a_google_consent_url(client, vendor, oauth_settings):
    vid, owner = vendor
    body = client.get(
        f"/v1/vendors/{vid}/integrations/drive/oauth/start", headers=owner_headers(owner)
    ).json()
    url = body["authorization_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client-abc.apps.googleusercontent.com" in url
    # Both are required for Google to return a refresh token at all.
    assert "access_type=offline" in url
    assert "prompt=consent" in url
    assert "drive.readonly" in url
    assert body["redirect_uri"] == "https://trustmcp.app/api/integrations/drive/callback"


def test_exchange_stores_credentials_and_waits_for_a_folder(
    client, vendor, oauth_settings, google
):
    vid, owner = vendor
    state = sign_state("test-service-token", vid, 900)
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/oauth/exchange",
        headers=owner_headers(owner),
        json={"code": "auth-code", "state": state},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending_folder"
    assert body["needs_folder"] is True
    assert body["credentials_set"] is True
    # The refresh token never travels back to the browser.
    assert "refresh_token" not in body
    assert "client_secret" not in body
    # It exchanged against the network's own client, not anything user-supplied.
    assert google["last"]["client_id"] == "client-abc.apps.googleusercontent.com"
    assert google["last"]["redirect_uri"] == "https://trustmcp.app/api/integrations/drive/callback"


def test_exchange_rejects_a_state_for_another_vendor(
    client, vendor, service_token, oauth_settings, google
):
    vid, owner = vendor
    other = client.post(
        "/v1/vendors",
        headers={"X-TrustMCP-Service-Token": service_token},
        json={"legal_name": "Globex"},
    ).json()
    # A validly-signed state, but for a different trust center.
    state = sign_state("test-service-token", other["id"], 900)
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/oauth/exchange",
        headers=owner_headers(owner),
        json={"code": "auth-code", "state": state},
    )
    assert r.status_code == 400
    assert "different trust center" in r.json()["detail"]
    assert google["exchanges"] == 0  # refused before talking to Google


def test_exchange_rejects_an_expired_state(client, vendor, oauth_settings, google):
    vid, owner = vendor
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/oauth/exchange",
        headers=owner_headers(owner),
        json={"code": "auth-code", "state": sign_state("test-service-token", vid, -1)},
    )
    assert r.status_code == 400
    assert "expired" in r.json()["detail"]


def test_exchange_surfaces_a_google_rejection(client, vendor, oauth_settings, google):
    vid, owner = vendor
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/oauth/exchange",
        headers=owner_headers(owner),
        json={"code": "bad-code", "state": sign_state("test-service-token", vid, 900)},
    )
    assert r.status_code == 400
    assert "authorization code" in r.json()["detail"]


def test_exchange_requires_the_owner_token(client, vendor, oauth_settings, google):
    vid, _ = vendor
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/oauth/exchange",
        json={"code": "auth-code", "state": sign_state("test-service-token", vid, 900)},
    )
    assert r.status_code == 401


# --- Folder picker -----------------------------------------------------------


def authorize(client, vid, owner):
    return client.post(
        f"/v1/vendors/{vid}/integrations/drive/oauth/exchange",
        headers=owner_headers(owner),
        json={"code": "auth-code", "state": sign_state("test-service-token", vid, 900)},
    )


def test_picker_lists_folders_and_shared_drives(client, vendor, oauth_settings, google):
    vid, owner = vendor
    authorize(client, vid, owner)

    body = client.get(
        f"/v1/vendors/{vid}/integrations/drive/folders", headers=owner_headers(owner)
    ).json()
    assert [f["name"] for f in body["folders"]] == ["Compliance", "Legal"]
    assert [d["name"] for d in body["shared_drives"]] == ["Security"]
    assert body["current"]["name"] == "My Drive"

    nested = client.get(
        f"/v1/vendors/{vid}/integrations/drive/folders?parent=f-compliance",
        headers=owner_headers(owner),
    ).json()
    assert [f["name"] for f in nested["folders"]] == ["SOC 2"]
    assert nested["current"]["id"] == "f-compliance"


def test_choosing_a_folder_completes_the_connection(client, vendor, oauth_settings, google):
    vid, owner = vendor
    authorize(client, vid, owner)

    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/folder",
        headers=owner_headers(owner),
        json={"folder_id": "f-compliance"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "connected"
    assert r.json()["needs_folder"] is False
    assert r.json()["folder_name"] == "Folder f-compliance"


def test_choosing_a_folder_we_cannot_read_is_refused(client, vendor, oauth_settings, google):
    vid, owner = vendor
    authorize(client, vid, owner)
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/folder",
        headers=owner_headers(owner),
        json={"folder_id": "missing"},
    )
    assert r.status_code == 400
    assert "not found" in r.json()["detail"]


def test_syncing_before_a_folder_is_chosen_is_refused(client, vendor, oauth_settings, google):
    """Authorized is not the same as configured — say so instead of failing oddly."""
    vid, owner = vendor
    authorize(client, vid, owner)
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner)
    )
    assert r.status_code == 409
    assert "Choose a folder" in r.json()["detail"]


def test_reauthorizing_keeps_the_existing_folder(client, vendor, oauth_settings, google):
    """Re-consenting to refresh an expired grant must not send the owner back
    through folder selection for a folder they already picked."""
    vid, owner = vendor
    authorize(client, vid, owner)
    client.post(
        f"/v1/vendors/{vid}/integrations/drive/folder",
        headers=owner_headers(owner),
        json={"folder_id": "f-compliance"},
    )

    again = authorize(client, vid, owner).json()
    assert again["status"] == "connected"
    assert again["needs_folder"] is False
    assert again["folder_id"] == "f-compliance"


def test_picker_requires_credentials(client, vendor, oauth_settings, google, monkeypatch):
    """Browsing is only meaningful after consent."""
    vid, owner = vendor
    # A paste-based connection with no credentials cannot exist through the API,
    # so drive the state directly: connect, then strip the token.
    authorize(client, vid, owner)
    from app.db import SessionLocal
    from app.models import DriveConnection

    with SessionLocal() as db:
        from sqlalchemy import select

        conn = db.scalar(select(DriveConnection).where(DriveConnection.vendor_id == vid))
        conn.refresh_token = None
        conn.service_account_json = None
        db.add(conn)
        db.commit()

    r = client.get(
        f"/v1/vendors/{vid}/integrations/drive/folders", headers=owner_headers(owner)
    )
    assert r.status_code == 409
