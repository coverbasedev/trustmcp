"""Google Drive folder sync: classification, the review queue, and publishing.

Drive itself is stubbed. What matters is the behavior around it — that nothing
publishes without a decision, that a rejected file stays rejected, and that a
new revision becomes a new version rather than a duplicate artifact.
"""

from __future__ import annotations

import pytest

from app.drive import DriveError, DriveFileInfo
from app.drive_rules import classify, pretty_title, validate_rules


class FakeDriveClient:
    """A Drive folder held in memory. `set_files` replaces the folder contents."""

    def __init__(self, files: list[DriveFileInfo] | None = None, folder_name: str = "Trust Docs"):
        self.files = files or []
        self.folder_name = folder_name
        self.downloads: list[str] = []
        self.fail_on: set[str] = set()

    def get_folder(self, folder_id: str) -> dict:
        return {
            "id": folder_id,
            "name": self.folder_name,
            "mimeType": "application/vnd.google-apps.folder",
        }

    def list_folder(self, folder_id: str, *, recursive: bool = True, **kwargs):
        return list(self.files)

    def download(self, file: DriveFileInfo):
        if file.name in self.fail_on:
            raise DriveError(f"Could not download '{file.name}'.")
        self.downloads.append(file.id)
        return f"content of {file.name}".encode(), "application/pdf", "pdf"

    def set_files(self, files: list[DriveFileInfo]) -> None:
        self.files = files


def drive_file(name: str, *, path: str | None = None, md5: str = "m1", file_id: str | None = None):
    return DriveFileInfo(
        id=file_id or f"gdrive-{name}",
        name=name,
        mime_type="application/pdf",
        md5=md5,
        modified_time="2026-06-01T00:00:00Z",
        size=1024,
        web_view_link=f"https://drive.google.com/file/d/{name}",
        path=path or name,
    )


@pytest.fixture()
def drive(monkeypatch):
    """Point every DriveClient construction at one fake folder."""
    fake = FakeDriveClient()
    monkeypatch.setattr(
        "app.drive.DriveClient.for_connection", classmethod(lambda cls, c, http=None: fake)
    )
    monkeypatch.setattr(
        "app.routers.drive.DriveClient.for_connection", classmethod(lambda cls, c, http=None: fake)
    )
    monkeypatch.setattr(
        "app.drive_sync.DriveClient.for_connection", classmethod(lambda cls, c, http=None: fake)
    )
    return fake


def connect(client, vid: str, owner: str, **overrides):
    from tests.conftest import owner_headers

    body = {
        "folder_id": "folder-123",
        "auth_type": "service_account",
        "service_account_json": '{"client_email": "a@b.iam", "private_key": "x"}',
    }
    body.update(overrides)
    return client.post(
        f"/v1/vendors/{vid}/integrations/drive", headers=owner_headers(owner), json=body
    )


# --- Classification (pure) ---------------------------------------------------


def test_classification_reads_the_filename():
    result = classify("Compliance/Acme SOC 2 Type II 2026.pdf", "Acme SOC 2 Type II 2026.pdf")
    assert result.type == "soc2_type2"
    assert result.category == "Compliance"
    assert result.access == "key_required"
    assert result.action == "review"  # no rule matched, so a person decides


def test_confidential_types_default_to_key_required():
    """Even when the connection's default is public, a pen test is not."""
    result = classify("pentest-2026.pdf", "pentest-2026.pdf", default_access="public")
    assert result.type == "pentest"
    assert result.access == "key_required"


def test_a_matching_rule_wins_over_the_filename_heuristic():
    rules = [{"match": "Public/*", "type": "policy", "category": "Policies", "access": "public"}]
    result = classify("Public/SOC 2 overview.pdf", "SOC 2 overview.pdf", rules=rules)
    assert result.action == "include"
    assert result.access == "public"
    assert result.category == "Policies"


def test_first_matching_rule_wins():
    rules = [
        {"match": "*Draft*", "action": "exclude", "label": "drafts"},
        {"match": "*.pdf", "action": "include", "label": "everything else"},
    ]
    assert classify("Draft SOC 2.pdf", "Draft SOC 2.pdf", rules=rules).rule == "drafts"
    assert classify("SOC 2.pdf", "SOC 2.pdf", rules=rules).rule == "everything else"


def test_junk_files_never_reach_the_queue():
    for name in ("~$report.docx", ".DS_Store", "report.pdf.crdownload"):
        assert classify(name, name).action == "exclude"


def test_titles_preserve_real_capitalization():
    assert pretty_title("Acme_SOC 2_Type II.pdf") == "Acme SOC 2 Type II"


