from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.class_group import ClassGroup, ClusterType, Grade, GroupingCluster, Track
from app.models.subject import Subject, SubjectRequirement
from app.models.teacher import Teacher
from app.models.timeslot import TimeSlot
from app.schemas.grouping import (
    GroupingClusterCreate,
    GroupingClusterRead,
    GroupingClusterUpdate,
    TrackCreate,
    TrackFromRequirement,
    TrackRead,
    TrackSummary,
    TrackToRequirement,
    TrackUpdate,
)

router = APIRouter(prefix="/api/grouping-clusters", tags=["grouping-clusters"])


def _cluster_to_read(cluster: GroupingCluster) -> GroupingClusterRead:
    return GroupingClusterRead(
        id=cluster.id,
        school_id=cluster.school_id,
        name=cluster.name,
        subject_id=cluster.subject_id,
        grade_id=cluster.grade_id,
        source_class_ids=[c.id for c in cluster.source_classes],
        cluster_type=cluster.cluster_type,
        tracks=[
            TrackSummary(
                id=t.id,
                name=t.name,
                teacher_id=t.teacher_id,
                hours_per_week=t.hours_per_week,
                is_secondary=t.is_secondary,
            )
            for t in cluster.tracks
        ],
    )


def _sync_source_classes_from_grade(
    cluster: GroupingCluster, grade_id: int, db: Session
) -> None:
    """Set source_classes to ALL classes in the given grade."""
    grade = db.get(Grade, grade_id)
    if not grade:
        raise HTTPException(status_code=400, detail="שכבה לא נמצאה")
    classes = (
        db.query(ClassGroup)
        .filter(ClassGroup.grade_id == grade_id)
        .all()
    )
    cluster.grade_id = grade_id
    cluster.source_classes = classes


def _sync_source_classes(
    cluster: GroupingCluster, class_ids: list[int], db: Session
) -> None:
    classes = db.query(ClassGroup).filter(ClassGroup.id.in_(class_ids)).all()
    if len(classes) != len(class_ids):
        raise HTTPException(status_code=400, detail="חלק מהכיתות לא נמצאו")
    cluster.source_classes = classes


@router.post("", response_model=GroupingClusterRead, status_code=201)
def create_cluster(data: GroupingClusterCreate, db: Session = Depends(get_db)):
    ct = data.cluster_type

    # Validate SHARED_LESSON requirements
    if ct == ClusterType.SHARED_LESSON:
        if not data.teacher_id:
            raise HTTPException(status_code=400, detail="שיעור משותף דורש מורה")
        if not data.hours_per_week or data.hours_per_week < 1:
            raise HTTPException(status_code=400, detail="שיעור משותף דורש מספר שעות")
        if len(data.source_class_ids) < 2:
            raise HTTPException(status_code=400, detail="שיעור משותף דורש לפחות 2 כיתות")

    # Validate CROSS_GRADE requirements
    if ct == ClusterType.CROSS_GRADE:
        if len(data.source_class_ids) < 2:
            raise HTTPException(status_code=400, detail="הקבצה בין-שכבתית דורשת לפחות 2 כיתות")

    payload = data.model_dump(
        exclude={"source_class_ids", "grade_id", "teacher_id", "hours_per_week"}
    )
    cluster = GroupingCluster(**payload)
    db.add(cluster)
    db.flush()

    # Set source classes
    if ct in (ClusterType.SHARED_LESSON, ClusterType.CROSS_GRADE):
        # These types always use explicit source_class_ids, grade_id=None
        _sync_source_classes(cluster, data.source_class_ids, db)
    elif data.grade_id:
        _sync_source_classes_from_grade(cluster, data.grade_id, db)
    elif data.source_class_ids:
        _sync_source_classes(cluster, data.source_class_ids, db)

    db.flush()

    # Auto-create single track for SHARED_LESSON
    if ct == ClusterType.SHARED_LESSON:
        track = Track(
            name=data.name,
            cluster_id=cluster.id,
            teacher_id=data.teacher_id,
            hours_per_week=data.hours_per_week,  # type: ignore[arg-type]
        )
        db.add(track)

    db.commit()
    db.refresh(cluster)
    return _cluster_to_read(cluster)


