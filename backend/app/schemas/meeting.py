from dataclasses import dataclass

from pydantic import BaseModel


@dataclass
class PinnedSlot:
    day: str
    period: int


class MeetingCreate(BaseModel):
    school_id: int
    name: str
    meeting_type: str  # HOMEROOM | COORDINATORS | MANAGEMENT | CUSTOM
    hours_per_week: int = 1
    is_active: bool = True
    color: str = "#8B5CF6"
    teacher_ids: list[int] = []
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    is_mandatory_attendance: bool = True
    allow_overlap: bool = False
    require_consecutive: bool = False
    locked_teacher_ids: list[int] | None = None
    alternative_slots: list[PinnedSlot] | None = None


class MeetingUpdate(BaseModel):
    name: str | None = None
    meeting_type: str | None = None
    hours_per_week: int | None = None
    is_active: bool | None = None
    color: str | None = None
    teacher_ids: list[int] | None = None
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    is_mandatory_attendance: bool | None = None
    allow_overlap: bool | None = None
    require_consecutive: bool | None = None
    locked_teacher_ids: list[int] | None = None
    alternative_slots: list[PinnedSlot] | None = None


class MeetingRead(BaseModel):
    id: int
    school_id: int
    name: str
    meeting_type: str
    hours_per_week: int
    is_active: bool
    color: str
    teacher_ids: list[int] = []
    pinned_slots: list[PinnedSlot] | None = None
    blocked_slots: list[PinnedSlot] | None = None
    is_mandatory_attendance: bool = True
    allow_overlap: bool = False
    require_consecutive: bool = False
    locked_teacher_ids: list[int] | None = None
    alternative_slots: list[PinnedSlot] | None = None

    model_config = {"from_attributes": True}
