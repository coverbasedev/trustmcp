"""Full OSCAL exchange + Google Drive folder sync + resource presentation

Three related additions:

  * `oscal_changes` / `oscal_subscriptions` — the per-vendor change log that
    turns the OSCAL export from a point-in-time pull into a continuous feed, and
    the webhook registrations consumers subscribe with.
  * `drive_connections` / `drive_files` — a linked Google Drive folder and the
    review queue of what it contains. A row per file (including excluded ones)
    is what stops a rejected file reappearing on every sync.
  * presentation and provenance columns on `artifacts`, plus `resource_display`
    on `vendors` — how a resource reads on the public trust center, and where
    its content came from.

Revision ID: a7b9c1d3e5f7
Revises: f6a8b0c2d468
Create Date: 2026-08-19 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a7b9c1d3e5f7"
down_revision: str | None = "f6a8b0c2d468"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- Artifact presentation + provenance ---------------------------------
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column("position", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("featured", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("source", sa.String(), nullable=False, server_default="upload")
        )
        batch_op.add_column(sa.Column("source_ref", sa.String(), nullable=True))

    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("resource_display", sa.JSON(), nullable=False, server_default="{}")
        )

    # --- OSCAL continuous exchange ------------------------------------------
    op.create_table(
        "oscal_changes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("vendor_id", sa.String(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("models", sa.JSON(), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_oscal_changes_vendor_id", "oscal_changes", ["vendor_id"])
    op.create_index("ix_oscal_changes_sequence", "oscal_changes", ["sequence"])
    # The cursor query is always (vendor, sequence) — a composite index keeps
    # "everything after N for this vendor" a range scan as the log grows.
    op.create_index(
        "ix_oscal_changes_vendor_sequence", "oscal_changes", ["vendor_id", "sequence"]
    )

    op.create_table(
        "oscal_subscriptions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("vendor_id", sa.String(), nullable=False),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("secret", sa.String(), nullable=True),
        sa.Column("models", sa.JSON(), nullable=True),
        sa.Column("format", sa.String(), nullable=True, server_default="json"),
        sa.Column("subscriber_domain", sa.String(), nullable=True),
        sa.Column("access_key_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=True, server_default="active"),
        sa.Column("last_cursor", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("last_delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(), nullable=True),
        sa.Column("failures", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_oscal_subscriptions_vendor_id", "oscal_subscriptions", ["vendor_id"])
    op.create_index(
        "ix_oscal_subscriptions_access_key_id", "oscal_subscriptions", ["access_key_id"]
    )

    # --- Google Drive sync ---------------------------------------------------
    op.create_table(
        "drive_connections",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("vendor_id", sa.String(), nullable=False),
        sa.Column("folder_id", sa.String(), nullable=False),
        sa.Column("folder_name", sa.String(), nullable=True),
        sa.Column("auth_type", sa.String(), nullable=True, server_default="oauth"),
        sa.Column("client_id", sa.String(), nullable=True),
        sa.Column("client_secret", sa.String(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("service_account_json", sa.Text(), nullable=True),
        sa.Column("recursive", sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column("sync_mode", sa.String(), nullable=True, server_default="manual"),
        sa.Column("auto_publish", sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column("rules", sa.JSON(), nullable=True),
        sa.Column("default_category", sa.String(), nullable=True),
        sa.Column("default_type", sa.String(), nullable=True, server_default="policy"),
        sa.Column("default_access", sa.String(), nullable=True, server_default="key_required"),
        sa.Column("status", sa.String(), nullable=True, server_default="connected"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_summary", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_drive_connections_vendor_id", "drive_connections", ["vendor_id"])

    op.create_table(
        "drive_files",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("connection_id", sa.String(), nullable=False),
        sa.Column("vendor_id", sa.String(), nullable=False),
        sa.Column("drive_file_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=True),
        sa.Column("mime_type", sa.String(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("md5", sa.String(), nullable=True),
        sa.Column("modified_time", sa.String(), nullable=True),
        sa.Column("web_view_link", sa.String(), nullable=True),
        sa.Column("decision", sa.String(), nullable=True, server_default="pending"),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exclude_reason", sa.String(), nullable=True),
        sa.Column("proposed_type", sa.String(), nullable=True),
        sa.Column("proposed_title", sa.String(), nullable=True),
        sa.Column("proposed_category", sa.String(), nullable=True),
        sa.Column("proposed_access", sa.String(), nullable=True),
        sa.Column("matched_rule", sa.String(), nullable=True),
        sa.Column("artifact_id", sa.String(), nullable=True),
        sa.Column("synced_md5", sa.String(), nullable=True),
        sa.Column("synced_modified_time", sa.String(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("missing_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["connection_id"], ["drive_connections.id"]),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_drive_files_connection_id", "drive_files", ["connection_id"])
    op.create_index("ix_drive_files_vendor_id", "drive_files", ["vendor_id"])
    op.create_index("ix_drive_files_drive_file_id", "drive_files", ["drive_file_id"])
    op.create_index("ix_drive_files_artifact_id", "drive_files", ["artifact_id"])


def downgrade() -> None:
    op.drop_index("ix_drive_files_artifact_id", table_name="drive_files")
    op.drop_index("ix_drive_files_drive_file_id", table_name="drive_files")
    op.drop_index("ix_drive_files_vendor_id", table_name="drive_files")
    op.drop_index("ix_drive_files_connection_id", table_name="drive_files")
    op.drop_table("drive_files")
    op.drop_index("ix_drive_connections_vendor_id", table_name="drive_connections")
    op.drop_table("drive_connections")

    op.drop_index("ix_oscal_subscriptions_access_key_id", table_name="oscal_subscriptions")
    op.drop_index("ix_oscal_subscriptions_vendor_id", table_name="oscal_subscriptions")
    op.drop_table("oscal_subscriptions")
    op.drop_index("ix_oscal_changes_vendor_sequence", table_name="oscal_changes")
    op.drop_index("ix_oscal_changes_sequence", table_name="oscal_changes")
    op.drop_index("ix_oscal_changes_vendor_id", table_name="oscal_changes")
    op.drop_table("oscal_changes")

    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.drop_column("resource_display")
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.drop_column("source_ref")
        batch_op.drop_column("source")
        batch_op.drop_column("hidden")
        batch_op.drop_column("featured")
        batch_op.drop_column("position")
        batch_op.drop_column("description")