@router.get("", response_model=list[GroupingClusterRead])
def list_clusters(
    school_id: int | None = None,
    cluster_type: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(GroupingCluster)
    if school_id is not None:
        q = q.filter(GroupingCluster.school_id == school_id)
    if cluster_type is not None:
        q = q.filter(GroupingCluster.cluster_type == cluster_type)
    return [_cluster_to_read(c) for c in q.all()]


@router.get("/{cluster_id}", response_model=GroupingClusterRead)
def get_cluster(cluster_id: int, db: Session = Depends(get_db)):
    cluster = db.get(GroupingCluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="הקבצה לא נמצאה")
    return _cluster_to_read(cluster)


@router.put("/{cluster_id}", response_model=GroupingClusterRead)
def update_cluster(
    cluster_id: int, data: GroupingClusterUpdate, db: Session = Depends(get_db)
):
    cluster = db.get(GroupingCluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="הקבצה לא נמצאה")

    updates = data.model_dump(exclude_unset=True)
    class_ids = updates.pop("source_class_ids", None)
    grade_id = updates.pop("grade_id", None)
    teacher_id = updates.pop("teacher_id", None)
    hours_per_week = updates.pop("hours_per_week", None)

    for key, value in updates.items():
        setattr(cluster, key, value)

    if grade_id is not None:
        _sync_source_classes_from_grade(cluster, grade_id, db)
    elif class_ids is not None:
        _sync_source_classes(cluster, class_ids, db)

    # For SHARED_LESSON, sync teacher/hours to the single track
    if cluster.cluster_type == ClusterType.SHARED_LESSON:
        tracks = db.query(Track).filter(Track.cluster_id == cluster.id).all()
        if tracks:
            track = tracks[0]
            if teacher_id is not None:
                track.teacher_id = teacher_id
            if hours_per_week is not None:
                track.hours_per_week = hours_per_week
            if "name" in updates:
                track.name = updates["name"]

    db.commit()
    db.refresh(cluster)
    return _cluster_to_read(cluster)


@router.delete("/{cluster_id}", status_code=204)
def delete_cluster(cluster_id: int, db: Session = Depends(get_db)):
    cluster = db.get(GroupingCluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="הקבצה לא נמצאה")
    # Unlink all requirements grouped into this cluster
    grouped_reqs = (
        db.query(SubjectRequirement)
        .filter(SubjectRequirement.grouping_cluster_id == cluster_id)
        .all()
    )
    for req in grouped_reqs:
        req.is_grouped = False
        req.grouping_cluster_id = None
    # Unlink requirement associations on tracks, then delete tracks
    tracks = db.query(Track).filter(Track.cluster_id == cluster_id).all()
    for track in tracks:
        if track.requirement_id:
            req = db.get(SubjectRequirement, track.requirement_id)
            if req:
                req.is_grouped = False
                req.grouping_cluster_id = None
        db.delete(track)
    db.delete(cluster)
    db.commit()


# --- Track CRUD ---

track_router = APIRouter(prefix="/api/tracks", tags=["tracks"])


@track_router.post("", response_model=TrackRead, status_code=201)
def create_track(data: TrackCreate, db: Session = Depends(get_db)):
    payload = data.model_dump(exclude={"pinned_slots", "blocked_slots"})
    payload["pinned_slots"] = (
        [{"day": p.day, "period": p.period} for p in data.pinned_slots]
        if data.pinned_slots
        else None
    )
    payload["blocked_slots"] = (
        [{"day": p.day, "period": p.period} for p in data.blocked_slots]
        if data.blocked_slots
        else None
    )
    track = Track(**payload)
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


@track_router.post("/from-requirement", response_model=TrackRead, status_code=201)
def create_track_from_requirement(
    data: TrackFromRequirement, db: Session = Depends(get_db)
):
    """Create a track by importing an existing subject requirement."""
    cluster = db.get(GroupingCluster, data.cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="הקבצה לא נמצאה")

    req = db.get(SubjectRequirement, data.requirement_id)
    if not req:
        raise HTTPException(status_code=404, detail="דרישה לא נמצאה")

    if req.is_grouped:
        raise HTTPException(status_code=400, detail="דרישה זו כבר שייכת להקבצה")

    # Build track name from subject + class
    subject = db.get(Subject, req.subject_id)
    class_group = db.get(ClassGroup, req.class_group_id)
    track_name = ""
    if subject:
        track_name = subject.name
    if class_group:
        track_name += f" {class_group.name}" if track_name else class_group.name

    track = Track(
        name=track_name or f"רמה {data.requirement_id}",
        cluster_id=cluster.id,
        teacher_id=req.teacher_id,
        hours_per_week=req.hours_per_week,
        requirement_id=req.id,
    )
    db.add(track)

    # Mark requirement as grouped
    req.is_grouped = True
    req.grouping_cluster_id = cluster.id

    db.commit()
    db.refresh(track)
    return track


@track_router.post("/{track_id}/to-requirement", status_code=200)
def convert_track_to_requirement(
    track_id: int,
    data: TrackToRequirement,
    db: Session = Depends(get_db),
):
    """Extract a track from a grouping back to a standalone requirement."""
    track = db.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="רמה לא נמצאה")

    cluster = db.get(GroupingCluster, track.cluster_id)

    if track.requirement_id:
        # Track was imported from a requirement — just unlink it
        req = db.get(SubjectRequirement, track.requirement_id)
        if req:
            req.is_grouped = False
            req.grouping_cluster_id = None
            req.hours_per_week = track.hours_per_week
            if track.teacher_id:
                req.teacher_id = track.teacher_id
        db.delete(track)
        db.commit()
        return {"detail": "רמה הוחזרה לדרישה עצמאית", "requirement_id": req.id if req else None}

    # Track was manually created — need a target class to create a new requirement
    if not data.class_group_id:
        raise HTTPException(
            status_code=400,
            detail="יש לבחור כיתה ליצירת הדרישה",
        )

    class_group = db.get(ClassGroup, data.class_group_id)
    if not class_group:
        raise HTTPException(status_code=400, detail="כיתה לא נמצאה")

    subject_id = cluster.subject_id if cluster else 0
    new_req = SubjectRequirement(
        school_id=class_group.school_id,
        class_group_id=data.class_group_id,
        subject_id=subject_id,
        teacher_id=track.teacher_id,
        hours_per_week=track.hours_per_week,
        is_grouped=False,
        grouping_cluster_id=None,
    )
    db.add(new_req)
    db.delete(track)
    db.commit()
    db.refresh(new_req)
    return {"detail": "רמה הומרה לדרישה עצמאית", "requirement_id": new_req.id}


