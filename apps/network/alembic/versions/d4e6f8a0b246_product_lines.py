"""Multiple product lines per vendor + per-document product association

Adds a JSON `products` list to vendors (each {"id", "name"}) so a trust center
can publish any number of product lines, and a JSON `product_ids` list to
artifacts so a document can be associated with zero or more of those products.

Revision ID: d4e6f8a0b246
Revises: c3d5e7f9b234
Create Date: 2026-06-08 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d4e6f8a0b246"
down_revision: str | None = "c3d5e7f9b234"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("products", sa.JSON(), nullable=False, server_default="[]")
        )
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("product_ids", sa.JSON(), nullable=False, server_default="[]")
        )


def downgrade() -> None:
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.drop_column("product_ids")
    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.drop_column("products")
