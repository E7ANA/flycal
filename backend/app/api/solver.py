import asyncio
import json
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models.meeting import Meeting, meeting_teachers
from app.models.timetable import ScheduledLesson, ScheduledMeeting, Solution
from app.models.class_group import Track
from app.models.subject import Subject, SubjectRequirement
from app.models.teacher import Teacher
from app.schemas.timetable import (
    ScheduledLessonRead,
    ScheduledMeetingRead,
    SolutionDetailRead,
    SolutionRead,
    TeacherPresenceRead,
    TeacherSlotAnnotation,
)
from app.solver.conflict_detector import detect_conflicts
from app.solver.engine import (
    SolutionStatus,
    solve,
    get_progress,
    _init_progress,
    _clear_progress,
)
from app.solver.model_builder import load_solver_data
from app.solver.validator import validate

router = APIRouter(prefix="/api", tags=["solver"])


class SolveRequest(BaseModel):
    school_id: int
    max_time: int | None = None
    max_solutions: int | None = None
    num_workers: int | None = None


class SolveResponse(BaseModel):
    status: str
    message: str
    solve_time: float
    solutions: list[SolutionRead]


@router.post("/solve", response_model=SolveResponse)
def run_solver(req: SolveRequest, db: Session = Depends(get_db)):
    """Trigger a synchronous solve for the given school."""
    result = solve(
        db=db,
        school_id=req.school_id,
        max_time=req.max_time,
        max_solutions=req.max_solutions,
        num_workers=req.num_workers,
    )
    return SolveResponse(
        status=result.status.value,
        message=result.message,
        solve_time=round(result.solve_time, 2),
        solutions=[SolutionRead.model_validate(s) for s in result.solutions],
    )


# ── SSE-based solve with progress ────────────────────────────────────────

# Store solve results so the SSE stream can send the final response
_solve_results: dict[str, SolveResponse | None] = {}
_solve_results_lock = threading.Lock()


def _solve_in_thread(
    job_id: str,
    school_id: int,
    max_time: int | None,
    max_solutions: int | None,
    num_workers: int | None,
) -> None:
    """Run solve in a background thread with its own DB session."""
    db = SessionLocal()
    try:
        result = solve(
            db=db,
            school_id=school_id,
            max_time=max_time,
            max_solutions=max_solutions,
            num_workers=num_workers,
            job_id=job_id,
        )
        resp = SolveResponse(
            status=result.status.value,
            message=result.message,
            solve_time=round(result.solve_time, 2),
            solutions=[SolutionRead.model_validate(s) for s in result.solutions],
        )
        with _solve_results_lock:
            _solve_results[job_id] = resp
        # Ensure done is set (solve() should set it, but be safe)
        from app.solver.engine import _set_progress
        _set_progress(job_id, done=True, result_status=result.status.value,
                      result_message=result.message)
    except Exception as e:
        import traceback
        traceback.print_exc()
        with _solve_results_lock:
            _solve_results[job_id] = SolveResponse(
                status="ERROR", message=str(e), solve_time=0, solutions=[],
            )
        from app.solver.engine import _set_progress
        _set_progress(job_id, done=True, result_status="ERROR",
                      result_message=str(e))
    finally:
        db.close()


_STEP_LABELS = {
    "initializing": "אתחול...",
    "loading_data": "טוען נתונים...",
    "validating": "בודק תקינות...",
    "building_model": "בונה מודל...",
    "system_constraints": "אילוצי מערכת...",
    "user_constraints": "אילוצי משתמש...",
    "setting_objective": "מגדיר פונקציית מטרה...",
    "solving": "פותר...",
    "mapping_status": "מעבד תוצאות...",
    "saving_solutions": "שומר פתרונות...",
}


