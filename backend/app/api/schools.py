from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_super_admin
from app.models.school import School
from app.models.user import User
from app.schemas.school import SchoolCreate, SchoolRead, SchoolUpdate

router = APIRouter(prefix="/api/schools", tags=["schools"])


@router.post("", response_model=SchoolRead, status_code=201)
def create_school(
    data: SchoolCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
):
    """Only SUPER_ADMIN can create schools."""
    school = School(**data.model_dump())
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@router.get("", response_model=list[SchoolRead])
def list_schools(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """SUPER_ADMIN sees all schools, SCHOOL_ADMIN sees only their own."""
    if current_user.role == "SUPER_ADMIN":
        return db.query(School).all()
    if current_user.school_id:
        return db.query(School).filter(School.id == current_user.school_id).all()
    return []


@router.get("/{school_id}", response_model=SchoolRead)
def get_school(school_id: int, db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    return school


@router.put("/{school_id}", response_model=SchoolRead)
def update_school(
    school_id: int,
    data: SchoolUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(school, key, value)
    db.commit()
    db.refresh(school)
    return school


@router.delete("/{school_id}", status_code=204)
def delete_school(
    school_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
):
    """Only SUPER_ADMIN can delete schools."""
    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    db.delete(school)
    db.commit()
