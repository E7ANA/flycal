from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.schemas.teacher import TeacherCreate, TeacherRead, TeacherUpdate

router = APIRouter(prefix="/api/teachers", tags=["teachers"], dependencies=[Depends(get_current_user)])


def _teacher_to_read(teacher: Teacher) -> TeacherRead:
    return TeacherRead(
        id=teacher.id,
        school_id=teacher.school_id,
        name=teacher.name,
        max_hours_per_week=teacher.max_hours_per_week,
        min_hours_per_week=teacher.min_hours_per_week,
        rubrica_hours=teacher.rubrica_hours,
        max_work_days=teacher.max_work_days,
        min_work_days=teacher.min_work_days,
        subject_ids=[s.id for s in teacher.subjects],
        is_coordinator=teacher.is_coordinator,
        homeroom_class_id=teacher.homeroom_class_id,
        is_management=teacher.is_management,
        is_counselor=teacher.is_counselor,
        is_principal=teacher.is_principal,
        is_pedagogical_coordinator=teacher.is_pedagogical_coordinator,
        is_director=teacher.is_director,
        pirtani_hours=teacher.pirtani_hours,
        shehiya_hours=teacher.shehiya_hours,
        tafkid_hours=teacher.tafkid_hours,
        bagrut_hours=teacher.bagrut_hours,
        chinuch_hours=teacher.chinuch_hours,
        transport_priority=teacher.transport_priority,
        blocked_slots=teacher.blocked_slots or [],
    )


def _sync_subjects(teacher: Teacher, subject_ids: list[int], db: Session) -> None:
    subjects = db.query(Subject).filter(Subject.id.in_(subject_ids)).all()
    if len(subjects) != len(subject_ids):
        raise HTTPException(status_code=400, detail="חלק מהמקצועות לא נמצאו")
    teacher.subjects = subjects


@router.post("", response_model=TeacherRead, status_code=201)
def create_teacher(data: TeacherCreate, db: Session = Depends(get_db)):
    payload = data.model_dump(exclude={"subject_ids"})
    teacher = Teacher(**payload)
    db.add(teacher)
    db.flush()
    if data.subject_ids:
        _sync_subjects(teacher, data.subject_ids, db)
    db.commit()
    db.refresh(teacher)
    return _teacher_to_read(teacher)


@router.get("", response_model=list[TeacherRead])
def list_teachers(school_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Teacher)
    if school_id is not None:
        q = q.filter(Teacher.school_id == school_id)
    return [_teacher_to_read(t) for t in q.all()]


@router.get("/{teacher_id}", response_model=TeacherRead)
def get_teacher(teacher_id: int, db: Session = Depends(get_db)):
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="מורה לא נמצא/ה")
    return _teacher_to_read(teacher)


@router.put("/{teacher_id}", response_model=TeacherRead)
def update_teacher(
    teacher_id: int, data: TeacherUpdate, db: Session = Depends(get_db)
):
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="מורה לא נמצא/ה")
    updates = data.model_dump(exclude_unset=True)
    subject_ids = updates.pop("subject_ids", None)
    for key, value in updates.items():
        setattr(teacher, key, value)
    if subject_ids is not None:
        _sync_subjects(teacher, subject_ids, db)
    db.commit()
    db.refresh(teacher)
    return _teacher_to_read(teacher)


@router.delete("/{teacher_id}", status_code=204)
def delete_teacher(teacher_id: int, db: Session = Depends(get_db)):
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="מורה לא נמצא/ה")
    db.delete(teacher)
    db.commit()