@router.post("/solve-stream")
async def solve_stream(req: SolveRequest):
    """Start solve and stream progress via SSE."""
    job_id = uuid.uuid4().hex[:12]

    _init_progress(job_id)
    with _solve_results_lock:
        _solve_results[job_id] = None

    thread = threading.Thread(
        target=_solve_in_thread,
        args=(job_id, req.school_id, req.max_time, req.max_solutions, req.num_workers),
        daemon=True,
    )
    thread.start()

    async def event_generator():
        try:
            while True:
                progress = get_progress(job_id)
                if progress is None:
                    break

                data = {
                    "step": progress.step,
                    "step_label": _STEP_LABELS.get(progress.step, progress.step),
                    "step_number": progress.step_number,
                    "total_steps": progress.total_steps,
                    "percent": progress.percent,
                    "solutions_found": progress.solutions_found,
                    "elapsed": progress.elapsed,
                    "done": progress.done,
                }

                yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

                if progress.done:
                    # Send final result
                    with _solve_results_lock:
                        result = _solve_results.pop(job_id, None)
                    if result:
                        yield f"event: result\ndata: {result.model_dump_json()}\n\n"
                    break

                await asyncio.sleep(0.5)
        finally:
            _clear_progress(job_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/solutions", response_model=list[SolutionRead])
def list_solutions(school_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Solution)
        .filter(Solution.school_id == school_id)
        .order_by(Solution.created_at.desc())
        .all()
    )


@router.get("/solutions/{solution_id}", response_model=SolutionDetailRead)
def get_solution(solution_id: int, db: Session = Depends(get_db)):
    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")
    return solution


@router.delete("/solutions/{solution_id}", status_code=204)
def delete_solution(solution_id: int, db: Session = Depends(get_db)):
    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")
    db.delete(solution)
    db.commit()


@router.get(
    "/solutions/{solution_id}/by-class/{class_id}",
    response_model=list[ScheduledLessonRead],
)
def get_lessons_by_class(
    solution_id: int, class_id: int, db: Session = Depends(get_db)
):
    # Track lessons are now "implanted" into each source class at solve time,
    # so a simple class_group_id filter covers both regular and grouped lessons.
    return (
        db.query(ScheduledLesson)
        .filter(
            ScheduledLesson.solution_id == solution_id,
            ScheduledLesson.class_group_id == class_id,
        )
        .order_by(ScheduledLesson.day, ScheduledLesson.period)
        .all()
    )


@router.get(
    "/solutions/{solution_id}/by-teacher/{teacher_id}",
    response_model=list[ScheduledLessonRead],
)
def get_lessons_by_teacher(
    solution_id: int, teacher_id: int, db: Session = Depends(get_db)
):
    lessons = (
        db.query(ScheduledLesson)
        .filter(
            ScheduledLesson.solution_id == solution_id,
            ScheduledLesson.teacher_id == teacher_id,
        )
        .order_by(ScheduledLesson.day, ScheduledLesson.period)
        .all()
    )
    # Deduplicate track lessons (each track-slot is stored once per source class)
    seen: set[tuple[int, str, int]] = set()
    result: list[ScheduledLesson] = []
    for l in lessons:
        if l.track_id is not None:
            key = (l.track_id, l.day, l.period)
            if key in seen:
                continue
            seen.add(key)
        result.append(l)
    return result


@router.get(
    "/solutions/{solution_id}/meetings",
    response_model=list[ScheduledMeetingRead],
)
def get_scheduled_meetings(solution_id: int, db: Session = Depends(get_db)):
    return (
        db.query(ScheduledMeeting)
        .filter(ScheduledMeeting.solution_id == solution_id)
        .order_by(ScheduledMeeting.day, ScheduledMeeting.period)
        .all()
    )


@router.get(
    "/solutions/{solution_id}/by-teacher/{teacher_id}/meetings",
    response_model=list[ScheduledMeetingRead],
)
def get_meetings_by_teacher(
    solution_id: int, teacher_id: int, db: Session = Depends(get_db)
):
    """Get meetings for a specific teacher in a solution."""
    # Find meeting IDs this teacher belongs to
    teacher_meeting_ids = (
        db.query(meeting_teachers.c.meeting_id)
        .filter(meeting_teachers.c.teacher_id == teacher_id)
        .subquery()
    )
    return (
        db.query(ScheduledMeeting)
        .filter(
            ScheduledMeeting.solution_id == solution_id,
            ScheduledMeeting.meeting_id.in_(teacher_meeting_ids),
        )
        .order_by(ScheduledMeeting.day, ScheduledMeeting.period)
        .all()
    )


