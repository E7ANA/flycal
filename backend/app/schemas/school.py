from pydantic import BaseModel

from app.models.school import WeekStartDay


class SchoolCreate(BaseModel):
    name: str
    days_per_week: int = 5
    periods_per_day: int = 8
    period_duration_minutes: int = 45
    break_slots: list[int] = []
    week_start_day: WeekStartDay = WeekStartDay.SUNDAY
    periods_per_day_map: dict[str, int] | None = None


class SchoolUpdate(BaseModel):
    name: str | None = None
    days_per_week: int | None = None
    periods_per_day: int | None = None
    period_duration_minutes: int | None = None
    break_slots: list[int] | None = None
    week_start_day: WeekStartDay | None = None
    periods_per_day_map: dict[str, int] | None = None


class SchoolRead(BaseModel):
    id: int
    name: str
    days_per_week: int
    periods_per_day: int
    period_duration_minutes: int
    break_slots: list[int]
    week_start_day: WeekStartDay
    periods_per_day_map: dict[str, int] | None

    model_config = {"from_attributes": True}
