"""Syncing a linked Google Drive folder into a trust center.

The design decision worth stating: **a sync never publishes anything on its own
unless the owner has said it may.** Drive folders contain drafts, internal
notes, and the occasional file someone dropped in by mistake. A sync that
auto-published everything it found would turn a shared folder into a
data-disclosure surface.

So the flow is: discover → classify → queue → decide → publish.

  discover  List the folder. Every file gets a `DriveFile` row, including ones
            the owner has already excluded, which is what keeps a rejected file
            from returning to the queue on the next run.
  classify  Rules propose a type, category, visibility, and title.
  queue     New files sit at `decision="pending"` until a person acts, unless
            the connection has `auto_publish` on *and* a rule matched — a
            filename heuristic alone is never enough to publish.
  decide    The owner includes (with any edits) or excludes.
  publish   Included files become artifacts. A later Drive revision uploads a
            new *version* of the same artifact rather than a duplicate.

Deletion is deliberately asymmetric: a file vanishing from Drive marks the row
`missing_since` but leaves the published artifact alone. Someone tidying a
folder should not silently pull a SOC 2 report off a live trust center.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .drive import DriveClient, DriveError, DriveFileInfo
from .drive_rules import classify
from .ids import artifact_id as new_artifact_id
from .models import Artifact, ArtifactVersion, DriveConnection, DriveFile, Vendor

log = logging.getLogger("trustmcp.drive.sync")


@dataclass
class SyncSummary:
    discovered: int = 0
    new: int = 0
    updated: int = 0
    unchanged: int = 0
    published: int = 0
    versioned: int = 0
    queued: int = 0
    auto_excluded: int = 0
    missing: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "discovered": self.discovered,
            "new": self.new,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "published": self.published,
            "versioned": self.versioned,
            "queued": self.queued,
            "auto_excluded": self.auto_excluded,
            "missing": self.missing,
            "errors": self.errors,
            "at": datetime.now(UTC).isoformat(),
        }


def _content_changed(row: DriveFile, info: DriveFileInfo) -> bool:
    """Has the file moved since we last saw it?

    md5 is authoritative when Drive gives us one. Google-native documents have
    no md5, so `modifiedTime` is the fallback — coarser (a no-op edit bumps it)
    but never misses a real change, which is the right way round.
    """
    if info.md5 and row.md5:
        return info.md5 != row.md5
    return (info.modified_time or "") != (row.modified_time or "")


def _needs_publish(row: DriveFile, info: DriveFileInfo) -> bool:
    """Is the current Drive revision different from the one we published?"""
    if row.artifact_id is None:
        return True
    if info.md5 and row.synced_md5:
        return info.md5 != row.synced_md5
    return (info.modified_time or "") != (row.synced_modified_time or "")


def discover(
    db: Session, connection: DriveConnection, *, client: DriveClient | None = None
) -> tuple[list[tuple[DriveFile, DriveFileInfo]], SyncSummary]:
    """List the folder and reconcile it against what we already know.

    Returns the rows that are ready to publish, plus the summary. Does not
    download anything — discovery is cheap and runs even when publishing fails.
    """
    summary = SyncSummary()
    client = client or DriveClient.for_connection(connection)
    files = client.list_folder(connection.folder_id, recursive=connection.recursive)
    summary.discovered = len(files)

    existing = {
        row.drive_file_id: row
        for row in db.scalars(
            select(DriveFile).where(DriveFile.connection_id == connection.id)
        ).all()
    }
    seen: set[str] = set()
    publishable: list[tuple[DriveFile, DriveFileInfo]] = []
    now = datetime.now(UTC)

    for info in files:
        seen.add(info.id)
        row = existing.get(info.id)
        decision = classify(
            info.path or info.name,
            info.name,
            rules=connection.rules or [],
            default_type=connection.default_type,
            default_category=connection.default_category,
            default_access=connection.default_access,
        )

        if row is None:
            row = DriveFile(
                connection_id=connection.id,
                vendor_id=connection.vendor_id,
                drive_file_id=info.id,
                name=info.name,
                path=info.path,
                mime_type=info.mime_type,
                size_bytes=info.size,
                md5=info.md5,
                modified_time=info.modified_time,
                web_view_link=info.web_view_link,
                proposed_type=decision.type,
                proposed_title=decision.title,
                proposed_category=decision.category,
                proposed_access=decision.access,
                matched_rule=decision.rule,
                first_seen_at=now,
                last_seen_at=now,
            )
            if decision.action == "exclude":
                row.decision = "excluded"
                row.exclude_reason = decision.reason
                row.decided_at = now
                summary.auto_excluded += 1
            elif decision.action == "include" and connection.auto_publish and decision.rule:
                # Auto-publish only where a rule explicitly said so. A filename
                # heuristic is a suggestion, not consent to publish.
                row.decision = "included"
                row.decided_at = now
            else:
                row.decision = "pending"
                summary.queued += 1
            db.add(row)
            summary.new += 1
        else:
            changed = _content_changed(row, info)
            row.name = info.name
            row.path = info.path
            row.mime_type = info.mime_type
            row.size_bytes = info.size
            row.md5 = info.md5
            row.modified_time = info.modified_time
            row.web_view_link = info.web_view_link
            row.last_seen_at = now
            row.missing_since = None
            # Re-propose only while the owner has not decided; overwriting a
            # decided row's proposals would fight the person who set them.
            if row.decision == "pending":
                row.proposed_type = decision.type
                row.proposed_title = decision.title
                row.proposed_category = decision.category
                row.proposed_access = decision.access
                row.matched_rule = decision.rule
            db.add(row)
            if changed:
                summary.updated += 1
            else:
                summary.unchanged += 1

        if row.decision == "included" and _needs_publish(row, info):
            publishable.append((row, info))

    for drive_id, row in existing.items():
        if drive_id not in seen and row.missing_since is None:
            row.missing_since = now
            db.add(row)
            summary.missing += 1

    db.commit()
    return publishable, summary


def publish(
    db: Session,
    connection: DriveConnection,
    vendor: Vendor,
    row: DriveFile,
    info: DriveFileInfo,
    storage,
    *,
    client: DriveClient | None = None,
) -> str:
    """Download one file and publish it as an artifact (or a new version).

    Returns "created" or "versioned". Mirrors what
    `manage.upload_artifact_content` does for a hand-uploaded file, so a synced
    artifact is indistinguishable downstream from an uploaded one — same
    hashing, same version history, same access rules.
    """
    client = client or DriveClient.for_connection(connection)
    data, content_type, ext = client.download(info)

    artifact = db.get(Artifact, row.artifact_id) if row.artifact_id else None
    if artifact is None:
        # Re-adopt an artifact this same Drive file published before. Without
        # this, disconnecting and relinking a folder would publish a second copy
        # of every document alongside the ones already on the trust center.
        artifact = db.scalar(
            select(Artifact).where(
                Artifact.vendor_id == vendor.id,
                Artifact.source == "drive",
                Artifact.source_ref == row.drive_file_id,
            )
        )
    outcome = "versioned"
    if artifact is None or artifact.vendor_id != vendor.id:
        today = datetime.now(UTC).date()
        artifact = Artifact(
            id=new_artifact_id(row.proposed_type or connection.default_type),
            vendor_id=vendor.id,
            type=row.proposed_type or connection.default_type,
            title=row.proposed_title or row.name,
            format=ext,
            issued_at=today,
            access=row.proposed_access or connection.default_access,
            category=row.proposed_category or connection.default_category,
            source="drive",
            source_ref=row.drive_file_id,
            version=0,  # incremented below, so the first published version is 1
        )
        db.add(artifact)
        db.flush()
        outcome = "created"
    else:
        # Archive the outgoing content before overwriting, exactly as a manual
        # re-upload does — the version history is the audit trail.
        if artifact.storage_key:
            db.add(
                ArtifactVersion(
                    artifact_id=artifact.id,
                    vendor_id=vendor.id,
                    version=artifact.version,
                    sha256=artifact.sha256,
                    storage_key=artifact.storage_key,
                    content_type=artifact.content_type,
                    size_bytes=artifact.size_bytes,
                    issued_at=artifact.issued_at,
                    valid_until=artifact.valid_until,
                    note=f"Replaced by Google Drive sync ({info.name})",
                )
            )

    artifact.version += 1
    storage_key = f"{vendor.id}/{artifact.id}/v{artifact.version}.{ext}"
    artifact.sha256 = storage.put(storage_key, data, content_type)
    artifact.storage_key = storage_key
    artifact.content_type = content_type
    artifact.size_bytes = len(data)
    artifact.source = "drive"
    artifact.source_ref = row.drive_file_id

    row.artifact_id = artifact.id
    row.synced_md5 = info.md5
    row.synced_modified_time = info.modified_time
    row.synced_at = datetime.now(UTC)
    db.add(artifact)
    db.add(row)
    db.commit()
    return outcome


def sync(
    db: Session,
    connection: DriveConnection,
    vendor: Vendor,
    storage,
    *,
    client: DriveClient | None = None,
    record_changes: bool = True,
) -> SyncSummary:
    """Run a full sync: discover, then publish everything already approved.

    One file failing to download does not abort the run — its error is collected
    and the rest still publish. A folder with one corrupt file should still sync
    the other forty.
    """
    client = client or DriveClient.for_connection(connection)
    try:
        publishable, summary = discover(db, connection, client=client)
    except DriveError as e:
        connection.status = "error"
        connection.last_error = str(e)
        connection.last_sync_at = datetime.now(UTC)
        db.add(connection)
        db.commit()
        summary = SyncSummary(errors=[str(e)])
        connection.last_sync_summary = summary.as_dict()
        db.add(connection)
        db.commit()
        return summary

    for row, info in publishable:
        try:
            outcome = publish(db, connection, vendor, row, info, storage, client=client)
            if outcome == "created":
                summary.published += 1
            else:
                summary.versioned += 1
        except DriveError as e:
            summary.errors.append(f"{info.name}: {e}")
        except Exception as e:  # pragma: no cover - defensive
            log.exception("[drive:publish-failed] file=%s", info.name)
            summary.errors.append(f"{info.name}: unexpected error ({e})")

    connection.status = "error" if summary.errors else "connected"
    connection.last_error = summary.errors[0] if summary.errors else None
    connection.last_sync_at = datetime.now(UTC)
    connection.last_sync_summary = summary.as_dict()
    db.add(connection)
    db.commit()

    if record_changes and (summary.published or summary.versioned):
        from .oscal import feed as feed_mod

        feed_mod.record_change(
            db,
            vendor.id,
            "drive.synced",
            subject=connection.id,
            detail={
                "published": summary.published,
                "versioned": summary.versioned,
                "folder": connection.folder_name or connection.folder_id,
            },
        )
    return summary


def sync_due_connections(db: Session, storage) -> dict:
    """Sync every connection set to `on_change`.

    Called by a scheduled job. Each connection is isolated: one broken
    credential does not stop the others.
    """
    connections = db.scalars(
        select(DriveConnection).where(
            DriveConnection.sync_mode == "on_change",
            DriveConnection.status != "disabled",
        )
    ).all()
    results = {}
    for connection in connections:
        vendor = db.get(Vendor, connection.vendor_id)
        if vendor is None:
            continue
        try:
            results[connection.id] = sync(db, connection, vendor, storage).as_dict()
        except Exception as e:  # pragma: no cover - defensive
            log.exception("[drive:sync-failed] connection=%s", connection.id)
            results[connection.id] = {"errors": [str(e)]}
    return {"synced": len(results), "connections": results}
