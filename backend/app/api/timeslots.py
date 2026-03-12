from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.school import School
from app.models.timeslot import DayOfWeek, TimeSlot
from app.schemas.timeslot import TimeSlotBatchUpdate, TimeSlotRead, TimeSlotUpdate

router = APIRouter(prefix="/api/timeslots", tags=["timeslots"], dependencies=[Depends(get_current_user)])


@router.post("/generate/{school_id}", response_model=list[TimeSlotRead], status_code=201)
def generate_timeslots(school_id: int, db: Session = Depends(get_db)):
    """Generate all timeslots for a school based on its configuration."""
    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")

    # Delete existing timeslots for this school
    db.query(TimeSlot).filter(TimeSlot.school_id == school_id).delete()

    days = list(DayOfWeek)[:school.days_per_week]
    # Rotate to start from the configured start day
    if school.week_start_day == "SUNDAY":
        pass  # DayOfWeek already starts with SUNDAY
    elif school.week_start_day == "MONDAY":
        days = days[1:] + days[:1]

    day_map = school.periods_per_day_map or {}

    slots = []
    for day in days:
        max_period = day_map.get(day.value, school.periods_per_day)
        for period in range(1, max_period + 1):
            is_available = period not in school.break_slots
            slot = TimeSlot(
                school_id=school_id,
                day=day,
                period=period,
                is_available=is_available,
            )
            db.add(slot)
            slots.append(slot)

    db.commit()
    for s in slots:
        db.refresh(s)
    return slots


@router.get("", response_model=list[TimeSlotRead])
def list_timeslots(school_id: int, db: Session = Depends(get_db)):
    return (
        db.query(TimeSlot)
        .filter(TimeSlot.school_id == school_id)
        .order_by(TimeSlot.day, TimeSlot.period)
        .all()
    )


@router.patch("/{slot_id}", response_model=TimeSlotRead)
def update_timeslot(slot_id: int, data: TimeSlotUpdate, db: Session = Depends(get_db)):
    slot = db.get(TimeSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="משבצת זמן לא נמצאה")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(slot, key, value)
    db.commit()
    db.refresh(slot)
    return slot


@router.patch("/batch/{school_id}", response_model=list[TimeSlotRead])
def batch_update_timeslots(
    school_id: int, data: TimeSlotBatchUpdate, db: Session = Depends(get_db)
):
    """Batch update timeslot availability."""
    slots = (
        db.query(TimeSlot)
        .filter(TimeSlot.school_id == school_id)
        .all()
    )
    slot_map = {s.id: s for s in slots}
    updated = []
    for item in data.updates:
        slot = slot_map.get(item.id)
        if slot:
            slot.is_available = item.is_available
            updated.append(slot)
    db.commit()
    for s in updated:
        db.refresh(s)
    return (
        db.query(TimeSlot)
        .filter(TimeSlot.school_id == school_id)
        .order_by(TimeSlot.day, TimeSlot.period)
        .all()
    )
