"""add teacher roles: coordinator, homeroom, management

Revision ID: 8ef2ec7c524b
Revises: 937bb2e92653
Create Date: 2026-03-03 02:47:56.483030
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8ef2ec7c524b'
down_revision: Union[str, None] = '937bb2e92653'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('teachers', sa.Column('is_coordinator', sa.Boolean(), nullable=False, server_default=sa.text('0')))
    op.add_column('teachers', sa.Column('homeroom_class_id', sa.Integer(), nullable=True))
    op.add_column('teachers', sa.Column('is_management', sa.Boolean(), nullable=False, server_default=sa.text('0')))


def downgrade() -> None:
    op.drop_column('teachers', 'is_management')
    op.drop_column('teachers', 'homeroom_class_id')
    op.drop_column('teachers', 'is_coordinator')