@router.get(
    "/solutions/{solution_id}/by-teacher/{teacher_id}/presence",
    response_model=TeacherPresenceRead,
)
def get_teacher_presence(
    solution_id: int, teacher_id: int, db: Session = Depends(get_db)
):
    """Oz LaTmura (עוז לתמורה) presence breakdown for a teacher.

    Returns all slots in the teacher's daily span annotated as:
    frontal, meeting, שהייה, פרטני, or חלון.
    """
    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="מורה לא נמצא")

    # ── Collect frontal hours ──
    frontal = 0
    # Regular (non-grouped) requirements
    reqs = (
        db.query(SubjectRequirement)
        .filter(
            SubjectRequirement.teacher_id == teacher_id,
            SubjectRequirement.is_grouped == False,  # noqa: E712
        )
        .all()
    )
    for req in reqs:
        frontal += req.hours_per_week

    # Grouped tracks
    tracks = db.query(Track).filter(Track.teacher_id == teacher_id).all()
    for track in tracks:
        frontal += track.hours_per_week

    individual = round(0.12 * frontal)
    staying = round(0.4 * frontal)
    allowed_gaps = frontal // 8

    # ── Get scheduled lessons for this teacher ──
    lessons = (
        db.query(ScheduledLesson)
        .filter(
            ScheduledLesson.solution_id == solution_id,
            ScheduledLesson.teacher_id == teacher_id,
        )
        .all()
    )
    # Deduplicate track lessons
    seen_tracks: set[tuple[int, str, int]] = set()
    occupied: dict[tuple[str, int], dict] = {}  # (day, period) -> info
    for l in lessons:
        if l.track_id is not None:
            key = (l.track_id, l.day, l.period)
            if key in seen_tracks:
                continue
            seen_tracks.add(key)
        subject = db.get(Subject, l.subject_id)
        occupied[(l.day, l.period)] = {
            "slot_type": "frontal",
            "subject_name": subject.name if subject else None,
            "class_name": None,  # could enrich later
        }

    # ── Get meetings for this teacher ──
    teacher_meeting_ids_q = (
        db.query(meeting_teachers.c.meeting_id)
        .filter(meeting_teachers.c.teacher_id == teacher_id)
        .subquery()
    )
    meetings = (
        db.query(ScheduledMeeting)
        .filter(
            ScheduledMeeting.solution_id == solution_id,
            ScheduledMeeting.meeting_id.in_(teacher_meeting_ids_q),
        )
        .all()
    )
    meeting_map: dict[int, Meeting] = {}
    for m in meetings:
        if m.meeting_id not in meeting_map:
            meeting_map[m.meeting_id] = db.get(Meeting, m.meeting_id)
        occupied[(m.day, m.period)] = {
            "slot_type": "meeting",
            "meeting_name": meeting_map[m.meeting_id].name
            if meeting_map.get(m.meeting_id)
            else None,
        }

    # Meetings count as שהייה — relabel them
    from collections import defaultdict

    meeting_count = sum(1 for info in occupied.values() if info["slot_type"] == "meeting")

    # ── Find daily spans and annotate empty slots ──
    days_periods: dict[str, list[int]] = defaultdict(list)
    for (day, period) in occupied:
        days_periods[day].append(period)

    # Collect empty slots within span per day
    empty_in_span: list[tuple[str, int]] = []
    for day, periods in sorted(days_periods.items()):
        if not periods:
            continue
        first, last = min(periods), max(periods)
        for p in range(first, last + 1):
            if (day, p) not in occupied:
                empty_in_span.append((day, p))

    # Post-solve annotation: fill פרטני first, then שהייה, then חלון
    labeled: dict[tuple[str, int], str] = {}
    remaining_pratni = individual
    remaining_staying = max(0, staying - meeting_count)  # meetings already count

    for day, p in empty_in_span:
        if remaining_pratni > 0:
            labeled[(day, p)] = "פרטני"
            remaining_pratni -= 1
        elif remaining_staying > 0:
            labeled[(day, p)] = "שהייה"
            remaining_staying -= 1
        else:
            labeled[(day, p)] = "חלון"

    # ── Build annotated slots list ──
    slots: list[TeacherSlotAnnotation] = []
    all_keys = set(occupied.keys()) | set(labeled.keys())
    for day, period in sorted(all_keys, key=lambda x: (x[0], x[1])):
        if (day, period) in occupied:
            info = occupied[(day, period)]
            slot_type = info["slot_type"]
            # Meetings are שהייה
            if slot_type == "meeting":
                slot_type = "שהייה (ישיבה)"
            slots.append(TeacherSlotAnnotation(
                day=day,
                period=period,
                slot_type=slot_type,
                subject_name=info.get("subject_name"),
                class_name=info.get("class_name"),
                meeting_name=info.get("meeting_name"),
            ))
        else:
            slots.append(TeacherSlotAnnotation(
                day=day,
                period=period,
                slot_type=labeled[(day, period)],
            ))

    actual_gaps = sum(1 for v in labeled.values() if v == "חלון")

    return TeacherPresenceRead(
        teacher_id=teacher_id,
        teacher_name=teacher.name,
        frontal_hours=frontal,
        individual_hours=individual,
        staying_hours=staying,
        allowed_gaps=allowed_gaps,
        actual_gaps=actual_gaps,
        slots=slots,
    )


