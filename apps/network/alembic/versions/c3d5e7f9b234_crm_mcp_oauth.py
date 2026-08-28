"""CRM-over-MCP OAuth (client-credentials) fields

Adds per-vendor MCP auth method + OAuth client-credentials fields so a trust
center can connect its CRM MCP server via OAuth as well as a static bearer token.

Revision ID: c3d5e7f9b234
Revises: b2c4e6f8a012
Create Date: 2026-06-08 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c3d5e7f9b234"
down_revision: str | None = "b2c4e6f8a012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_COLUMNS = ("crm_mcp_auth", "crm_mcp_client_id", "crm_mcp_client_secret", "crm_mcp_token_url")


def upgrade() -> None:
    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.add_column(sa.Column("crm_mcp_auth", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("crm_mcp_client_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("crm_mcp_client_secret", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("crm_mcp_token_url", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("vendors", schema=None) as batch_op:
        for column in reversed(_COLUMNS):
            batch_op.drop_column(column)
