from pydantic import BaseModel


class SubjectCreate(BaseModel):
    school_id: int
    name: str
    color: str = "#3B82F6"
    double_priority: int | None = None
    morning_priority: int | None = None
    always_double: bool = False
    blocked_slots: list[dict] | None = None


class SubjectUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    double_priority: int | None = None
    morning_priority: int | None = None
    always_double: bool | None = None
    blocked_slots: list[dict] | None = None


class SubjectRead(BaseModel):
    id: int
    school_id: int
    name: str
    color: str
    double_priority: int | None = None
    morning_priority: int | None = None
    always_double: bool
    blocked_slots: list[dict] | None = None

    model_config = {"from_attributes": True}


class PinnedSlot(BaseModel):
    day: str
    period: int


class SubjectRequirementCreate(BaseModel):
    school_id: int
    class_group_id: int
    subject_id: int
    teacher_id: int | None = None
    hours_per_week: int
    is_grouped: bool = False
    grouping_cluster_id: int | None = None
    is_external: bool = False
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    co_teacher_ids: list[int] | None = None
    always_double: bool = False
    morning_priority: int | None = None
    allow_overlap: bool = False


class SubjectRequirementUpdate(BaseModel):
    teacher_id: int | None = None
    hours_per_week: int | None = None
    is_grouped: bool | None = None
    grouping_cluster_id: int | None = None
    is_external: bool | None = None
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    co_teacher_ids: list[int] | None = None
    always_double: bool | None = None
    morning_priority: int | None = None
    allow_overlap: bool | None = None


class SubjectRequirementRead(BaseModel):
    id: int
    school_id: int
    class_group_id: int
    subject_id: int
    teacher_id: int | None
    hours_per_week: int
    is_grouped: bool
    grouping_cluster_id: int | None
    is_external: bool
    pinned_slots: list[PinnedSlot] | None
    blocked_slots: list[PinnedSlot] | None
    co_teacher_ids: list[int] | None
    always_double: bool
    morning_priority: int | None
    allow_overlap: bool

    model_config = {"from_attributes": True}
