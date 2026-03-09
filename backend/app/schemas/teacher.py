from pydantic import BaseModel


class BlockedSlot(BaseModel):
    day: str
    period: int


class TeacherCreate(BaseModel):
    school_id: int
    name: str
    max_hours_per_week: int = 40
    min_hours_per_week: int | None = None
    employment_percentage: float | None = None
    subject_ids: list[int] = []
    is_coordinator: bool = False
    homeroom_class_id: int | None = None
    is_management: bool = False
    is_counselor: bool = False
    is_principal: bool = False
    is_pedagogical_coordinator: bool = False
    is_director: bool = False
    blocked_slots: list[BlockedSlot] = []


class TeacherUpdate(BaseModel):
    name: str | None = None
    max_hours_per_week: int | None = None
    min_hours_per_week: int | None = None
    employment_percentage: float | None = None
    subject_ids: list[int] | None = None
    is_coordinator: bool | None = None
    homeroom_class_id: int | None = None
    is_management: bool | None = None
    is_counselor: bool | None = None
    is_principal: bool | None = None
    is_pedagogical_coordinator: bool | None = None
    is_director: bool | None = None
    blocked_slots: list[BlockedSlot] | None = None


class TeacherRead(BaseModel):
    id: int
    school_id: int
    name: str
    max_hours_per_week: int
    min_hours_per_week: int | None
    employment_percentage: float | None
    subject_ids: list[int] = []
    is_coordinator: bool
    homeroom_class_id: int | None
    is_management: bool
    is_counselor: bool
    is_principal: bool
    is_pedagogical_coordinator: bool
    is_director: bool
    blocked_slots: list[BlockedSlot] = []

    model_config = {"from_attributes": True}
