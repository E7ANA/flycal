import enum

from sqlalchemy import Boolean, Column, ForeignKey, Integer, JSON, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ClusterType(str, enum.Enum):
    REGULAR = "REGULAR"
    CROSS_GRADE = "CROSS_GRADE"
    SHARED_LESSON = "SHARED_LESSON"

# Many-to-many: GroupingCluster <-> ClassGroup (source classes)
cluster_source_classes = Table(
    "cluster_source_classes",
    Base.metadata,
    Column("cluster_id", Integer, ForeignKey("grouping_clusters.id"), primary_key=True),
    Column("class_group_id", Integer, ForeignKey("class_groups.id"), primary_key=True),
)


class Grade(Base):
    __tablename__ = "grades"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    name: Mapped[str] = mapped_column(String(50))
    level: Mapped[int] = mapped_column(Integer)

    class_groups: Mapped[list["ClassGroup"]] = relationship(back_populates="grade")


class ClassGroup(Base):
    __tablename__ = "class_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    name: Mapped[str] = mapped_column(String(100))
    grade_id: Mapped[int] = mapped_column(ForeignKey("grades.id"))
    # When True: homeroom teacher MUST teach this class every day she's at school (HARD)
    # When False (default): preferred but not mandatory (SOFT)
    homeroom_daily_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # Rich homeroom config: meeting days, morning opening, hard/soft, weights
    # {
    #   "meet_days_count": 4,  "meet_type": "HARD"|"SOFT",  "meet_weight": 80,
    #   "open_sunday": true,  "open_sunday_type": "HARD"|"SOFT",  "open_sunday_weight": 90,
    #   "open_other": true,  "open_other_weight": 60
    # }
    homeroom_config: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
    shahaf_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    grade: Mapped["Grade"] = relationship(back_populates="class_groups")
    subject_requirements: Mapped[list["SubjectRequirement"]] = relationship(
        back_populates="class_group",
        foreign_keys="SubjectRequirement.class_group_id",
    )


class GroupingCluster(Base):
    __tablename__ = "grouping_clusters"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    name: Mapped[str] = mapped_column(String(200))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    grade_id: Mapped[int | None] = mapped_column(ForeignKey("grades.id"), nullable=True)
    cluster_type: Mapped[str] = mapped_column(String(20), default=ClusterType.REGULAR.value)
    # Consecutive block settings for all tracks in this cluster
    consecutive_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    consecutive_mode: Mapped[str | None] = mapped_column(String(10), nullable=True)

    subject: Mapped["Subject"] = relationship()
    grade: Mapped["Grade | None"] = relationship()
    source_classes: Mapped[list["ClassGroup"]] = relationship(
        secondary=cluster_source_classes
    )
    tracks: Mapped[list["Track"]] = relationship(back_populates="cluster")


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    cluster_id: Mapped[int] = mapped_column(ForeignKey("grouping_clusters.id"))
    teacher_id: Mapped[int | None] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    hours_per_week: Mapped[int] = mapped_column(Integer)
    requirement_id: Mapped[int | None] = mapped_column(
        ForeignKey("subject_requirements.id"), nullable=True
    )
    link_group: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_class_id: Mapped[int | None] = mapped_column(
        ForeignKey("class_groups.id"), nullable=True
    )
    pinned_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    blocked_slots: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    # Allow teacher to be scheduled elsewhere at the same timeslot (skip no-overlap)
    allow_overlap: Mapped[bool] = mapped_column(Boolean, default=False)

    cluster: Mapped["GroupingCluster"] = relationship(back_populates="tracks")
    teacher: Mapped["Teacher | None"] = relationship()
    requirement: Mapped["SubjectRequirement | None"] = relationship()
    source_class: Mapped["ClassGroup | None"] = relationship()


# Avoid circular import issues — these are resolved at runtime by SQLAlchemy
# via string references in relationship()
from app.models.subject import Subject, SubjectRequirement  # noqa: E402, F401
from app.models.teacher import Teacher  # noqa: E402, F401
