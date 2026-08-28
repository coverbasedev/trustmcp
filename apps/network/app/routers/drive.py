"""Google Drive folder sync — owner-facing endpoints.

Connect a folder, review what the sync found, decide what gets published, and
control how it presents on the public trust center.

Everything here is owner-authenticated. Credentials go in and are never read
back out: the responses report *whether* a credential is set, never its value.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import SessionLocal, get_db
from ..deps import get_storage
from ..drive import (
    READONLY_SCOPE,
    DriveClient,
    DriveError,
    authorization_url,
    exchange_code,
    sign_state,
    verify_state,
)
from ..drive_rules import DEFAULT_CATEGORIES, TYPE_HINTS, classify, validate_rules
from ..drive_sync import sync as run_sync
from ..ids import new_id
from ..models import Artifact, DriveConnection, DriveFile, Vendor
from ..oscal import feed as feed_mod
from ..schemas import (
    DriveConnect,
    DriveConnectionUpdate,
    DriveDecision,
)
from ..security import require_owner
from ..services import audit
from ..storage import Storage

router = APIRouter(prefix="/v1/vendors/{vendor_id}/integrations/drive", tags=["drive"])


def _connection_out(connection: DriveConnection, *, file_counts: dict | None = None) -> dict:
    return {
        "id": connection.id,
        "vendor_id": connection.vendor_id,
        "folder_id": connection.folder_id,
        "folder_name": connection.folder_name,
        # True between consent and folder selection: authorized, syncing nothing.
        "needs_folder": connection.folder_id is None,
        "auth_type": connection.auth_type,
        "credentials_set": bool(connection.refresh_token or connection.service_account_json),
        "recursive": connection.recursive,
        "sync_mode": connection.sync_mode,
        "auto_publish": connection.auto_publish,
        "rules": connection.rules or [],
        "default_category": connection.default_category,
        "default_type": connection.default_type,
        "default_access": connection.default_access,
        "status": connection.status,
        "last_error": connection.last_error,
        "last_sync_at": connection.last_sync_at.isoformat() if connection.last_sync_at else None,
        "last_sync_summary": connection.last_sync_summary or {},
        "created_at": connection.created_at.isoformat() if connection.created_at else None,
        "files": file_counts or {},
    }


def _file_out(row: DriveFile, artifact: Artifact | None = None) -> dict:
    return {
        "id": row.id,
        "drive_file_id": row.drive_file_id,
        "name": row.name,
        "path": row.path,
        "mime_type": row.mime_type,
        "size_bytes": row.size_bytes,
        "modified_time": row.modified_time,
        "web_view_link": row.web_view_link,
        "decision": row.decision,
        "exclude_reason": row.exclude_reason,
        "matched_rule": row.matched_rule,
        "proposed": {
            "type": row.proposed_type,
            "title": row.proposed_title,
            "category": row.proposed_category,
            "access": row.proposed_access,
        },
        "artifact_id": row.artifact_id,
        "artifact": (
            {
                "id": artifact.id,
                "title": artifact.title,
                "type": artifact.type,
                "version": artifact.version,
                "access": artifact.access,
                "category": artifact.category,
                "hidden": artifact.hidden,
                "featured": artifact.featured,
            }
            if artifact
            else None
        ),
        "synced_at": row.synced_at.isoformat() if row.synced_at else None,
        "missing_since": row.missing_since.isoformat() if row.missing_since else None,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
    }


def _get_connection(db: Session, vendor_id: str) -> DriveConnection:
    connection = db.scalar(
        select(DriveConnection).where(DriveConnection.vendor_id == vendor_id)
    )
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no Drive folder is linked")
    return connection


def _counts(db: Session, connection_id: str) -> dict:
    rows = db.scalars(
        select(DriveFile.decision).where(DriveFile.connection_id == connection_id)
    ).all()
    return {
        "total": len(rows),
        "pending": sum(1 for d in rows if d == "pending"),
        "included": sum(1 for d in rows if d == "included"),
        "excluded": sum(1 for d in rows if d == "excluded"),
    }


# --- Connect / inspect / disconnect ------------------------------------------


@router.get("")
def get_connection(
    vendor_id: str,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """The linked folder, or `{"connected": false}` when there is none."""
    connection = db.scalar(select(DriveConnection).where(DriveConnection.vendor_id == vendor_id))
    # `oauth_available` drives which form the builder shows: a single Connect
    # button when the operator configured a Google client, the paste-your-own
    # credentials form otherwise.
    base = {
        "vendor_id": vendor_id,
        "oauth_available": settings.google_oauth_enabled,
        "redirect_uri": settings.drive_redirect_uri() if settings.google_oauth_enabled else None,
    }
    if connection is None:
        return {"connected": False, **base}
    return {
        "connected": True,
        **base,
        **_connection_out(connection, file_counts=_counts(db, connection.id)),
    }


@router.post("", status_code=201)
def connect(
    vendor_id: str,
    body: DriveConnect,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Link a Drive folder.

    The folder is read once before anything is stored, so a wrong id or an
    unshared folder fails here with a message the owner can act on rather than
    silently producing an empty sync later.
    """
    if body.auth_type == "oauth" and not (
        body.client_id and body.client_secret and body.refresh_token
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "OAuth connections need client_id, client_secret, and refresh_token. "
            "Use /oauth/start and /oauth/callback to obtain them.",
        )
    if body.auth_type == "service_account" and not body.service_account_json:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "service_account_json is required for this auth type"
        )

    problems = validate_rules(body.rules or [])
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(problems))

    existing = db.scalar(select(DriveConnection).where(DriveConnection.vendor_id == vendor_id))
    connection = existing or DriveConnection(id=new_id("drv", 10), vendor_id=vendor_id)
    connection.folder_id = body.folder_id.strip()
    connection.auth_type = body.auth_type
    connection.recursive = body.recursive
    connection.sync_mode = body.sync_mode
    connection.auto_publish = body.auto_publish
    connection.rules = body.rules or connection.rules or []
    connection.default_category = body.default_category
    connection.default_type = body.default_type
    connection.default_access = body.default_access
    if body.client_id:
        connection.client_id = body.client_id
    if body.client_secret:
        connection.client_secret = body.client_secret
    if body.refresh_token:
        connection.refresh_token = body.refresh_token
    if body.service_account_json:
        connection.service_account_json = body.service_account_json

    try:
        folder = DriveClient.for_connection(connection).get_folder(connection.folder_id)
        connection.folder_name = folder.get("name")
        connection.status = "connected"
        connection.last_error = None
    except DriveError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    db.add(connection)
    db.commit()
    audit(db, vendor_id, "drive.connect", actor="owner", target=connection.folder_id)
    return _connection_out(connection, file_counts=_counts(db, connection.id))


