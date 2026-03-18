import enum

from sqlalchemy import Boolean, Column, ForeignKey, Integer, JSON, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Many-to-many: Meeting <-> Teacher
meeting_teachers = Table(
    "meeting_teachers",
    Base.metadata,
    Column("meeting_id", Integer, ForeignKey("meetings.id"), primary_key=True),
    Column("teacher_id", Integer, ForeignKey("teachers.id"), primary_key=True),
)


class MeetingType(str, enum.Enum):
    HOMEROOM = "HOMEROOM"  # מחנכות
    COORDINATORS = "COORDINATORS"  # רכזים
    MANAGEMENT = "MANAGEMENT"  # ניהול
    CUSTOM = "CUSTOM"  # מותאם אישית
    PLENARY = "PLENARY"  # מליאה


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    name: Mapped[str] = mapped_column(String(200))
    meeting_type: Mapped[str] = mapped_column(String(20))
    hours_per_week: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    color: Mapped[str] = mapped_column(String(20), default="#8B5CF6")
    pinned_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    blocked_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    # When False, teacher attendance is flexible (SOFT) — not all teachers must be free
    is_mandatory_attendance: Mapped[bool] = mapped_column(Boolean, default=True)
    # Allow teacher to have lessons at the same time as this meeting (skip no-overlap)
    allow_overlap: Mapped[bool] = mapped_column(Boolean, default=False)
    # Force meeting hours to be scheduled in consecutive periods (e.g. double period)
    require_consecutive: Mapped[bool] = mapped_column(Boolean, default=False)
    # Teachers who MUST attend even when is_mandatory_attendance=False
    locked_teacher_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    # Alternative pinned slots — solver picks primary OR alternative (PLENARY only)
    alternative_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)

    teachers: Mapped[list["Teacher"]] = relationship(secondary=meeting_teachers)


from app.models.teacher import Teacher  # noqa: E402, F401