@track_router.get("", response_model=list[TrackRead])
def list_tracks(cluster_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Track)
    if cluster_id is not None:
        q = q.filter(Track.cluster_id == cluster_id)
    return q.all()


@track_router.get("/{track_id}", response_model=TrackRead)
def get_track(track_id: int, db: Session = Depends(get_db)):
    track = db.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="מסלול לא נמצא")
    return track


@track_router.put("/{track_id}", response_model=TrackRead)
def update_track(track_id: int, data: TrackUpdate, db: Session = Depends(get_db)):
    track = db.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="מסלול לא נמצא")
    updates = data.model_dump(exclude_unset=True)
    pinned_slots_raw = updates.pop("pinned_slots", None)
    blocked_slots_raw = updates.pop("blocked_slots", None)
    for key, value in updates.items():
        setattr(track, key, value)
    if "pinned_slots" in data.model_dump(exclude_unset=True):
        track.pinned_slots = (
            [{"day": p["day"], "period": p["period"]} for p in pinned_slots_raw]
            if pinned_slots_raw
            else None
        )
    if "blocked_slots" in data.model_dump(exclude_unset=True):
        track.blocked_slots = (
            [{"day": p["day"], "period": p["period"]} for p in blocked_slots_raw]
            if blocked_slots_raw
            else None
        )
    # Sync back to linked requirement
    if track.requirement_id:
        req = db.get(SubjectRequirement, track.requirement_id)
        if req:
            if "teacher_id" in updates:
                req.teacher_id = track.teacher_id
            if "hours_per_week" in updates:
                req.hours_per_week = track.hours_per_week
    db.commit()
    db.refresh(track)
    return track


