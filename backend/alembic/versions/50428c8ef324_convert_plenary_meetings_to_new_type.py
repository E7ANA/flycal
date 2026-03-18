"""convert_plenary_meetings_to_new_type

Convert existing meetings named 'מליאה' (or similar) from their current
meeting_type to the new PLENARY type.  All assigned teachers become
locked (mandatory attendance) and is_mandatory_attendance is set to False
so the per-teacher locked/preferred model kicks in.

Revision ID: 50428c8ef324
Revises: b838cb16ae26
Create Date: 2026-03-15 08:32:06.717133
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import json


# revision identifiers, used by Alembic.
revision: str = '50428c8ef324'
down_revision: Union[str, None] = 'b838cb16ae26'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Find meetings whose name contains "מליאה" that are NOT already PLENARY
    meetings = conn.execute(
        sa.text(
            "SELECT id, name, is_mandatory_attendance, locked_teacher_ids "
            "FROM meetings WHERE name LIKE :pattern AND meeting_type != 'PLENARY'"
        ),
        {"pattern": "%מליאה%"},
    ).fetchall()

    for m in meetings:
        m_id = m[0]

        # Get all teacher IDs for this meeting
        teacher_rows = conn.execute(
            sa.text("SELECT teacher_id FROM meeting_teachers WHERE meeting_id = :mid"),
            {"mid": m_id},
        ).fetchall()
        all_teacher_ids = [r[0] for r in teacher_rows]

        # All teachers become locked (mandatory) by default
        locked_ids = json.dumps(all_teacher_ids) if all_teacher_ids else "[]"

        conn.execute(
            sa.text(
                "UPDATE meetings SET "
                "meeting_type = 'PLENARY', "
                "is_mandatory_attendance = 0, "
                "locked_teacher_ids = :locked "
                "WHERE id = :mid"
            ),
            {"mid": m_id, "locked": locked_ids},
        )


def downgrade() -> None:
    conn = op.get_bind()
    # Revert PLENARY meetings back to CUSTOM
    conn.execute(
        sa.text(
            "UPDATE meetings SET "
            "meeting_type = 'CUSTOM', "
            "is_mandatory_attendance = 1 "
            "WHERE meeting_type = 'PLENARY'"
        )
    )