@router.get("/solutions/{solution_id}/score-breakdown")
def get_score_breakdown(solution_id: int, db: Session = Depends(get_db)):
    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")
    return solution.score_breakdown or {}


class OverlapItem(BaseModel):
    type: str  # "requirement" | "track"
    id: int
    label: str
    teacher_id: int
    teacher_name: str


class OverlapConflict(BaseModel):
    teacher_id: int
    teacher_name: str
    items: list[OverlapItem]
    message: str


@router.post("/detect-overlaps", response_model=list[OverlapConflict])
def detect_teacher_overlaps(req: SolveRequest, db: Session = Depends(get_db)):
    """Detect teachers assigned to multiple concurrent items (tracks in synced clusters,
    or multiple requirements where pinned_slots collide)."""
    data = load_solver_data(db, req.school_id)

    # Build teacher -> list of assigned items + hours
    teacher_items: dict[int, list[OverlapItem]] = {}
    teacher_hours: dict[int, int] = {}

    teacher_name_map: dict[int, str] = {}
    for r in data.requirements:
        if r.teacher_id and r.teacher:
            teacher_name_map[r.teacher_id] = r.teacher.name
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id and track.teacher:
                teacher_name_map[track.teacher_id] = track.teacher.name

    # Regular requirements (non-grouped)
    for r in data.requirements:
        if r.is_grouped or r.teacher_id is None:
            continue
        subj_name = r.subject.name if r.subject else f"מקצוע {r.subject_id}"
        cg_name = next((cg.name for cg in data.class_groups if cg.id == r.class_group_id), "")
        item = OverlapItem(
            type="requirement", id=r.id,
            label=f"{subj_name} {cg_name} ({r.hours_per_week}ש)",
            teacher_id=r.teacher_id,
            teacher_name=teacher_name_map.get(r.teacher_id, f"#{r.teacher_id}"),
        )
        teacher_items.setdefault(r.teacher_id, []).append(item)
        teacher_hours[r.teacher_id] = teacher_hours.get(r.teacher_id, 0) + r.hours_per_week

    # Track items
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            item = OverlapItem(
                type="track", id=track.id,
                label=f"{track.name} ({cluster.name}, {track.hours_per_week}ש)",
                teacher_id=track.teacher_id,
                teacher_name=teacher_name_map.get(track.teacher_id, f"#{track.teacher_id}"),
            )
            teacher_items.setdefault(track.teacher_id, []).append(item)
            teacher_hours[track.teacher_id] = teacher_hours.get(track.teacher_id, 0) + track.hours_per_week

    # Meeting items + hours
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_hours[t.id] = teacher_hours.get(t.id, 0) + meeting.hours_per_week
            item = OverlapItem(
                type="meeting", id=meeting.id,
                label=f"ישיבה '{meeting.name}' ({meeting.hours_per_week}ש)",
                teacher_id=t.id,
                teacher_name=teacher_name_map.get(t.id, f"#{t.id}"),
            )
            teacher_items.setdefault(t.id, []).append(item)

    conflicts: list[OverlapConflict] = []
    seen_teacher_conflicts: set[int] = set()

    # ── Check 1: teacher assigned to multiple tracks in same synced cluster ──
    for cluster in data.clusters:
        teacher_tracks: dict[int, list] = {}
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teacher_tracks.setdefault(track.teacher_id, []).append(track)

        for tid, tks in teacher_tracks.items():
            if len(tks) < 2:
                continue
            seen_teacher_conflicts.add(tid)
            tname = teacher_name_map.get(tid, f"#{tid}")
            items_for_conflict = [
                OverlapItem(
                    type="track", id=t.id,
                    label=f"{t.name} ({cluster.name}, {t.hours_per_week}ש)",
                    teacher_id=tid,
                    teacher_name=tname,
                )
                for t in tks
            ]
            conflicts.append(OverlapConflict(
                teacher_id=tid,
                teacher_name=tname,
                items=items_for_conflict,
                message=(
                    f"מורה {tname} משובצ/ת ל-{len(tks)} רמות באשכול "
                    f"\"{cluster.name}\" שמסונכרנות יחד. "
                    f"אפשר חפיפה כדי לאפשר שיבוץ במקביל."
                ),
            ))

    # ── Check 2: pinned-slot collisions (req vs track, req vs req, etc.) ──
    # Build teacher -> [(day, period, item_type, item_id, source_label, allow_overlap)]
    teacher_pinned: dict[int, list[tuple[str, int, str, int, str, bool]]] = {}

    for r in data.requirements:
        if r.is_grouped or r.teacher_id is None:
            continue
        pinned = getattr(r, "pinned_slots", None)
        if not pinned:
            continue
        subj_name = r.subject.name if r.subject else f"מקצוע {r.subject_id}"
        cg_name = next((cg.name for cg in data.class_groups if cg.id == r.class_group_id), "")
        label = f"{subj_name} ל{cg_name} ({r.hours_per_week}ש)"
        ao = bool(getattr(r, "allow_overlap", False))
        for slot in pinned:
            day, period = slot.get("day"), slot.get("period")
            if day and period:
                teacher_pinned.setdefault(r.teacher_id, []).append(
                    (day, period, "requirement", r.id, label, ao)
                )

    # Collect pinned tracks (synced clusters inherit pins)
    cluster_pinned_slots: dict[int, list[tuple[str, int]]] = {}
    for cluster in data.clusters:
        for track in cluster.tracks:
            pinned = getattr(track, "pinned_slots", None)
            if pinned:
                for slot in pinned:
                    day, period = slot.get("day"), slot.get("period")
                    if day and period:
                        cluster_pinned_slots.setdefault(cluster.id, []).append((day, period))

    for cluster in data.clusters:
        inherited = cluster_pinned_slots.get(cluster.id, [])
        if not inherited:
            continue
        for track in cluster.tracks:
            if track.teacher_id is None or getattr(track, "is_secondary", False):
                continue
            ao = bool(getattr(track, "allow_overlap", False))
            label = f"רצועה '{track.name}' ({cluster.name}, {track.hours_per_week}ש)"
            for day, period in inherited:
                teacher_pinned.setdefault(track.teacher_id, []).append(
                    (day, period, "track", track.id, label, ao)
                )

    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        if not pinned:
            continue
        ao = bool(getattr(meeting, "allow_overlap", False))
        for slot in pinned:
            day, period = slot.get("day"), slot.get("period")
            if day and period:
                for t in meeting.teachers:
                    teacher_pinned.setdefault(t.id, []).append(
                        (day, period, "meeting", meeting.id, f"ישיבה '{meeting.name}'", ao)
                    )

    # Find collisions: same teacher, same (day, period), different items
    # Skip collisions where ALL involved items have allow_overlap=True
    for tid, entries in teacher_pinned.items():
        if tid in seen_teacher_conflicts:
            continue
        by_slot: dict[tuple[str, int], list[tuple[str, int, str, bool]]] = {}
        for day, period, item_type, item_id, label, ao in entries:
            by_slot.setdefault((day, period), []).append((item_type, item_id, label, ao))

        colliding_items: dict[tuple[str, int], str] = {}  # unique (type, id) -> label
        has_collision = False
        for (day, period), slot_entries in by_slot.items():
            if len(slot_entries) > 1:
                # Skip if ALL items in this slot have allow_overlap
                if all(ao for _, _, _, ao in slot_entries):
                    continue
                has_collision = True
                for item_type, item_id, label, _ao in slot_entries:
                    colliding_items[(item_type, item_id)] = label

        if has_collision:
            seen_teacher_conflicts.add(tid)
            tname = teacher_name_map.get(tid, f"#{tid}")
            items_list = [
                OverlapItem(
                    type=item_type, id=item_id,
                    label=label,
                    teacher_id=tid,
                    teacher_name=tname,
                )
                for (item_type, item_id), label in colliding_items.items()
            ]
            # Build collision description
            collision_descs = []
            for (day, period), slot_entries in by_slot.items():
                if len(slot_entries) > 1 and not all(ao for _, _, _, ao in slot_entries):
                    from app.solver.engine import _day_he
                    sources = " + ".join(lbl for _, _, lbl, _ in slot_entries)
                    collision_descs.append(f"{_day_he(day)} שעה {period}: {sources}")

            conflicts.append(OverlapConflict(
                teacher_id=tid,
                teacher_name=tname,
                items=items_list,
                message=(
                    f"מורה {tname}: התנגשות הצמדות — "
                    + "; ".join(collision_descs)
                    + ". אפשר חפיפה כדי לאפשר שיבוץ במקביל."
                ),
            ))

    # ── Check 3: teacher with more total hours than available slots ──
    available_set = set(data.available_slots)

    for teacher_id, items in teacher_items.items():
        if teacher_id in seen_teacher_conflicts:
            continue
        total_hours = teacher_hours.get(teacher_id, 0)
        blocked = data.teacher_blocked_slots.get(teacher_id, set())
        teacher_available = len(available_set - blocked)

        if total_hours > teacher_available and len(items) > 1:
            tname = teacher_name_map.get(teacher_id, f"#{teacher_id}")
            conflicts.append(OverlapConflict(
                teacher_id=teacher_id,
                teacher_name=tname,
                items=items,
                message=(
                    f"מורה {tname}: {total_hours} שעות נדרשות "
                    f"אך רק {teacher_available} משבצות פנויות. "
                    f"אפשר חפיפה כדי לאפשר שיבוץ במקביל."
                ),
            ))

    return conflicts


