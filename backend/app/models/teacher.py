from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, JSON, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Many-to-many: Teacher <-> Subject (qualifications)
teacher_subjects = Table(
    "teacher_subjects",
    Base.metadata,
    Column("teacher_id", Integer, ForeignKey("teachers.id"), primary_key=True),
    Column("subject_id", Integer, ForeignKey("subjects.id"), primary_key=True),
)


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    name: Mapped[str] = mapped_column(String(200))
    max_hours_per_week: Mapped[int] = mapped_column(Integer, default=40)
    min_hours_per_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    employment_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    rubrica_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_work_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_work_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Roles
    is_coordinator: Mapped[bool] = mapped_column(Boolean, default=False)
    homeroom_class_id: Mapped[int | None] = mapped_column(
        ForeignKey("class_groups.id"), nullable=True
    )
    is_management: Mapped[bool] = mapped_column(Boolean, default=False)
    is_counselor: Mapped[bool] = mapped_column(Boolean, default=False)
    is_principal: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pedagogical_coordinator: Mapped[bool] = mapped_column(Boolean, default=False)
    is_director: Mapped[bool] = mapped_column(Boolean, default=False)

    # Shahaf hour breakdown (informational, not used by solver)
    pirtani_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    shehiya_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    tafkid_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    bagrut_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    chinuch_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Transport: prefer early finish (0/null = off, higher = stronger preference)
    transport_priority: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)

    # Blocked timeslots: [{"day": "SUNDAY", "period": 3}, ...]
    blocked_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    # External ID from Shahaf system (for roundtrip export)
    shahaf_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    subjects: Mapped[list["Subject"]] = relationship(secondary=teacher_subjects)
    homeroom_class: Mapped["ClassGroup | None"] = relationship()


from app.models.class_group import ClassGroup  # noqa: E402, F401
from app.models.subject import Subject  # noqa: E402, F401