@router.patch("")
def update_connection(
    vendor_id: str,
    body: DriveConnectionUpdate,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Change sync behavior or classification rules without re-authorizing."""
    connection = _get_connection(db, vendor_id)
    if body.rules is not None:
        problems = validate_rules(body.rules)
        if problems:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(problems))
        connection.rules = body.rules
    for field in (
        "recursive",
        "sync_mode",
        "auto_publish",
        "default_category",
        "default_type",
        "default_access",
    ):
        value = getattr(body, field)
        if value is not None:
            setattr(connection, field, value)
    if body.status is not None:
        if body.status not in ("connected", "disabled"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "status must be connected or disabled")
        connection.status = body.status
    db.add(connection)
    db.commit()
    return _connection_out(connection, file_counts=_counts(db, connection.id))


@router.delete("", status_code=204)
def disconnect(
    vendor_id: str,
    purge: bool = Query(False, description="Also delete artifacts published from this folder"),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    """Unlink the folder.

    Published artifacts stay by default. Unlinking a sync should not silently
    strip evidence off a live trust center — pass `purge=true` to remove them
    deliberately.
    """
    connection = _get_connection(db, vendor_id)
    if purge:
        artifact_ids = [
            row.artifact_id
            for row in db.scalars(
                select(DriveFile).where(DriveFile.connection_id == connection.id)
            ).all()
            if row.artifact_id
        ]
        for artifact_id in artifact_ids:
            artifact = db.get(Artifact, artifact_id)
            if artifact is not None and artifact.vendor_id == vendor_id:
                db.delete(artifact)
    db.delete(connection)
    db.commit()
    audit(db, vendor_id, "drive.disconnect", actor="owner", detail=f"purge={purge}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- OAuth helper ------------------------------------------------------------


@router.get("/oauth/start")
def oauth_start(
    vendor_id: str,
    vendor: Vendor = Depends(require_owner),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Begin the click-through connection: the Google consent URL to open.

    Uses the network's own OAuth client, so a trust-center owner never sees or
    pastes a credential. The returned `state` is signed and carries the vendor,
    which is what lets the callback attach the tokens to the right trust center
    without trusting a query parameter.
    """
    if not settings.google_oauth_enabled:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "This network has no Google OAuth client configured, so the one-click "
            "connection is unavailable. Link the folder with a service-account key "
            "instead, or ask the operator to set TRUSTMCP_GOOGLE_CLIENT_ID and "
            "TRUSTMCP_GOOGLE_CLIENT_SECRET.",
        )
    redirect_uri = settings.drive_redirect_uri()
    state = sign_state(
        settings.service_token, vendor_id, settings.google_oauth_state_ttl_seconds
    )
    return {
        "authorization_url": authorization_url(
            settings.google_client_id, redirect_uri, state
        ),
        "redirect_uri": redirect_uri,
        "scope": READONLY_SCOPE,
        "expires_in": settings.google_oauth_state_ttl_seconds,
        "note": (
            "TrustMCP requests read-only Drive access and never writes back to your folder."
        ),
    }