class OverlapToggleRequest(BaseModel):
    items: list[dict]  # [{"type": "requirement"|"track"|"meeting", "id": int}]
    allow: bool


@router.post("/toggle-overlaps")
def toggle_overlaps(req: OverlapToggleRequest, db: Session = Depends(get_db)):
    """Batch set allow_overlap on requirements, tracks, and/or meetings."""
    updated = 0
    for item in req.items:
        if item["type"] == "requirement":
            obj = db.get(SubjectRequirement, item["id"])
            if obj:
                obj.allow_overlap = req.allow
                updated += 1
        elif item["type"] == "track":
            obj = db.get(Track, item["id"])
            if obj:
                obj.allow_overlap = req.allow
                updated += 1
        elif item["type"] == "meeting":
            obj = db.get(Meeting, item["id"])
            if obj:
                obj.allow_overlap = req.allow
                updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/clear-all-overlaps")
def clear_all_overlaps(req: SolveRequest, db: Session = Depends(get_db)):
    """Reset allow_overlap=False on all requirements, tracks, and meetings for a school."""
    count = 0
    reqs = db.query(SubjectRequirement).filter(
        SubjectRequirement.school_id == req.school_id,
        SubjectRequirement.allow_overlap == True,
    ).all()
    for r in reqs:
        r.allow_overlap = False
        count += 1

    tracks = db.query(Track).join(
        Track.cluster
    ).filter(
        Track.allow_overlap == True,
    ).all()
    for t in tracks:
        t.allow_overlap = False
        count += 1

    meetings = db.query(Meeting).filter(
        Meeting.school_id == req.school_id,
        Meeting.allow_overlap == True,
    ).all()
    for m in meetings:
        m.allow_overlap = False
        count += 1

    db.commit()
    return {"cleared": count}


