"""per-vendor integration credentials (Docusign + CRM connection method)

Adds per-vendor Docusign credentials and a CRM connection method (api|mcp) with
MCP server fields, so each trust center can connect its own Docusign and CRM
rather than relying on the network-global config.

Revision ID: b2c4e6f8a012
Revises: a1b2c3d4e5f6
Create Date: 2026-06-08 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "b2c4e6f8a012"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_COLUMNS = (
    "crm_connection",
    "crm_mcp_url",
    "crm_mcp_token",
    "docusign_account_id",
    "docusign_integration_key",
    "docusign_user_id",
    "docusign_private_key",
    "docusign_auth_host",
    "docusign_base_uri",
    "docusign_connect_hmac_key",
)


def upgrade() -> None:
    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.add_column(sa.Column("crm_connection", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("crm_mcp_url", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("crm_mcp_token", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("docusign_account_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("docusign_integration_key", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("docusign_user_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("docusign_private_key", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("docusign_auth_host", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("docusign_base_uri", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("docusign_connect_hmac_key", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("vendors", schema=None) as batch_op:
        for column in reversed(_COLUMNS):
            batch_op.drop_column(column)
