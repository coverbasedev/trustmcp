"""trust center sections: badges, controls, data types, faq, updates, subscribers,
agreements, plus resource categories and richer access requests.

Revision ID: a1b2c3d4e5f6
Revises: 96c386921b05
Create Date: 2026-06-08 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "96c386921b05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- new columns on existing tables ---
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("category", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("expiry_notified_at", sa.DateTime(timezone=True), nullable=True)
        )

    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "dpa_self_serve", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch_op.add_column(sa.Column("dpa_intro", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("dpa_template_id", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("controls_updated_at", sa.DateTime(timezone=True), nullable=True)
        )

    with op.batch_alter_table("subprocessors", schema=None) as batch_op:
        batch_op.add_column(sa.Column("category", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("logo_url", sa.String(), nullable=True))

    with op.batch_alter_table("key_requests", schema=None) as batch_op:
        batch_op.add_column(sa.Column("requester_company", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("reason", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("artifact_ids", sa.JSON(), nullable=True))

    # --- new tables ---
    op.create_table(
        "compliance_badges",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", sa.String(), sa.ForeignKey("vendors.id"), index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("standard", sa.String(), nullable=True),
        sa.Column("logo_url", sa.String(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "controls",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", sa.String(), sa.ForeignKey("vendors.id"), index=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="operating"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "data_types",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", sa.String(), sa.ForeignKey("vendors.id"), index=True),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("collected", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "faq_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", sa.String(), sa.ForeignKey("vendors.id"), index=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "updates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", sa.String(), sa.ForeignKey("vendors.id"), index=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("published_at", sa.Date(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_table(
        "subscribers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", sa.String(), sa.ForeignKey("vendors.id"), index=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="subscribed"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_table(
        "agreements",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("vendor_id", sa.String(), sa.ForeignKey("vendors.id"), index=True),
        sa.Column("type", sa.String(), nullable=False, server_default="dpa"),
        sa.Column("company_name", sa.String(), nullable=False),
        sa.Column("signer_name", sa.String(), nullable=False),
        sa.Column("signer_email", sa.String(), nullable=False),
        sa.Column("signer_title", sa.String(), nullable=True),
        sa.Column("contact_details", sa.Text(), nullable=True),
        sa.Column("address", sa.JSON(), nullable=True),
        sa.Column("doing_business_as", sa.String(), nullable=True),
        sa.Column("registration_number", sa.String(), nullable=True),
        sa.Column("subscribe_email", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="submitted"),
        sa.Column("envelope_id", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("agreements")
    op.drop_table("subscribers")
    op.drop_table("updates")
    op.drop_table("faq_entries")
    op.drop_table("data_types")
    op.drop_table("controls")
    op.drop_table("compliance_badges")
    with op.batch_alter_table("key_requests", schema=None) as batch_op:
        batch_op.drop_column("artifact_ids")
        batch_op.drop_column("reason")
        batch_op.drop_column("requester_company")
    with op.batch_alter_table("subprocessors", schema=None) as batch_op:
        batch_op.drop_column("logo_url")
        batch_op.drop_column("category")
    with op.batch_alter_table("vendors", schema=None) as batch_op:
        batch_op.drop_column("controls_updated_at")
        batch_op.drop_column("dpa_template_id")
        batch_op.drop_column("dpa_intro")
        batch_op.drop_column("dpa_self_serve")
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.drop_column("expiry_notified_at")
        batch_op.drop_column("category")
