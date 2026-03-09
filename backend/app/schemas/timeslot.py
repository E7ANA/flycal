from pydantic import BaseModel

from app.models.timeslot import DayOfWeek


class TimeSlotCreate(BaseModel):
    school_id: int
    day: DayOfWeek
    period: int
    is_available: bool = True


class TimeSlotUpdate(BaseModel):
    is_available: bool | None = None


class TimeSlotBatchItem(BaseModel):
    id: int
    is_available: bool


class TimeSlotBatchUpdate(BaseModel):
    updates: list[TimeSlotBatchItem]


class TimeSlotRead(BaseModel):
    id: int
    school_id: int
    day: DayOfWeek
    period: int
    is_available: bool

    model_config = {"from_attributes": True}
