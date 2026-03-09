from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.meeting import Meeting, MeetingType
from app.models.teacher import Teacher
from app.models.timeslot import TimeSlot
from app.schemas.meeting import MeetingCreate, MeetingRead, MeetingUpdate

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _meeting_to_read(meeting: Meeting) -> MeetingRead:
    return MeetingRead(
        id=meeting.id,
        school_id=meeting.school_id,
        name=meeting.name,
        meeting_type=meeting.meeting_type,
        hours_per_week=meeting.hours_per_week,
        is_active=meeting.is_active,
        color=meeting.color,
        teacher_ids=[t.id for t in meeting.teachers],
        pinned_slots=meeting.pinned_slots,
        is_mandatory_attendance=meeting.is_mandatory_attendance,
    )


def _resolve_teachers(db: Session, school_id: int, meeting_type: str) -> list[Teacher]:
    """Auto-resolve teachers for built-in meeting types based on role booleans."""
    q = db.query(Teacher).filter(Teacher.school_id == school_id)

    if meeting_type == MeetingType.HOMEROOM.value:
        q = q.filter(Teacher.homeroom_class_id.isnot(None))
    elif meeting_type == MeetingType.COORDINATORS.value:
        q = q.filter(Teacher.is_coordinator == True)
    elif meeting_type == MeetingType.MANAGEMENT.value:
        q = q.filter(
            (Teacher.is_management == True)
            | (Teacher.is_principal == True)
            | (Teacher.is_director == True)
            | (Teacher.is_pedagogical_coordinator == True)
        )
    else:
        return []

    return q.all()


def _sync_teachers(meeting: Meeting, teacher_ids: list[int], db: Session) -> None:
    teachers = db.query(Teacher).filter(Teacher.id.in_(teacher_ids)).all()
    if len(teachers) != len(teacher_ids):
        raise HTTPException(status_code=400, detail="חלק מהמורים לא נמצאו")
    meeting.teachers = teachers


@router.post("", response_model=MeetingRead, status_code=201)
def create_meeting(data: MeetingCreate, db: Session = Depends(get_db)):
    payload = data.model_dump(exclude={"teacher_ids", "pinned_slots"})
    payload["pinned_slots"] = (
        [{"day": p.day, "period": p.period} for p in data.pinned_slots]
        if data.pinned_slots
        else None
    )
    meeting = Meeting(**payload)
    db.add(meeting)
    db.flush()

    # If teacher_ids explicitly provided, use them for any meeting type.
    # Otherwise, auto-resolve for built-in types.
    if data.teacher_ids:
        _sync_teachers(meeting, data.teacher_ids, db)
    elif data.meeting_type != MeetingType.CUSTOM.value:
        meeting.teachers = _resolve_teachers(db, data.school_id, data.meeting_type)

    db.commit()
    db.refresh(meeting)
    return _meeting_to_read(meeting)


@router.get("", response_model=list[MeetingRead])
def list_meetings(school_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Meeting)
    if school_id is not None:
        q = q.filter(Meeting.school_id == school_id)
    return [_meeting_to_read(m) for m in q.all()]


@router.get("/{meeting_id}", response_model=MeetingRead)
def get_meeting(meeting_id: int, db: Session = Depends(get_db)):
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="ישיבה לא נמצאה")
    return _meeting_to_read(meeting)


@router.put("/{meeting_id}", response_model=MeetingRead)
def update_meeting(
    meeting_id: int, data: MeetingUpdate, db: Session = Depends(get_db)
):
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="ישיבה לא נמצאה")

    updates = data.model_dump(exclude_unset=True)
    teacher_ids = updates.pop("teacher_ids", None)
    pinned_slots_raw = updates.pop("pinned_slots", None)
    for key, value in updates.items():
        setattr(meeting, key, value)

    if "pinned_slots" in data.model_dump(exclude_unset=True):
        meeting.pinned_slots = (
            [{"day": p["day"], "period": p["period"]} for p in pinned_slots_raw]
            if pinned_slots_raw
            else None
        )

    if teacher_ids is not None:
        _sync_teachers(meeting, teacher_ids, db)

    db.commit()
    db.refresh(meeting)
    return _meeting_to_read(meeting)


@router.delete("/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: int, db: Session = Depends(get_db)):
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="ישיבה לא נמצאה")
    db.delete(meeting)
    db.commit()


@router.post("/{meeting_id}/refresh-teachers", response_model=MeetingRead)
def refresh_meeting_teachers(meeting_id: int, db: Session = Depends(get_db)):
    """Re-resolve teachers for a built-in meeting type based on current role assignments."""
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="ישיבה לא נמצאה")

    if meeting.meeting_type == MeetingType.CUSTOM.value:
        raise HTTPException(
            status_code=400,
            detail="לא ניתן לרענן מורים בישיבה מותאמת אישית",
        )

    meeting.teachers = _resolve_teachers(db, meeting.school_id, meeting.meeting_type)
    db.commit()
    db.refresh(meeting)
    return _meeting_to_read(meeting)


@router.get("/{meeting_id}/available-slots")
def get_meeting_available_slots(meeting_id: int, db: Session = Depends(get_db)):
    """Return all timeslots with availability status for this meeting's teachers."""
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="ישיבה לא נמצאה")

    timeslots = (
        db.query(TimeSlot)
        .filter(TimeSlot.school_id == meeting.school_id, TimeSlot.is_available == True)
        .all()
    )

    # Collect blocked slots from all meeting teachers
    teacher_blocked: set[tuple[str, int]] = set()
    for teacher in meeting.teachers:
        if teacher.blocked_slots:
            teacher_blocked.update(
                (s["day"], s["period"]) for s in teacher.blocked_slots
            )

    # Collect pinned slots from OTHER meetings that share teachers
    teacher_ids = {t.id for t in meeting.teachers}
    other_meetings = (
        db.query(Meeting)
        .filter(Meeting.school_id == meeting.school_id, Meeting.id != meeting.id, Meeting.is_active == True)
        .all()
    )
    teacher_conflict: set[tuple[str, int]] = set()
    for other in other_meetings:
        if not other.pinned_slots:
            continue
        if any(t.id in teacher_ids for t in other.teachers):
            for pin in other.pinned_slots:
                teacher_conflict.add((pin["day"], pin["period"]))

    result = []
    for ts in timeslots:
        slot_key = (ts.day, ts.period)
        if slot_key in teacher_blocked:
            status = "teacher_blocked"
        elif slot_key in teacher_conflict:
            status = "teacher_conflict"
        else:
            status = "available"
        result.append({"day": ts.day, "period": ts.period, "status": status})

    return result
