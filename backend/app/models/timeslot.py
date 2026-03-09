import enum

from sqlalchemy import Boolean, Enum, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DayOfWeek(str, enum.Enum):
    SUNDAY = "SUNDAY"
    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"


class TimeSlot(Base):
    __tablename__ = "timeslots"

    id: Mapped[int] = mapped_column(primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"))
    day: Mapped[str] = mapped_column(Enum(DayOfWeek))
    period: Mapped[int] = mapped_column(Integer)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
