"""add is_secondary to tracks and pinned_slots to subject_requirements

Revision ID: ea8d3466f039
Revises: fcffaa543fe0
Create Date: 2026-03-03 13:34:23.118257
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ea8d3466f039'
down_revision: Union[str, None] = 'fcffaa543fe0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pinned_slots may already exist from partial migration
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sr_cols = {c["name"] for c in inspector.get_columns("subject_requirements")}
    track_cols = {c["name"] for c in inspector.get_columns("tracks")}

    if "pinned_slots" not in sr_cols:
        op.add_column('subject_requirements', sa.Column('pinned_slots', sa.JSON(), nullable=True))
    if "is_secondary" not in track_cols:
        op.add_column('tracks', sa.Column('is_secondary', sa.Boolean(), nullable=False, server_default=sa.text('0')))


def downgrade() -> None:
    op.drop_column('tracks', 'is_secondary')
    op.drop_column('subject_requirements', 'pinned_slots')