def test_rule_validation_reports_problems():
    problems = validate_rules([{"action": "publish"}, {"match": "*", "access": "sorta"}])
    assert len(problems) == 3  # missing match, unknown action, unknown access


# --- Connection --------------------------------------------------------------


def test_connect_and_read_back(client, vendor, drive):
    vid, owner = vendor
    r = connect(client, vid, owner)
    assert r.status_code == 201, r.text
    assert r.json()["folder_name"] == "Trust Docs"

    from tests.conftest import owner_headers

    status = client.get(
        f"/v1/vendors/{vid}/integrations/drive", headers=owner_headers(owner)
    ).json()
    assert status["connected"] is True
    assert status["credentials_set"] is True
    # Secrets are never echoed back.
    assert "service_account_json" not in status
    assert "refresh_token" not in status


def test_connect_rejects_incomplete_oauth_credentials(client, vendor, drive):
    r = connect(
        client, vendor[0], vendor[1], auth_type="oauth", service_account_json=None
    )
    assert r.status_code == 400
    assert "client_id" in r.json()["detail"]


def test_connect_surfaces_a_drive_error(client, vendor, drive, monkeypatch):
    def boom(folder_id):
        raise DriveError("That folder was not found, or it is not shared.")

    monkeypatch.setattr(drive, "get_folder", boom)
    r = connect(client, vendor[0], vendor[1])
    assert r.status_code == 400
    assert "not shared" in r.json()["detail"]


def test_drive_endpoints_require_the_owner_token(client, vendor, drive):
    vid, _ = vendor
    assert client.get(f"/v1/vendors/{vid}/integrations/drive").status_code == 401
    assert client.post(f"/v1/vendors/{vid}/integrations/drive/sync").status_code == 401


# --- Sync and the review queue ----------------------------------------------


def test_sync_queues_files_without_publishing_them(client, vendor, drive):
    """The core safety property: discovery alone never publishes."""
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("SOC 2 Type II.pdf"), drive_file("Pen test 2026.pdf")])

    r = client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]
    assert summary["discovered"] == 2
    assert summary["queued"] == 2
    assert summary["published"] == 0
    assert drive.downloads == []

    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert artifacts == []


def test_including_a_file_publishes_it(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("SOC 2 Type II.pdf")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))

    files = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()["files"]
    assert files[0]["proposed"]["type"] == "soc2_type2"

    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/files/{files[0]['id']}/decision",
        headers=owner_headers(owner),
        json={
            "decision": "included",
            "category": "Compliance",
            "description": "Our current SOC 2.",
            "featured": True,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["published"] is True
    assert r.json()["outcome"] == "created"

    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert len(artifacts) == 1
    assert artifacts[0]["source"] == "drive"
    assert artifacts[0]["description"] == "Our current SOC 2."
    assert artifacts[0]["featured"] is True
    assert artifacts[0]["version"] == 1
    assert artifacts[0]["sha256"]


def test_a_new_revision_becomes_a_new_version_not_a_duplicate(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("SOC 2.pdf", md5="v1")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    files = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()["files"]
    client.post(
        f"/v1/vendors/{vid}/integrations/drive/files/{files[0]['id']}/decision",
        headers=owner_headers(owner),
        json={"decision": "included"},
    )

    # Same Drive file, new content.
    drive.set_files([drive_file("SOC 2.pdf", md5="v2")])
    summary = client.post(
        f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner)
    ).json()["summary"]
    assert summary["versioned"] == 1
    assert summary["published"] == 0

    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert len(artifacts) == 1
    assert artifacts[0]["version"] == 2

    history = client.get(
        f"/v1/vendors/{vid}/manage/artifacts/{artifacts[0]['id']}/versions",
        headers=owner_headers(owner),
    ).json()["versions"]
    assert [v["version"] for v in history] == [2, 1]


def test_an_unchanged_file_is_not_republished(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("SOC 2.pdf", md5="v1")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    files = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()["files"]
    client.post(
        f"/v1/vendors/{vid}/integrations/drive/files/{files[0]['id']}/decision",
        headers=owner_headers(owner),
        json={"decision": "included"},
    )
    downloads_after_first = len(drive.downloads)

    summary = client.post(
        f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner)
    ).json()["summary"]
    assert summary["unchanged"] == 1
    assert summary["versioned"] == 0
    assert len(drive.downloads) == downloads_after_first


def test_an_excluded_file_stays_excluded_across_syncs(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("Internal notes.pdf")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    files = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()["files"]
    client.post(
        f"/v1/vendors/{vid}/integrations/drive/files/{files[0]['id']}/decision",
        headers=owner_headers(owner),
        json={"decision": "excluded", "reason": "internal only"},
    )

    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    queue = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files?decision=pending",
        headers=owner_headers(owner),
    ).json()
    assert queue["files"] == []
    assert queue["counts"]["excluded"] == 1


def test_auto_publish_requires_a_matching_rule(client, vendor, drive):
    """auto_publish is not "publish everything" — a filename guess is not consent."""
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(
        client, vid, owner,
        auto_publish=True,
        rules=[{"match": "Compliance/*", "label": "certs", "category": "Compliance"}],
    )
    drive.set_files([
        drive_file("SOC 2.pdf", path="Compliance/SOC 2.pdf"),
        drive_file("Random.pdf", path="Random.pdf"),
    ])
    summary = client.post(
        f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner)
    ).json()["summary"]
    assert summary["published"] == 1
    assert summary["queued"] == 1

    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert [a["category"] for a in artifacts] == ["Compliance"]


