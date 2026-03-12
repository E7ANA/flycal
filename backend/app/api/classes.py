from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.class_group import ClassGroup
from app.schemas.class_group import ClassGroupCreate, ClassGroupRead, ClassGroupUpdate

router = APIRouter(prefix="/api/classes", tags=["classes"], dependencies=[Depends(get_current_user)])


@router.post("", response_model=ClassGroupRead, status_code=201)
def create_class(data: ClassGroupCreate, db: Session = Depends(get_db)):
    class_group = ClassGroup(**data.model_dump())
    db.add(class_group)
    db.commit()
    db.refresh(class_group)
    return class_group


@router.get("", response_model=list[ClassGroupRead])
def list_classes(
    school_id: int | None = None,
    grade_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(ClassGroup)
    if school_id is not None:
        q = q.filter(ClassGroup.school_id == school_id)
    if grade_id is not None:
        q = q.filter(ClassGroup.grade_id == grade_id)
    return q.all()


@router.get("/{class_id}", response_model=ClassGroupRead)
def get_class(class_id: int, db: Session = Depends(get_db)):
    cg = db.get(ClassGroup, class_id)
    if not cg:
        raise HTTPException(status_code=404, detail="כיתה לא נמצאה")
    return cg


@router.put("/{class_id}", response_model=ClassGroupRead)
def update_class(class_id: int, data: ClassGroupUpdate, db: Session = Depends(get_db)):
    cg = db.get(ClassGroup, class_id)
    if not cg:
        raise HTTPException(status_code=404, detail="כיתה לא נמצאה")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(cg, key, value)
    db.commit()
    db.refresh(cg)
    return cg


@router.delete("/{class_id}", status_code=204)
def delete_class(class_id: int, db: Session = Depends(get_db)):
    cg = db.get(ClassGroup, class_id)
    if not cg:
        raise HTTPException(status_code=404, detail="כיתה לא נמצאה")
    db.delete(cg)
    db.commit()
