from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.class_group import ClassGroup
from app.models.subject import Subject, SubjectRequirement
from app.models.teacher import Teacher
from app.models.timeslot import TimeSlot
from app.schemas.subject import (
    SubjectCreate,
    SubjectRead,
    SubjectRequirementCreate,
    SubjectRequirementRead,
    SubjectRequirementUpdate,
    SubjectUpdate,
)

router = APIRouter(prefix="/api/subjects", tags=["subjects"])


# --- Subject CRUD ---


@router.post("", response_model=SubjectRead, status_code=201)
def create_subject(data: SubjectCreate, db: Session = Depends(get_db)):
    subject = Subject(**data.model_dump())
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.get("", response_model=list[SubjectRead])
def list_subjects(school_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Subject)
    if school_id is not None:
        q = q.filter(Subject.school_id == school_id)
    return q.all()


@router.get("/{subject_id}", response_model=SubjectRead)
def get_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="מקצוע לא נמצא")
    return subject


@router.put("/{subject_id}", response_model=SubjectRead)
def update_subject(
    subject_id: int, data: SubjectUpdate, db: Session = Depends(get_db)
):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="מקצוע לא נמצא")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(subject, key, value)
    db.commit()
    db.refresh(subject)
    return subject


@router.delete("/{subject_id}", status_code=204)
def delete_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="מקצוע לא נמצא")
    db.delete(subject)
    db.commit()


# --- SubjectRequirement CRUD ---

req_router = APIRouter(prefix="/api/subject-requirements", tags=["subject-requirements"])


@req_router.post("", response_model=SubjectRequirementRead, status_code=201)
def create_requirement(data: SubjectRequirementCreate, db: Session = Depends(get_db)):
    req = SubjectRequirement(**data.model_dump())
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


@req_router.get("", response_model=list[SubjectRequirementRead])
def list_requirements(
    school_id: int | None = None,
    class_group_id: int | None = None,
    subject_id: int | None = None,
    teacher_id: int | None = None,
    grade_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(SubjectRequirement)
    if school_id is not None:
        q = q.filter(SubjectRequirement.school_id == school_id)
    if class_group_id is not None:
        q = q.filter(SubjectRequirement.class_group_id == class_group_id)
    if subject_id is not None:
        q = q.filter(SubjectRequirement.subject_id == subject_id)
    if teacher_id is not None:
        q = q.filter(SubjectRequirement.teacher_id == teacher_id)
    if grade_id is not None:
        q = q.join(ClassGroup, SubjectRequirement.class_group_id == ClassGroup.id).filter(
            ClassGroup.grade_id == grade_id
        )
    return q.all()


@req_router.get("/{req_id}", response_model=SubjectRequirementRead)
def get_requirement(req_id: int, db: Session = Depends(get_db)):
    req = db.get(SubjectRequirement, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="דרישת מקצוע לא נמצאה")
    return req


@req_router.put("/{req_id}", response_model=SubjectRequirementRead)
def update_requirement(
    req_id: int, data: SubjectRequirementUpdate, db: Session = Depends(get_db)
):
    req = db.get(SubjectRequirement, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="דרישת מקצוע לא נמצאה")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(req, key, value)
    db.commit()
    db.refresh(req)
    return req


@req_router.delete("/{req_id}", status_code=204)
def delete_requirement(req_id: int, db: Session = Depends(get_db)):
    req = db.get(SubjectRequirement, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="דרישת מקצוע לא נמצאה")
    db.delete(req)
    db.commit()


@req_router.get("/{req_id}/available-slots")
def get_available_slots(req_id: int, db: Session = Depends(get_db)):
    """Return all timeslots with status: available, teacher_blocked, class_conflict, teacher_conflict."""
    req = db.get(SubjectRequirement, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="דרישת מקצוע לא נמצאה")

    timeslots = (
        db.query(TimeSlot)
        .filter(TimeSlot.school_id == req.school_id, TimeSlot.is_available == True)
        .all()
    )

    # Teacher blocked slots (primary + co-teachers)
    teacher_blocked: set[tuple[str, int]] = set()
    all_teacher_ids = []
    if req.teacher_id:
        all_teacher_ids.append(req.teacher_id)
    all_teacher_ids.extend(req.co_teacher_ids or [])
    for tid in all_teacher_ids:
        teacher = db.get(Teacher, tid)
        if teacher and teacher.blocked_slots:
            teacher_blocked.update((s["day"], s["period"]) for s in teacher.blocked_slots)

    # Other requirements' pins for any of our teachers (primary + co)
    teacher_pin_slots: set[tuple[str, int]] = set()
    for tid in all_teacher_ids:
        other_reqs = (
            db.query(SubjectRequirement)
            .filter(
                SubjectRequirement.teacher_id == tid,
                SubjectRequirement.id != req.id,
            )
            .all()
        )
        for other in other_reqs:
            if other.pinned_slots:
                for pin in other.pinned_slots:
                    teacher_pin_slots.add((pin["day"], pin["period"]))

    # Other requirements' pins for the same class
    class_pin_slots: set[tuple[str, int]] = set()
    other_class_reqs = (
        db.query(SubjectRequirement)
        .filter(
            SubjectRequirement.class_group_id == req.class_group_id,
            SubjectRequirement.id != req.id,
        )
        .all()
    )
    for other in other_class_reqs:
        if other.pinned_slots:
            for pin in other.pinned_slots:
                class_pin_slots.add((pin["day"], pin["period"]))

    result = []
    for ts in timeslots:
        slot_key = (ts.day, ts.period)
        if slot_key in teacher_blocked:
            status = "teacher_blocked"
        elif slot_key in teacher_pin_slots:
            status = "teacher_conflict"
        elif slot_key in class_pin_slots:
            status = "class_conflict"
        else:
            status = "available"
        result.append({
            "day": ts.day,
            "period": ts.period,
            "status": status,
        })

    return result