def test_an_exclude_rule_keeps_files_out_of_the_queue(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner, rules=[{"match": "*Draft*", "action": "exclude"}])
    drive.set_files([drive_file("Draft policy.pdf"), drive_file("Final policy.pdf")])
    summary = client.post(
        f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner)
    ).json()["summary"]
    assert summary["auto_excluded"] == 1
    assert summary["queued"] == 1


def test_a_deleted_drive_file_does_not_unpublish_the_artifact(client, vendor, drive):
    """Tidying a folder must not silently strip evidence off a live trust center."""
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("SOC 2.pdf")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    files = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()["files"]
    client.post(
        f"/v1/vendors/{vid}/integrations/drive/files/{files[0]['id']}/decision",
        headers=owner_headers(owner),
        json={"decision": "included"},
    )

    drive.set_files([])
    summary = client.post(
        f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner)
    ).json()["summary"]
    assert summary["missing"] == 1

    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert len(artifacts) == 1
    queue = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()
    assert queue["files"][0]["missing_since"]


def test_one_bad_file_does_not_abort_the_sync(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner, auto_publish=True, rules=[{"match": "*.pdf", "label": "all"}])
    drive.fail_on = {"Broken.pdf"}
    drive.set_files([drive_file("Broken.pdf"), drive_file("Good.pdf")])
    summary = client.post(
        f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner)
    ).json()["summary"]
    assert summary["published"] == 1
    assert len(summary["errors"]) == 1
    assert "Broken.pdf" in summary["errors"][0]


def test_sync_records_an_oscal_change(client, vendor, drive):
    from tests.conftest import grant_key, owner_headers

    vid, owner = vendor
    connect(client, vid, owner, auto_publish=True, rules=[{"match": "*.pdf", "label": "all"}])
    drive.set_files([drive_file("SOC 2.pdf")])
    client.post(f"/v1/vendors/{vid}/publish", headers=owner_headers(owner))
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))

    key = grant_key(client, vid, owner)
    changes = client.get(
        f"/v1/vendors/{vid}/oscal/changes", headers={"Authorization": f"Bearer {key}"}
    ).json()["changes"]
    assert any(c["event"] == "drive.synced" for c in changes)


def test_bulk_include_is_refused(client, vendor, drive):
    """Publishing is a per-file decision; only bulk exclusion is offered."""
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("A.pdf")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/files/decisions",
        headers=owner_headers(owner),
        json={"decision": "included", "file_ids": [1]},
    )
    assert r.status_code == 400
    assert "individually" in r.json()["detail"]


def test_bulk_exclusion_clears_the_queue(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([drive_file("A.pdf"), drive_file("B.pdf")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    files = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()["files"]
    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/files/decisions",
        headers=owner_headers(owner),
        json={"decision": "excluded", "file_ids": [f["id"] for f in files]},
    )
    assert r.json()["excluded"] == 2
    assert r.json()["counts"]["pending"] == 0


def test_rule_preview_shows_the_effect_before_saving(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner)
    drive.set_files([
        drive_file("SOC 2.pdf", path="Compliance/SOC 2.pdf"),
        drive_file("Draft.pdf", path="Draft.pdf"),
    ])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))

    r = client.post(
        f"/v1/vendors/{vid}/integrations/drive/rules/preview",
        headers=owner_headers(owner),
        json={"rules": [
            {"match": "Compliance/*", "label": "certs"},
            {"match": "*Draft*", "action": "exclude", "label": "drafts"},
        ]},
    )
    assert r.status_code == 200
    assert r.json()["counts"] == {"include": 1, "review": 0, "exclude": 1}


