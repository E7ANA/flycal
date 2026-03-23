from pydantic import BaseModel


class GroupingClusterCreate(BaseModel):
    school_id: int
    name: str
    subject_id: int
    grade_id: int | None = None
    source_class_ids: list[int] = []
    cluster_type: str = "REGULAR"
    # For SHARED_LESSON auto-track creation:
    teacher_id: int | None = None
    hours_per_week: int | None = None


class GroupingClusterUpdate(BaseModel):
    name: str | None = None
    subject_id: int | None = None
    grade_id: int | None = None
    source_class_ids: list[int] | None = None
    cluster_type: str | None = None
    # For SHARED_LESSON: sync the single track
    teacher_id: int | None = None
    hours_per_week: int | None = None
    consecutive_count: int | None = None
    consecutive_mode: str | None = None


class TrackSummary(BaseModel):
    id: int
    name: str
    teacher_id: int | None
    hours_per_week: int

    model_config = {"from_attributes": True}


class GroupingClusterRead(BaseModel):
    id: int
    school_id: int
    name: str
    subject_id: int
    grade_id: int | None = None
    source_class_ids: list[int] = []
    cluster_type: str = "REGULAR"
    consecutive_count: int | None = None
    consecutive_mode: str | None = None
    tracks: list[TrackSummary] = []

    model_config = {"from_attributes": True}


class PinnedSlot(BaseModel):
    day: str
    period: int


class TrackCreate(BaseModel):
    name: str
    cluster_id: int
    teacher_id: int | None = None
    hours_per_week: int
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    allow_overlap: bool = False


class TrackUpdate(BaseModel):
    name: str | None = None
    teacher_id: int | None = None
    hours_per_week: int | None = None
    link_group: int | None = None
    source_class_id: int | None = None
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    allow_overlap: bool | None = None


class TrackRead(BaseModel):
    id: int
    name: str
    cluster_id: int
    teacher_id: int | None
    hours_per_week: int
    requirement_id: int | None = None
    link_group: int | None = None
    source_class_id: int | None = None
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    allow_overlap: bool

    model_config = {"from_attributes": True}


class TrackFromRequirement(BaseModel):
    cluster_id: int
    requirement_id: int


class TrackToRequirement(BaseModel):
    class_group_id: int | None = None  # Required only if track has no requirement_id
