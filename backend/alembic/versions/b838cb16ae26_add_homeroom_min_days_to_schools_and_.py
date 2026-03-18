"""add homeroom_min_days to schools and require_consecutive to tracks

Revision ID: b838cb16ae26
Revises: d4e5f6a7b8c9
Create Date: 2026-03-12 21:35:10.578778
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b838cb16ae26'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('schools', sa.Column('homeroom_min_days', sa.Integer(), nullable=True, server_default='4'))
    op.add_column('tracks', sa.Column('require_consecutive', sa.Boolean(), nullable=True, server_default='0'))


def downgrade() -> None:
    op.drop_column('tracks', 'require_consecutive')
    op.drop_column('schools', 'homeroom_min_days')