def test_disconnect_keeps_artifacts_unless_purge_is_asked_for(client, vendor, drive):
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner, auto_publish=True, rules=[{"match": "*.pdf", "label": "all"}])
    drive.set_files([drive_file("SOC 2.pdf")])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))

    assert client.delete(
        f"/v1/vendors/{vid}/integrations/drive", headers=owner_headers(owner)
    ).status_code == 204
    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert len(artifacts) == 1

    # Relinking the same folder re-adopts what it published before rather than
    # publishing a second copy of every document.
    connect(client, vid, owner, auto_publish=True, rules=[{"match": "*.pdf", "label": "all"}])
    client.post(f"/v1/vendors/{vid}/integrations/drive/sync", headers=owner_headers(owner))
    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert len(artifacts) == 1

    client.delete(
        f"/v1/vendors/{vid}/integrations/drive?purge=true", headers=owner_headers(owner)
    )
    assert client.get(
        f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)
    ).json() == []


# --- Scheduled sync ----------------------------------------------------------


def test_scheduled_sync_only_touches_automatic_connections(client, vendor, drive, monkeypatch):
    """`manual` means the owner controls when their folder is read. The cron
    must respect that rather than syncing everything it can reach."""
    from app.db import SessionLocal
    from app.deps import get_storage
    from app.drive_sync import sync_due_connections
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(client, vid, owner, sync_mode="manual")
    drive.set_files([drive_file("SOC 2.pdf")])

    with SessionLocal() as db:
        assert sync_due_connections(db, get_storage())["synced"] == 0

    client.patch(
        f"/v1/vendors/{vid}/integrations/drive",
        headers=owner_headers(owner),
        json={"sync_mode": "on_change"},
    )
    with SessionLocal() as db:
        result = sync_due_connections(db, get_storage())
    assert result["synced"] == 1

    queue = client.get(
        f"/v1/vendors/{vid}/integrations/drive/files", headers=owner_headers(owner)
    ).json()
    assert queue["counts"]["pending"] == 1
    # Still nothing published: the scheduled run discovers, it does not decide.
    assert client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json() == []


def test_scheduled_sync_publishes_what_was_already_approved(client, vendor, drive):
    from app.db import SessionLocal
    from app.deps import get_storage
    from app.drive_sync import sync_due_connections
    from tests.conftest import owner_headers

    vid, owner = vendor
    connect(
        client, vid, owner,
        sync_mode="on_change",
        auto_publish=True,
        rules=[{"match": "*.pdf", "label": "all"}],
    )
    drive.set_files([drive_file("SOC 2.pdf")])
    with SessionLocal() as db:
        result = sync_due_connections(db, get_storage())
    summary = next(iter(result["connections"].values()))
    assert summary["published"] == 1

    artifacts = client.get(f"/v1/vendors/{vid}/artifacts", headers=owner_headers(owner)).json()
    assert [a["source"] for a in artifacts] == ["drive"]


def test_a_broken_connection_does_not_stop_the_others(client, vendor, service_token, drive):
    """One bad credential must not stop every other trust center from syncing."""
    from app.db import SessionLocal
    from app.deps import get_storage
    from app.drive import DriveError
    from app.drive_sync import sync_due_connections
    from tests.conftest import owner_headers

    good_id, good_owner = vendor
    connect(client, good_id, good_owner, sync_mode="on_change", auto_publish=True,
            rules=[{"match": "*.pdf", "label": "all"}])

    other = client.post(
        "/v1/vendors",
        headers={"X-TrustMCP-Service-Token": service_token},
        json={"legal_name": "Globex"},
    ).json()
    connect(client, other["id"], other["owner_token"], sync_mode="on_change")

    drive.set_files([drive_file("SOC 2.pdf")])
    calls = {"n": 0}
    original = drive.list_folder

    def flaky(folder_id, *, recursive=True, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise DriveError("Google rejected the stored authorization.")
        return original(folder_id, recursive=recursive, **kwargs)

    drive.list_folder = flaky

    with SessionLocal() as db:
        result = sync_due_connections(db, get_storage())
    assert result["synced"] == 2
    summaries = list(result["connections"].values())
    assert any(s.get("errors") for s in summaries)
    assert any(s.get("discovered") for s in summaries)

    # The failure is surfaced on the connection, not swallowed.
    statuses = [
        client.get(
            f"/v1/vendors/{v}/integrations/drive", headers=owner_headers(o)
        ).json()["status"]
        for v, o in ((good_id, good_owner), (other["id"], other["owner_token"]))
    ]
    assert "error" in statuses
