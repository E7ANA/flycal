"""add teacher blocked_slots

Revision ID: 22ebfc8d71c8
Revises: 87a96633d8ef
Create Date: 2026-03-03 03:35:49.060794
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '22ebfc8d71c8'
down_revision: Union[str, None] = '87a96633d8ef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('teachers', sa.Column('blocked_slots', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('teachers', 'blocked_slots')