@track_router.delete("/{track_id}", status_code=204)
def delete_track(track_id: int, db: Session = Depends(get_db)):
    track = db.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="מסלול לא נמצא")
    # Unlink requirement if this track was created from one
    if track.requirement_id:
        req = db.get(SubjectRequirement, track.requirement_id)
        if req:
            req.is_grouped = False
            req.grouping_cluster_id = None
    db.delete(track)
    db.commit()


@track_router.get("/{track_id}/available-slots")
def get_track_available_slots(track_id: int, db: Session = Depends(get_db)):
    """Return all timeslots with availability status for this track's teacher."""
    track = db.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="מסלול לא נמצא")

    cluster = db.get(GroupingCluster, track.cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="הקבצה לא נמצאה")

    timeslots = (
        db.query(TimeSlot)
        .filter(TimeSlot.school_id == cluster.school_id, TimeSlot.is_available == True)
        .all()
    )

    # Teacher blocked slots — in a synced cluster, ALL teachers' blocked slots
    # restrict the entire cluster since all tracks must be scheduled simultaneously.
    teacher_blocked: set[tuple[str, int]] = set()
    cluster_tracks = (
        db.query(Track).filter(Track.cluster_id == cluster.id).all()
    )
    cluster_teacher_ids = {
        t.teacher_id for t in cluster_tracks
        if t.teacher_id is not None and not t.is_secondary
    }
    for tid in cluster_teacher_ids:
        teacher = db.get(Teacher, tid)
        if teacher and teacher.blocked_slots:
            for s in teacher.blocked_slots:
                teacher_blocked.add((s["day"], s["period"]))

    # Other pinned slots for ALL teachers in the cluster (tracks + requirements)
    teacher_pin_slots: set[tuple[str, int]] = set()
    for tid in cluster_teacher_ids:
        other_tracks = (
            db.query(Track)
            .filter(Track.teacher_id == tid, Track.cluster_id != cluster.id)
            .all()
        )
        for other in other_tracks:
            if other.pinned_slots:
                for pin in other.pinned_slots:
                    teacher_pin_slots.add((pin["day"], pin["period"]))
        other_reqs = (
            db.query(SubjectRequirement)
            .filter(
                SubjectRequirement.teacher_id == tid,
                SubjectRequirement.is_grouped == False,
            )
            .all()
        )
        for other in other_reqs:
            if other.pinned_slots:
                for pin in other.pinned_slots:
                    teacher_pin_slots.add((pin["day"], pin["period"]))

    # Source class conflicts: pinned slots of other requirements/tracks for same classes
    class_pin_slots: set[tuple[str, int]] = set()
    source_class_ids = [sc.id for sc in cluster.source_classes]
    if source_class_ids:
        other_class_reqs = (
            db.query(SubjectRequirement)
            .filter(
                SubjectRequirement.class_group_id.in_(source_class_ids),
                SubjectRequirement.is_grouped == False,
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
        result.append({"day": ts.day, "period": ts.period, "status": status})

    return result
