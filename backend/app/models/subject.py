from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(20), default="#3B82F6")
    # Brain: priority for double-period scheduling (0-100, null = auto from hours)
    double_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Morning priority: 0-100, higher = more important to schedule early in day
    morning_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Force all lessons to be doubles (even hours = all doubles, odd = doubles + 1 single)
    always_double: Mapped[bool] = mapped_column(Boolean, default=False)
    # Blocked timeslots for this subject (e.g. "no sports on Sunday")
    blocked_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)


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
    # Force lessons to always come in consecutive pairs (double periods)
    always_double: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-requirement morning priority override (0-100, null = use subject default)
    morning_priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Allow teacher to be scheduled elsewhere at the same timeslot (skip no-overlap)
    allow_overlap: Mapped[bool] = mapped_column(Boolean, default=False)

    class_group: Mapped["ClassGroup"] = relationship(
        back_populates="subject_requirements",
        foreign_keys=[class_group_id],
    )
    subject: Mapped["Subject"] = relationship()
    teacher: Mapped["Teacher | None"] = relationship()


from app.models.class_group import ClassGroup  # noqa: E402, F401
from app.models.teacher import Teacher  # noqa: E402, F401
