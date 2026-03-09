from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models.timetable import SolutionStatus


class ScheduledLessonRead(BaseModel):
    id: int
    solution_id: int
    class_group_id: int | None
    track_id: int | None
    subject_id: int
    teacher_id: int
    day: str
    period: int
    room_id: int | None

    model_config = {"from_attributes": True}


class SolutionRead(BaseModel):
    id: int
    school_id: int
    created_at: datetime
    solve_time_seconds: float
    total_score: float
    score_breakdown: dict[str, Any] | None
    status: SolutionStatus
    scenario_name: str | None
    is_baseline: bool

    model_config = {"from_attributes": True}


class ScheduledMeetingRead(BaseModel):
    id: int
    solution_id: int
    meeting_id: int
    day: str
    period: int

    model_config = {"from_attributes": True}


class SolutionDetailRead(SolutionRead):
    lessons: list[ScheduledLessonRead] = []
    scheduled_meetings: list[ScheduledMeetingRead] = []


class TeacherSlotAnnotation(BaseModel):
    """A single annotated slot in a teacher's weekly schedule."""
    day: str
    period: int
    slot_type: str  # "frontal" | "meeting" | "שהייה" | "פרטני" | "חלון"
    subject_name: str | None = None
    class_name: str | None = None
    meeting_name: str | None = None


class TeacherPresenceRead(BaseModel):
    """Full Oz LaTmura presence breakdown for a teacher in a solution."""
    teacher_id: int
    teacher_name: str
    frontal_hours: int
    individual_hours: int   # פרטני = round(0.12 * F)
    staying_hours: int      # שהייה = round(0.4 * F)
    allowed_gaps: int       # F // 8
    actual_gaps: int
    slots: list[TeacherSlotAnnotation]
