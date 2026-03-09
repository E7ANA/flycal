import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class SolutionStatus(str, enum.Enum):
    OPTIMAL = "OPTIMAL"
    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"
    TIMEOUT = "TIMEOUT"


class Solution(Base):
    __tablename__ = "solutions"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    solve_time_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    total_score: Mapped[float] = mapped_column(Float, default=0.0)
    score_breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(Enum(SolutionStatus))
    scenario_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)

    lessons: Mapped[list["ScheduledLesson"]] = relationship(
        back_populates="solution", cascade="all, delete-orphan"
    )
    scheduled_meetings: Mapped[list["ScheduledMeeting"]] = relationship(
        back_populates="solution", cascade="all, delete-orphan"
    )


class ScheduledLesson(Base):
    __tablename__ = "scheduled_lessons"

    id: Mapped[int] = mapped_column(primary_key=True)
    solution_id: Mapped[int] = mapped_column(ForeignKey("solutions.id"))
    class_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("class_groups.id"), nullable=True
    )
    track_id: Mapped[int | None] = mapped_column(
        ForeignKey("tracks.id"), nullable=True
    )
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"))
    day: Mapped[str] = mapped_column(String(20))
    period: Mapped[int] = mapped_column(Integer)
    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("rooms.id"), nullable=True
    )

    solution: Mapped["Solution"] = relationship(back_populates="lessons")


class ScheduledMeeting(Base):
    __tablename__ = "scheduled_meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    solution_id: Mapped[int] = mapped_column(ForeignKey("solutions.id"))
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"))
    day: Mapped[str] = mapped_column(String(20))
    period: Mapped[int] = mapped_column(Integer)

    solution: Mapped["Solution"] = relationship(back_populates="scheduled_meetings")


class AllowedOverlap(Base):
    """Specific pair-based overlap approval.

    When a user approves an overlap between two items (e.g., a track and a
    meeting for the same teacher), a record is created here.  The solver's
    no-overlap constraint checks this table — only the specific pair is
    exempted, not a blanket 'allow everything' flag.
    """
    __tablename__ = "allowed_overlaps"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    item1_type: Mapped[str] = mapped_column(String(20))   # "requirement" | "track" | "meeting"
    item1_id: Mapped[int] = mapped_column(Integer)
    item2_type: Mapped[str] = mapped_column(String(20))
    item2_id: Mapped[int] = mapped_column(Integer)
