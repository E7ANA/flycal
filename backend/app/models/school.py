import enum

from sqlalchemy import JSON, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WeekStartDay(str, enum.Enum):
    SUNDAY = "SUNDAY"
    MONDAY = "MONDAY"


class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    days_per_week: Mapped[int] = mapped_column(Integer, default=5)
    periods_per_day: Mapped[int] = mapped_column(Integer, default=8)
    period_duration_minutes: Mapped[int] = mapped_column(Integer, default=45)
    break_slots: Mapped[list] = mapped_column(JSON, default=list)
    week_start_day: Mapped[str] = mapped_column(
        Enum(WeekStartDay), default=WeekStartDay.SUNDAY
    )
    # Optional per-day period counts, e.g. {"SUNDAY": 8, "FRIDAY": 4}
    # When set, overrides periods_per_day for the specified days.
    periods_per_day_map: Mapped[dict | None] = mapped_column(JSON, nullable=True)