@router.post("/oauth/exchange")
def oauth_exchange(
    vendor_id: str,
    body: dict = Body(...),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Finish consent: trade the code for tokens and store them.

    Leaves the connection at `pending_folder` — authorized, but syncing nothing
    until the owner picks a folder. Storing credentials here rather than handing
    them back to the browser keeps the refresh token server-side for its whole
    life.
    """
    if not settings.google_oauth_enabled:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED, "Google OAuth is not configured on this network"
        )
    code = (body.get("code") or "").strip()
    state = (body.get("state") or "").strip()
    if not code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "code is required")
    if not state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "state is required")

    try:
        state_vendor = verify_state(settings.service_token, state)
    except DriveError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    if state_vendor != vendor_id:
        # The signed state names a different trust center than the URL does.
        # Refuse rather than guess which one the owner meant.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This sign-in belongs to a different trust center.",
        )

    try:
        tokens = exchange_code(
            settings.google_client_id,
            settings.google_client_secret,
            code,
            settings.drive_redirect_uri(),
        )
    except DriveError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    existing = db.scalar(select(DriveConnection).where(DriveConnection.vendor_id == vendor_id))
    connection = existing or DriveConnection(id=new_id("drv", 10), vendor_id=vendor_id)
    connection.auth_type = "oauth"
    connection.client_id = settings.google_client_id
    connection.client_secret = settings.google_client_secret
    connection.refresh_token = tokens["refresh_token"]
    connection.service_account_json = None
    connection.last_error = None
    # Re-authorizing an already-connected folder keeps it connected; a fresh
    # connection waits for the owner to choose one.
    connection.status = "connected" if connection.folder_id else "pending_folder"
    db.add(connection)
    db.commit()
    audit(db, vendor_id, "drive.oauth", actor="owner", detail="authorized via Google")
    return {
        "status": connection.status,
        "needs_folder": connection.folder_id is None,
        **_connection_out(connection, file_counts=_counts(db, connection.id)),
    }


@router.get("/folders")
def list_folders(
    vendor_id: str,
    parent: str = Query("root", description="Folder id to list, or 'root'"),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Folders inside `parent`, for the picker.

    Requires an authorized connection — this browses the owner's Drive with the
    credentials they just granted, so it exists only after consent.
    """
    connection = _get_connection(db, vendor_id)
    if not (connection.refresh_token or connection.service_account_json):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "this connection has no credentials yet"
        )
    client = DriveClient.for_connection(connection)
    try:
        folders = client.list_subfolders(parent)
        drives = client.shared_drives() if parent == "root" else []
        current = None if parent == "root" else client.get_folder(parent)
    except DriveError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    return {
        "vendor_id": vendor_id,
        "parent": parent,
        "current": (
            {"id": current["id"], "name": current.get("name")} if current else
            {"id": "root", "name": "My Drive"}
        ),
        "folders": folders,
        "shared_drives": drives,
        "selected_folder_id": connection.folder_id,
    }


