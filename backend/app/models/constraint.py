import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class ConstraintCategory(str, enum.Enum):
    TEACHER = "TEACHER"
    SUBJECT = "SUBJECT"
    CLASS = "CLASS"
    GROUPING = "GROUPING"
    GLOBAL = "GLOBAL"


class ConstraintType(str, enum.Enum):
    HARD = "HARD"
    SOFT = "SOFT"


class RuleType(str, enum.Enum):
    # Time rules
    BLOCK_TIMESLOT = "BLOCK_TIMESLOT"
    BLOCK_DAY = "BLOCK_DAY"
    BLOCK_TIME_RANGE = "BLOCK_TIME_RANGE"
    PREFER_TIME_RANGE = "PREFER_TIME_RANGE"
    PREFER_TIMESLOT = "PREFER_TIMESLOT"
    AVOID_LAST_PERIOD = "AVOID_LAST_PERIOD"
    # Distribution rules
    MAX_PER_DAY = "MAX_PER_DAY"
    MIN_DAYS_SPREAD = "MIN_DAYS_SPREAD"
    NO_CONSECUTIVE_DAYS = "NO_CONSECUTIVE_DAYS"
    REQUIRE_CONSECUTIVE_PERIODS = "REQUIRE_CONSECUTIVE_PERIODS"
    SAME_DAY_GROUPING = "SAME_DAY_GROUPING"
    NOT_SAME_DAY_AS = "NOT_SAME_DAY_AS"
    # Load rules
    MAX_TEACHING_HOURS_PER_DAY = "MAX_TEACHING_HOURS_PER_DAY"
    MIN_TEACHING_HOURS_PER_DAY = "MIN_TEACHING_HOURS_PER_DAY"
    MAX_TEACHING_DAYS = "MAX_TEACHING_DAYS"
    MIN_FREE_DAYS = "MIN_FREE_DAYS"
    BALANCED_DAILY_LOAD = "BALANCED_DAILY_LOAD"
    # Gap rules
    NO_GAPS = "NO_GAPS"
    MAX_GAPS_PER_DAY = "MAX_GAPS_PER_DAY"
    MAX_GAPS_PER_WEEK = "MAX_GAPS_PER_WEEK"
    # Grouping rules
    SYNC_TRACKS = "SYNC_TRACKS"
    SYNC_TEACHER_CLASSES = "SYNC_TEACHER_CLASSES"
    GROUPING_EXTRA_AT_END = "GROUPING_EXTRA_AT_END"
    # Global rules
    EARLY_FINISH = "EARLY_FINISH"
    MINIMIZE_TEACHER_DAYS = "MINIMIZE_TEACHER_DAYS"
    CLASS_DAY_LENGTH_LIMIT = "CLASS_DAY_LENGTH_LIMIT"
    TEACHER_FIRST_LAST_PREFERENCE = "TEACHER_FIRST_LAST_PREFERENCE"
    # Compact day
    COMPACT_SCHOOL_DAY = "COMPACT_SCHOOL_DAY"
    # Homeroom
    HOMEROOM_EARLY = "HOMEROOM_EARLY"
    # Class end time
    CLASS_END_TIME = "CLASS_END_TIME"
    # Teacher day end limit
    TEACHER_DAY_END_LIMIT = "TEACHER_DAY_END_LIMIT"
    # Teacher preferred free day
    TEACHER_PREFERRED_FREE_DAY = "TEACHER_PREFERRED_FREE_DAY"
    # Daily core subjects — each day must contain at least one of the listed subjects.
    # parameters: { "subject_ids": [int, ...] }
    # target: GRADE (applies to all classes in the grade) or CLASS
    DAILY_CORE_SUBJECTS = "DAILY_CORE_SUBJECTS"


class TargetType(str, enum.Enum):
    TEACHER = "TEACHER"
    SUBJECT = "SUBJECT"
    CLASS = "CLASS"
    GRADE = "GRADE"
    GROUPING = "GROUPING"
    ALL = "ALL"


class Constraint(Base):
    __tablename__ = "constraints"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Classification
    category: Mapped[str] = mapped_column(Enum(ConstraintCategory))
    type: Mapped[str] = mapped_column(Enum(ConstraintType))
    weight: Mapped[int] = mapped_column(Integer, default=50)

    # Rule definition
    rule_type: Mapped[str] = mapped_column(Enum(RuleType))
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)

    # Target
    target_type: Mapped[str] = mapped_column(Enum(TargetType))
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
