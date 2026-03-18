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
    """Only SUPER_ADMIN can delete schools. Deletes all related data."""
    from app.models.timetable import Solution, ScheduledLesson
    from app.models.class_group import ClassGroup, Grade, GroupingCluster, Track, cluster_source_classes
    from app.models.subject import Subject, SubjectRequirement
    from app.models.teacher import Teacher, teacher_subjects
    from app.models.meeting import Meeting, meeting_teachers
    from app.models.room import Room
    from app.models.timeslot import TimeSlot
    from app.models.constraint import Constraint

    school = db.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")

    # Delete in dependency order (children first)

    # 1. Scheduled lessons & solutions
    solution_ids = [s.id for s in db.query(Solution.id).filter(Solution.school_id == school_id).all()]
    if solution_ids:
        db.query(ScheduledLesson).filter(ScheduledLesson.solution_id.in_(solution_ids)).delete(synchronize_session=False)
        db.query(Solution).filter(Solution.school_id == school_id).delete(synchronize_session=False)

    # 2. Constraints
    db.query(Constraint).filter(Constraint.school_id == school_id).delete(synchronize_session=False)

    # 4. Meetings (many-to-many first)
    meeting_ids = [m.id for m in db.query(Meeting.id).filter(Meeting.school_id == school_id).all()]
    if meeting_ids:
        db.execute(meeting_teachers.delete().where(meeting_teachers.c.meeting_id.in_(meeting_ids)))
        db.query(Meeting).filter(Meeting.school_id == school_id).delete(synchronize_session=False)

    # 5. Tracks → cluster_source_classes → clusters
    cluster_ids = [c.id for c in db.query(GroupingCluster.id).filter(GroupingCluster.school_id == school_id).all()]
    if cluster_ids:
        db.query(Track).filter(Track.cluster_id.in_(cluster_ids)).delete(synchronize_session=False)
        db.execute(cluster_source_classes.delete().where(cluster_source_classes.c.cluster_id.in_(cluster_ids)))
        db.query(GroupingCluster).filter(GroupingCluster.school_id == school_id).delete(synchronize_session=False)

    # 6. Subject requirements
    db.query(SubjectRequirement).filter(SubjectRequirement.school_id == school_id).delete(synchronize_session=False)

    # 7. Teacher-subject links → teachers
    teacher_ids = [t.id for t in db.query(Teacher.id).filter(Teacher.school_id == school_id).all()]
    if teacher_ids:
        db.execute(teacher_subjects.delete().where(teacher_subjects.c.teacher_id.in_(teacher_ids)))
    db.query(Teacher).filter(Teacher.school_id == school_id).delete(synchronize_session=False)

    # 8. Subjects
    db.query(Subject).filter(Subject.school_id == school_id).delete(synchronize_session=False)

    # 9. Classes → grades
    db.query(ClassGroup).filter(ClassGroup.school_id == school_id).delete(synchronize_session=False)
    db.query(Grade).filter(Grade.school_id == school_id).delete(synchronize_session=False)

    # 10. Rooms & timeslots
    db.query(Room).filter(Room.school_id == school_id).delete(synchronize_session=False)
    db.query(TimeSlot).filter(TimeSlot.school_id == school_id).delete(synchronize_session=False)

    # 11. Finally, the school itself
    db.delete(school)
    db.commit()
