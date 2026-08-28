"""Compliance badge certification validity dates

Adds optional issued_on / valid_until to compliance_badges so a certification can
show when it was attained and when it expires.

Revision ID: f6a8b0c2d468
Revises: e5f7a9b1c357
Create Date: 2026-06-09 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "f6a8b0c2d468"
down_revision: str | None = "e5f7a9b1c357"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("compliance_badges", schema=None) as batch_op:
        batch_op.add_column(sa.Column("issued_on", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("valid_until", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("compliance_badges", schema=None) as batch_op:
        batch_op.drop_column("valid_until")
        batch_op.drop_column("issued_on")
