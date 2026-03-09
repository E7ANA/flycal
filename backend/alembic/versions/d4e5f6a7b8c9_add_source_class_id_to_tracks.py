"""add source_class_id to tracks

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-03-04 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tracks') as batch_op:
        batch_op.add_column(
            sa.Column('source_class_id', sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table('tracks') as batch_op:
        batch_op.drop_column('source_class_id')
