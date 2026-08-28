"""Allow a Drive connection to exist before a folder is chosen

The click-through OAuth flow authorizes first and picks a folder second: Google
sends the owner back with a code, we store the resulting credentials, and only
then can we list their folders for them to choose from. That intermediate state
needs a connection row with credentials and no folder yet, so `folder_id`
becomes nullable and `status` gains "pending_folder".

Revision ID: b8c0d2e4f6a8
Revises: a7b9c1d3e5f7
Create Date: 2026-08-20 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "b8c0d2e4f6a8"
down_revision: str | None = "a7b9c1d3e5f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("drive_connections", schema=None) as batch_op:
        batch_op.alter_column("folder_id", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    # A row with no folder cannot satisfy NOT NULL, and it carries nothing worth
    # keeping — credentials without a folder never synced anything. Drop those
    # rows rather than fail the downgrade or invent a folder id.
    op.execute("DELETE FROM drive_connections WHERE folder_id IS NULL")
    with op.batch_alter_table("drive_connections", schema=None) as batch_op:
        batch_op.alter_column("folder_id", existing_type=sa.String(), nullable=False)
