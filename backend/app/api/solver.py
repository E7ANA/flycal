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
from app.models.timetable import AllowedOverlap, ScheduledLesson, ScheduledMeeting, Solution
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


class DiagnosisItem(BaseModel):
    source: str            # "user_constraint" | "brain_rule" | "system" | "combination"
    name: str
    constraint_id: int | None = None
    rule_type: str | None = None
    details: str = ""


class SolveResponse(BaseModel):
    status: str
    message: str
    solve_time: float
    solutions: list[SolutionRead]
    diagnosis: list[DiagnosisItem] | None = None


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
    diag_items = None
    if result.diagnosis:
        diag_items = [
            DiagnosisItem(
                source=d.source,
                name=d.name,
                constraint_id=d.constraint_id,
                rule_type=d.rule_type,
                details=d.details,
            )
            for d in result.diagnosis
        ]
    return SolveResponse(
        status=result.status.value,
        message=result.message,
        solve_time=round(result.solve_time, 2),
        solutions=[SolutionRead.model_validate(s) for s in result.solutions],
        diagnosis=diag_items,
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
        diag_items = None
        if result.diagnosis:
            diag_items = [
                DiagnosisItem(
                    source=d.source,
                    name=d.name,
                    constraint_id=d.constraint_id,
                    rule_type=d.rule_type,
                    details=d.details,
                )
                for d in result.diagnosis
            ]
        resp = SolveResponse(
            status=result.status.value,
            message=result.message,
            solve_time=round(result.solve_time, 2),
            solutions=[SolutionRead.model_validate(s) for s in result.solutions],
            diagnosis=diag_items,
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


class OverlapDetectionResult(BaseModel):
    conflicts: list[OverlapConflict]
    approved: list[OverlapConflict]


@router.post("/detect-overlaps", response_model=OverlapDetectionResult)
def detect_teacher_overlaps(req: SolveRequest, db: Session = Depends(get_db)):
    """Detect teachers assigned to multiple concurrent items (tracks in synced clusters,
    or multiple requirements where pinned_slots collide).
    Returns both unresolved conflicts AND approved overlaps."""
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
    approved_cluster: list[OverlapConflict] = []
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
            # Check if ALL pairs in this group are approved
            all_approved = True
            for i in range(len(tks)):
                for j in range(i + 1, len(tks)):
                    pair = _normalize_pair("track", tks[i].id, "track", tks[j].id)
                    if pair not in data.allowed_overlap_pairs:
                        all_approved = False
                        break
                if not all_approved:
                    break

            entry = OverlapConflict(
                teacher_id=tid,
                teacher_name=tname,
                items=items_for_conflict,
                message=(
                    f"מורה {tname} משובצ/ת ל-{len(tks)} רמות באשכול "
                    f"\"{cluster.name}\" שמסונכרנות יחד."
                    + ("" if all_approved else " אפשר חפיפה כדי לאפשר שיבוץ במקביל.")
                ),
            )
            if all_approved:
                approved_cluster.append(entry)
            else:
                conflicts.append(entry)

    # ── Check 2: pinned-slot collisions (req vs track, req vs req, etc.) ──
    # Build teacher -> [(day, period, item_type, item_id, source_label)]
    from app.solver.model_builder import _normalize_pair
    teacher_pinned: dict[int, list[tuple[str, int, str, int, str]]] = {}

    for r in data.requirements:
        if r.is_grouped or r.teacher_id is None:
            continue
        pinned = getattr(r, "pinned_slots", None)
        if not pinned:
            continue
        subj_name = r.subject.name if r.subject else f"מקצוע {r.subject_id}"
        cg_name = next((cg.name for cg in data.class_groups if cg.id == r.class_group_id), "")
        label = f"{subj_name} ל{cg_name} ({r.hours_per_week}ש)"
        for slot in pinned:
            day, period = slot.get("day"), slot.get("period")
            if day and period:
                teacher_pinned.setdefault(r.teacher_id, []).append(
                    (day, period, "requirement", r.id, label)
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
            label = f"רצועה '{track.name}' ({cluster.name}, {track.hours_per_week}ש)"
            for day, period in inherited:
                teacher_pinned.setdefault(track.teacher_id, []).append(
                    (day, period, "track", track.id, label)
                )

    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        if not pinned:
            continue
        for slot in pinned:
            day, period = slot.get("day"), slot.get("period")
            if day and period:
                for t in meeting.teachers:
                    teacher_pinned.setdefault(t.id, []).append(
                        (day, period, "meeting", meeting.id, f"ישיבה '{meeting.name}'")
                    )

    # Find collisions: same teacher, same (day, period), different items
    # Separate into unresolved conflicts vs approved overlaps
    approved: list[OverlapConflict] = []
    for tid, entries in teacher_pinned.items():
        if tid in seen_teacher_conflicts:
            continue
        by_slot: dict[tuple[str, int], list[tuple[str, int, str]]] = {}
        for day, period, item_type, item_id, label in entries:
            by_slot.setdefault((day, period), []).append((item_type, item_id, label))

        colliding_items: dict[tuple[str, int], str] = {}
        approved_items: dict[tuple[str, int], str] = {}
        has_collision = False
        has_approved = False
        for (day, period), slot_entries in by_slot.items():
            if len(slot_entries) > 1:
                any_disallowed = False
                for i in range(len(slot_entries)):
                    for j in range(i + 1, len(slot_entries)):
                        pair = _normalize_pair(
                            slot_entries[i][0], slot_entries[i][1],
                            slot_entries[j][0], slot_entries[j][1],
                        )
                        if pair not in data.allowed_overlap_pairs:
                            any_disallowed = True
                            break
                    if any_disallowed:
                        break
                if any_disallowed:
                    has_collision = True
                    for item_type, item_id, label in slot_entries:
                        colliding_items[(item_type, item_id)] = label
                else:
                    has_approved = True
                    for item_type, item_id, label in slot_entries:
                        approved_items[(item_type, item_id)] = label

        tname = teacher_name_map.get(tid, f"#{tid}")

        if has_collision:
            seen_teacher_conflicts.add(tid)
            items_list = [
                OverlapItem(
                    type=item_type, id=item_id,
                    label=label,
                    teacher_id=tid,
                    teacher_name=tname,
                )
                for (item_type, item_id), label in colliding_items.items()
            ]
            collision_descs = []
            for (day, period), slot_entries in by_slot.items():
                if len(slot_entries) > 1:
                    any_disallowed = any(
                        _normalize_pair(
                            slot_entries[i][0], slot_entries[i][1],
                            slot_entries[j][0], slot_entries[j][1],
                        ) not in data.allowed_overlap_pairs
                        for i in range(len(slot_entries))
                        for j in range(i + 1, len(slot_entries))
                    )
                    if any_disallowed:
                        from app.solver.engine import _day_he
                        sources = " + ".join(lbl for _, _, lbl in slot_entries)
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

        if has_approved:
            approved_list = [
                OverlapItem(
                    type=item_type, id=item_id,
                    label=label,
                    teacher_id=tid,
                    teacher_name=tname,
                )
                for (item_type, item_id), label in approved_items.items()
            ]
            approved_descs = []
            for (day, period), slot_entries in by_slot.items():
                if len(slot_entries) > 1:
                    all_allowed = all(
                        _normalize_pair(
                            slot_entries[i][0], slot_entries[i][1],
                            slot_entries[j][0], slot_entries[j][1],
                        ) in data.allowed_overlap_pairs
                        for i in range(len(slot_entries))
                        for j in range(i + 1, len(slot_entries))
                    )
                    if all_allowed:
                        from app.solver.engine import _day_he
                        sources = " + ".join(lbl for _, _, lbl in slot_entries)
                        approved_descs.append(f"{_day_he(day)} שעה {period}: {sources}")

            approved.append(OverlapConflict(
                teacher_id=tid,
                teacher_name=tname,
                items=approved_list,
                message=(
                    f"מורה {tname}: חפיפה מאושרת — "
                    + "; ".join(approved_descs)
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

    # ── Check 4: pinned meeting attendance conflicts ──
    # For pinned meetings, detect teachers whose teaching is forced to other days
    # (all their tracks are pinned to days that don't include the meeting day).
    # These teachers can be excused from the meeting.
    approved_absences: list[OverlapConflict] = []

    # Precompute: which days are forced for each cluster (from pinned tracks)
    cluster_forced_days: dict[int, set[str]] = {}
    for cluster in data.clusters:
        forced: set[str] = set()
        for track in cluster.tracks:
            pinned = getattr(track, "pinned_slots", None)
            if pinned:
                for s in pinned:
                    if s.get("day"):
                        forced.add(s["day"])
        if forced:
            cluster_forced_days[cluster.id] = forced

    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        if not pinned:
            continue
        meeting_days = set(s["day"] for s in pinned if s.get("day"))
        if not meeting_days:
            continue

        for teacher in meeting.teachers:
            tid = teacher.id
            tname = teacher_name_map.get(tid, teacher.name if hasattr(teacher, "name") else f"#{tid}")

            # Check if teacher has any non-track (flexible) teaching
            has_flexible = any(
                r.teacher_id == tid and not r.is_grouped
                for r in data.requirements
            )
            if has_flexible:
                continue  # Requirements can be placed on meeting day

            # Collect days forced by teacher's tracks
            teacher_forced_days: set[str] = set()
            has_unpinned = False
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id != tid:
                        continue
                    cdays = cluster_forced_days.get(cluster.id)
                    if cdays:
                        teacher_forced_days.update(cdays)
                    else:
                        has_unpinned = True

            if has_unpinned:
                continue  # Unpinned tracks can be placed on meeting day

            if not teacher_forced_days:
                continue  # No teaching at all (admin)

            # Teacher only teaches via pinned tracks — check if any day overlaps
            if teacher_forced_days.intersection(meeting_days):
                continue  # Teacher teaches on at least one meeting day

            # Conflict: teacher's teaching days don't include any meeting day
            from app.solver.engine import _day_he
            meeting_days_he = ", ".join(_day_he(d) for d in sorted(meeting_days))
            teach_days_he = ", ".join(_day_he(d) for d in sorted(teacher_forced_days))

            pair = _normalize_pair("meeting", meeting.id, "teacher_absence", tid)
            is_approved = pair in data.allowed_overlap_pairs

            meeting_item = OverlapItem(
                type="meeting", id=meeting.id,
                label=f"ישיבה '{meeting.name}' ({meeting_days_he})",
                teacher_id=tid,
                teacher_name=tname,
            )
            absence_item = OverlapItem(
                type="teacher_absence", id=tid,
                label=f"מלמד/ת רק ב{teach_days_he}",
                teacher_id=tid,
                teacher_name=tname,
            )

            entry = OverlapConflict(
                teacher_id=tid,
                teacher_name=tname,
                items=[meeting_item, absence_item],
                message=(
                    f"מורה {tname} לא מלמד/ת ביום הישיבה ({meeting_days_he}) "
                    f"— מלמד/ת רק ב{teach_days_he}. "
                    + ("נעדר/ת מהישיבה (מאושר)." if is_approved
                       else "אשר/י היעדרות מהישיבה.")
                ),
            )
            if is_approved:
                approved_absences.append(entry)
            else:
                conflicts.append(entry)

    return OverlapDetectionResult(
        conflicts=conflicts,
        approved=approved_cluster + approved + approved_absences,
    )


class OverlapToggleRequest(BaseModel):
    school_id: int
    items: list[dict]  # [{"type": "requirement"|"track"|"meeting", "id": int}]
    allow: bool


@router.post("/toggle-overlaps")
def toggle_overlaps(req: OverlapToggleRequest, db: Session = Depends(get_db)):
    """Create or remove specific allowed overlap pairs.

    When allow=True: for all pairs in the items list, create AllowedOverlap
    records so ONLY those specific pairs can coexist.
    When allow=False: remove the specific pairs.
    """
    from app.solver.model_builder import _normalize_pair

    # Build all pairs from the items list
    pairs: list[tuple[str, int, str, int]] = []
    for i in range(len(req.items)):
        for j in range(i + 1, len(req.items)):
            a, b = req.items[i], req.items[j]
            pairs.append((a["type"], a["id"], b["type"], b["id"]))

    updated = 0
    for t1, id1, t2, id2 in pairs:
        nt1, nid1 = _normalize_pair(t1, id1, t2, id2)[0]
        nt2, nid2 = _normalize_pair(t1, id1, t2, id2)[1]

        existing = db.query(AllowedOverlap).filter(
            AllowedOverlap.school_id == req.school_id,
            AllowedOverlap.item1_type == nt1,
            AllowedOverlap.item1_id == nid1,
            AllowedOverlap.item2_type == nt2,
            AllowedOverlap.item2_id == nid2,
        ).first()

        if req.allow and not existing:
            db.add(AllowedOverlap(
                school_id=req.school_id,
                item1_type=nt1, item1_id=nid1,
                item2_type=nt2, item2_id=nid2,
            ))
            updated += 1
        elif not req.allow and existing:
            db.delete(existing)
            updated += 1

    db.commit()
    return {"updated": updated}


@router.post("/clear-all-overlaps")
def clear_all_overlaps(req: SolveRequest, db: Session = Depends(get_db)):
    """Remove all allowed overlap pairs for a school, and clear legacy flags."""
    count = 0

    # Clear new pair-based overlaps
    ao_rows = db.query(AllowedOverlap).filter(
        AllowedOverlap.school_id == req.school_id
    ).all()
    for ao in ao_rows:
        db.delete(ao)
        count += 1

    # Also clear legacy allow_overlap flags
    reqs = db.query(SubjectRequirement).filter(
        SubjectRequirement.school_id == req.school_id,
        SubjectRequirement.allow_overlap == True,
    ).all()
    for r in reqs:
        r.allow_overlap = False
        count += 1

    tracks = db.query(Track).join(Track.cluster).filter(
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


@router.get("/meeting-absences")
def get_meeting_absences(school_id: int, db: Session = Depends(get_db)):
    """Return teachers excused from meetings (approved teacher_absence pairs)."""
    absences = (
        db.query(AllowedOverlap)
        .filter(
            AllowedOverlap.school_id == school_id,
            AllowedOverlap.item2_type == "teacher_absence",
        )
        .all()
    )
    result = []
    for ao in absences:
        meeting = db.get(Meeting, ao.item1_id) if ao.item1_type == "meeting" else None
        teacher = db.get(Teacher, ao.item2_id)
        if meeting and teacher:
            result.append({
                "meeting_id": meeting.id,
                "meeting_name": meeting.name,
                "teacher_id": teacher.id,
                "teacher_name": teacher.name,
            })
    return result


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
