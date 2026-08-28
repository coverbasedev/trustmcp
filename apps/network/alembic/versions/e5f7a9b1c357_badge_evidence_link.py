"""Link a compliance badge to its evidence artifact

Adds a nullable `evidence_artifact_id` to compliance_badges so a certification
can point at the artifact that proves it (the SOC 2 report, ISO cert, …).

Revision ID: e5f7a9b1c357
Revises: d4e6f8a0b246
Create Date: 2026-06-09 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "e5f7a9b1c357"
down_revision: str | None = "d4e6f8a0b246"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("compliance_badges", schema=None) as batch_op:
        batch_op.add_column(sa.Column("evidence_artifact_id", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("compliance_badges", schema=None) as batch_op:
        batch_op.drop_column("evidence_artifact_id")
