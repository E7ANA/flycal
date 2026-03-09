from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.class_group import Grade
from app.schemas.grade import GradeCreate, GradeRead, GradeUpdate

router = APIRouter(prefix="/api/grades", tags=["grades"])


@router.post("", response_model=GradeRead, status_code=201)
def create_grade(data: GradeCreate, db: Session = Depends(get_db)):
    grade = Grade(**data.model_dump())
    db.add(grade)
    db.commit()
    db.refresh(grade)
    return grade


@router.get("", response_model=list[GradeRead])
def list_grades(school_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Grade)
    if school_id is not None:
        q = q.filter(Grade.school_id == school_id)
    return q.all()


@router.get("/{grade_id}", response_model=GradeRead)
def get_grade(grade_id: int, db: Session = Depends(get_db)):
    grade = db.get(Grade, grade_id)
    if not grade:
        raise HTTPException(status_code=404, detail="שכבה לא נמצאה")
    return grade


@router.put("/{grade_id}", response_model=GradeRead)
def update_grade(grade_id: int, data: GradeUpdate, db: Session = Depends(get_db)):
    grade = db.get(Grade, grade_id)
    if not grade:
        raise HTTPException(status_code=404, detail="שכבה לא נמצאה")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(grade, key, value)
    db.commit()
    db.refresh(grade)
    return grade


@router.delete("/{grade_id}", status_code=204)
def delete_grade(grade_id: int, db: Session = Depends(get_db)):
    grade = db.get(Grade, grade_id)
    if not grade:
        raise HTTPException(status_code=404, detail="שכבה לא נמצאה")
    db.delete(grade)
    db.commit()
