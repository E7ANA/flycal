from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(20), default="blue")
    # Brain: priority for double-period scheduling (0-100, null = auto from hours)
    double_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Morning priority: 0-100, higher = more important to schedule early in day
    morning_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Force all lessons to be doubles (even hours = all doubles, odd = doubles + 1 single)
    always_double: Mapped[bool] = mapped_column(Boolean, default=False)
    # Blocked timeslots for this subject (e.g. "no sports on Sunday")
    blocked_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    # Limit to at most 1 lesson in the last 2 periods of each day (per class)
    limit_last_periods: Mapped[bool] = mapped_column(Boolean, default=False)
    # Hide from solver (keep data but don't schedule)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    # Linked subject group: subjects with same link_group are treated as one for daily limits
    link_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Max combined hours per day for all subjects in the same link_group (per class)
    link_group_max_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Max lessons per day for this subject (per class). null = use global default (2)
    max_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shahaf_id: Mapped[str | None] = mapped_column(String(50), nullable=True)


class SubjectRequirement(Base):
    __tablename__ = "subject_requirements"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    class_group_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    teacher_id: Mapped[int | None] = mapped_column(
        ForeignKey("teachers.id"), nullable=True
    )
    hours_per_week: Mapped[int] = mapped_column(Integer)
    is_grouped: Mapped[bool] = mapped_column(Boolean, default=False)
    grouping_cluster_id: Mapped[int | None] = mapped_column(
        ForeignKey("grouping_clusters.id"), nullable=True
    )
    is_external: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    blocked_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    co_teacher_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Force lessons to always come in consecutive pairs (double periods) — LEGACY, use consecutive_count
    always_double: Mapped[bool] = mapped_column(Boolean, default=False)
    # Consecutive block size: 2 = doubles, 3 = triples, null = no requirement
    consecutive_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Consecutive mode: "hard" = must, "soft" = preference, null = use always_double fallback
    consecutive_mode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Per-requirement morning priority override (0-100, null = use subject default)
    morning_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Allow teacher to be scheduled elsewhere at the same timeslot (skip no-overlap)
    allow_overlap: Mapped[bool] = mapped_column(Boolean, default=False)
    # Hide from solver (keep data but don't schedule this specific requirement)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    # Shahaf StudyItem ID for roundtrip export
    shahaf_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    class_group: Mapped["ClassGroup"] = relationship(
        back_populates="subject_requirements",
        foreign_keys=[class_group_id],
    )
    subject: Mapped["Subject"] = relationship()
    teacher: Mapped["Teacher | None"] = relationship()


from app.models.class_group import ClassGroup  # noqa: E402, F401
from app.models.teacher import Teacher  # noqa: E402, F401
