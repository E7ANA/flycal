"""add requirement_id to tracks

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-04 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tracks') as batch_op:
        batch_op.add_column(
            sa.Column('requirement_id', sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table('tracks') as batch_op:
        batch_op.drop_column('requirement_id')