@router.post("/folder")
def set_folder(
    vendor_id: str,
    body: dict = Body(...),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Choose the folder to sync, completing a click-through connection."""
    connection = _get_connection(db, vendor_id)
    folder_id = (body.get("folder_id") or "").strip()
    if not folder_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "folder_id is required")
    try:
        folder = DriveClient.for_connection(connection).get_folder(folder_id)
    except DriveError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    connection.folder_id = folder_id
    connection.folder_name = folder.get("name")
    connection.status = "connected"
    connection.last_error = None
    db.add(connection)
    db.commit()
    audit(db, vendor_id, "drive.connect", actor="owner", target=folder_id)
    return _connection_out(connection, file_counts=_counts(db, connection.id))


# --- Sync --------------------------------------------------------------------


@router.post("/sync")
def sync_now(
    vendor_id: str,
    background: BackgroundTasks,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Run a sync immediately and return what it did."""
    connection = _get_connection(db, vendor_id)
    if not connection.folder_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Choose a folder before syncing — this connection is authorized but not "
            "pointed at anything yet.",
        )
    summary = run_sync(db, connection, vendor, storage)
    audit(
        db,
        vendor_id,
        "drive.sync",
        actor="owner",
        target=connection.folder_id,
        detail=f"published={summary.published} versioned={summary.versioned}",
    )
    if summary.published or summary.versioned:
        background.add_task(
            _fan_out_latest, vendor_id, settings.public_base_url.rstrip("/")
        )
    return {
        "vendor_id": vendor_id,
        "summary": summary.as_dict(),
        "connection": _connection_out(connection, file_counts=_counts(db, connection.id)),
    }


def _fan_out_latest(vendor_id: str, network_url: str) -> None:
    """Push the newest change to OSCAL subscribers, in a fresh session."""
    from ..models import OscalChange

    with SessionLocal() as db:
        change = db.scalar(
            select(OscalChange)
            .where(OscalChange.vendor_id == vendor_id)
            .order_by(OscalChange.sequence.desc())
            .limit(1)
        )
        if change is not None:
            feed_mod.fan_out(db, vendor_id, change, network_url)


# --- Review queue ------------------------------------------------------------


@router.get("/files")
def list_files(
    vendor_id: str,
    decision: str | None = Query(None, description="pending | included | excluded"),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Everything the sync has seen, newest first within each decision."""
    connection = _get_connection(db, vendor_id)
    query = select(DriveFile).where(DriveFile.connection_id == connection.id)
    if decision:
        if decision not in ("pending", "included", "excluded"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "decision must be pending, included, or excluded"
            )
        query = query.where(DriveFile.decision == decision)
    rows = db.scalars(query.order_by(DriveFile.last_seen_at.desc())).all()
    artifacts = {
        a.id: a
        for a in db.scalars(select(Artifact).where(Artifact.vendor_id == vendor_id)).all()
    }
    return {
        "vendor_id": vendor_id,
        "counts": _counts(db, connection.id),
        "files": [_file_out(r, artifacts.get(r.artifact_id)) for r in rows],
    }


@router.post("/files/{file_id}/decision")
def decide_file(
    vendor_id: str,
    file_id: int,
    body: DriveDecision,
    background: BackgroundTasks,
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Include or exclude one file, with its presentation settings.

    Including publishes immediately — the owner has just made the decision, so
    making them run a second sync to see the result would be pure friction.
    """
    connection = _get_connection(db, vendor_id)
    row = db.get(DriveFile, file_id)
    if row is None or row.connection_id != connection.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")

    if body.decision == "excluded":
        row.decision = "excluded"
        row.exclude_reason = body.reason or "excluded by the trust center owner"
        row.decided_at = datetime.now(UTC)
        db.add(row)
        db.commit()
        return {"file": _file_out(row), "published": False}

    if body.decision != "included":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "decision must be included or excluded")

    row.decision = "included"
    row.exclude_reason = None
    row.decided_at = datetime.now(UTC)
    if body.type:
        row.proposed_type = body.type
    if body.title:
        row.proposed_title = body.title
    if body.category is not None:
        row.proposed_category = body.category
    if body.access:
        row.proposed_access = body.access
    db.add(row)
    db.commit()

    from ..drive import DriveClient as _Client
    from ..drive import DriveFileInfo
    from ..drive_sync import publish as publish_file

    info = DriveFileInfo(
        id=row.drive_file_id,
        name=row.name,
        mime_type=row.mime_type or "",
        md5=row.md5,
        modified_time=row.modified_time,
        size=row.size_bytes,
        web_view_link=row.web_view_link,
        path=row.path or row.name,
    )
    try:
        outcome = publish_file(
            db, connection, vendor, row, info, storage, client=_Client.for_connection(connection)
        )
    except DriveError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e

    artifact = db.get(Artifact, row.artifact_id)
    if artifact is not None:
        _apply_presentation(artifact, body)
        db.add(artifact)
        db.commit()

    feed_mod.record_change(
        db,
        vendor_id,
        "artifact.created" if outcome == "created" else "artifact.version",
        subject=row.artifact_id,
        detail={"source": "drive", "file": row.name},
    )
    background.add_task(_fan_out_latest, vendor_id, settings.public_base_url.rstrip("/"))
    audit(
        db,
        vendor_id,
        "drive.include",
        actor="owner",
        target=row.artifact_id,
        detail=f"{row.name} ({outcome})",
    )
    return {"file": _file_out(row, artifact), "published": True, "outcome": outcome}