@router.post("/validate")
def validate_before_solve(req: SolveRequest, db: Session = Depends(get_db)):
    """Full pre-solve validation: data checks + constraint conflict detection."""
    data = load_solver_data(db, req.school_id)

    # Data validation
    data_issues = validate(data)

    # Constraint conflict detection
    conflicts = detect_conflicts(data, db, req.school_id)

    errors = [i for i in data_issues if i.level == "error"] + \
             [c for c in conflicts if c.level == "error"]
    warnings = [i for i in data_issues if i.level == "warning"] + \
               [c for c in conflicts if c.level == "warning"]

    return {
        "valid": len(errors) == 0,
        "errors": [
            {"level": "error", "message": i.message,
             "category": getattr(i, "category", "conflict"),
             "details": getattr(i, "details", {}),
             "constraint_ids": getattr(i, "constraint_ids", [])}
            for i in errors
        ],
        "warnings": [
            {"level": "warning", "message": i.message,
             "category": getattr(i, "category", "conflict"),
             "details": getattr(i, "details", {}),
             "constraint_ids": getattr(i, "constraint_ids", [])}
            for i in warnings
        ],
        "summary": {
            "classes": len(data.class_groups),
            "requirements": len(data.requirements),
            "available_slots": len(data.available_slots),
            "clusters": len(data.clusters),
        },
    }
