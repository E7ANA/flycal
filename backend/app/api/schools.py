from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.school import School
from app.schemas.school import SchoolCreate, SchoolRead, SchoolUpdate

router = APIRouter(prefix="/api/schools", tags=["schools"])


@router.post("", response_model=SchoolRead, status_code=201)
def create_school(data: SchoolCreate, db: Session = Depends(get_db)):
    school = School(**data.model_dump())
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@router.get("", response_model=list[SchoolRead])
def list_schools(db: Session = Depends(get_db)):
    return db.query(School).all()


@router.get("/{school_id}", response_model=SchoolRead)
def get_school(school_id: int, db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    return school


@router.put("/{school_id}", response_model=SchoolRead)
def update_school(school_id: int, data: SchoolUpdate, db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(school, key, value)
    db.commit()
    db.refresh(school)
    return school


@router.delete("/{school_id}", status_code=204)
def delete_school(school_id: int, db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    db.delete(school)
    db.commit()