def _apply_presentation(artifact: Artifact, body: DriveDecision) -> None:
    """Carry the review form's presentation choices onto the artifact."""
    if body.description is not None:
        artifact.description = body.description
    if body.position is not None:
        artifact.position = body.position
    if body.featured is not None:
        artifact.featured = body.featured
    if body.hidden is not None:
        artifact.hidden = body.hidden
    if body.product_ids is not None:
        artifact.product_ids = body.product_ids
    if body.valid_until is not None:
        artifact.valid_until = body.valid_until
    if body.issued_at is not None:
        artifact.issued_at = body.issued_at


@router.post("/files/decisions")
def decide_many(
    vendor_id: str,
    body: dict = Body(...),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Bulk exclude, for clearing a queue full of files that are not evidence.

    Bulk *include* is deliberately absent: including publishes documents, and
    that decision deserves to be made one file at a time.
    """
    file_ids = body.get("file_ids") or []
    if body.get("decision") != "excluded":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "only bulk exclusion is supported — include files individually so each "
            "publication is a deliberate choice",
        )
    connection = _get_connection(db, vendor_id)
    rows = db.scalars(
        select(DriveFile).where(
            DriveFile.connection_id == connection.id, DriveFile.id.in_(file_ids)
        )
    ).all()
    now = datetime.now(UTC)
    for row in rows:
        row.decision = "excluded"
        row.exclude_reason = body.get("reason") or "excluded in bulk by the trust center owner"
        row.decided_at = now
        db.add(row)
    db.commit()
    return {"excluded": len(rows), "counts": _counts(db, connection.id)}


# --- Rule authoring aids -----------------------------------------------------


@router.post("/rules/preview")
def preview_rules(
    vendor_id: str,
    body: dict = Body(...),
    vendor: Vendor = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Show what a rule set would do to the files already discovered.

    Rules decide what gets published, so being able to see their effect before
    saving them is the difference between a useful feature and a hazard.
    """
    rules = body.get("rules") or []
    problems = validate_rules(rules)
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(problems))
    connection = _get_connection(db, vendor_id)
    rows = db.scalars(
        select(DriveFile).where(DriveFile.connection_id == connection.id)
    ).all()
    results = []
    for row in rows:
        decision = classify(
            row.path or row.name,
            row.name,
            rules=rules,
            default_type=body.get("default_type") or connection.default_type,
            default_category=body.get("default_category") or connection.default_category,
            default_access=body.get("default_access") or connection.default_access,
        )
        results.append(
            {
                "file_id": row.id,
                "name": row.name,
                "path": row.path,
                "current_decision": row.decision,
                "would": decision.as_dict(),
            }
        )
    return {
        "vendor_id": vendor_id,
        "counts": {
            "include": sum(1 for r in results if r["would"]["action"] == "include"),
            "review": sum(1 for r in results if r["would"]["action"] == "review"),
            "exclude": sum(1 for r in results if r["would"]["action"] == "exclude"),
        },
        "files": results,
    }


@router.get("/rules/reference")
def rules_reference(
    vendor_id: str,
    vendor: Vendor = Depends(require_owner),
) -> dict:
    """The vocabulary available when writing rules."""
    return {
        "fields": {
            "match": "Glob over the file's path within the linked folder, or its name.",
            "action": "include | review | exclude. Default: include.",
            "type": "Artifact type (soc2_type2, pentest, policy, …).",
            "category": "Resource category shown on the public trust center.",
            "access": "public | key_required.",
            "title": "Overrides the title derived from the filename.",
            "label": "A name for this rule, shown in the review queue.",
        },
        "first_match_wins": True,
        "known_types": sorted({t for _, t in TYPE_HINTS}),
        "default_categories": DEFAULT_CATEGORIES,
        "example": [
            {
                "label": "Certifications",
                "match": "Compliance/*",
                "type": "soc2_type2",
                "category": "Compliance",
                "access": "key_required",
                "action": "include",
            },
            {"label": "Ignore drafts", "match": "*Draft*", "action": "exclude"},
        ],
    }
