"""Main solver orchestrator — the heart of the application.

Pipeline: validate → build model → solve → parse → score → save.
"""

import threading
import time
from dataclasses import dataclass, field

from ortools.sat.python import cp_model
from sqlalchemy.orm import Session

from app.config import settings
from app.models.meeting import Meeting
from app.models.subject import SubjectRequirement
from app.models.class_group import Track
from app.models.timetable import ScheduledLesson, ScheduledMeeting, Solution, SolutionStatus
from app.solver.constraint_compiler import compile_all_constraints
from app.solver.model_builder import (
    SolverData,
    SolverVariables,
    add_system_constraints,
    create_variables,
    load_solver_data,
)
from app.solver.brain import apply_brain_constraints
from app.solver.scorer import compute_score_breakdown_from_snapshot
from app.solver.solution_parser import parse_solution_from_snapshot
from app.solver.violation_detector import detect_violations


# ── Progress tracking ────────────────────────────────────────────────────
# Thread-safe progress store keyed by job_id.

@dataclass
class SolveProgress:
    """Mutable progress state for a running solve job."""
    step: str = "initializing"
    step_number: int = 0
    total_steps: int = 9
    percent: int = 0
    best_objective: float | None = None
    solutions_found: int = 0
    elapsed: float = 0.0
    done: bool = False
    result_status: str | None = None
    result_message: str | None = None

_progress_store: dict[str, SolveProgress] = {}
_progress_lock = threading.Lock()


def get_progress(job_id: str) -> SolveProgress | None:
    with _progress_lock:
        return _progress_store.get(job_id)


def _set_progress(job_id: str, **kwargs) -> None:
    with _progress_lock:
        p = _progress_store.get(job_id)
        if p:
            for k, v in kwargs.items():
                setattr(p, k, v)


def _init_progress(job_id: str) -> None:
    with _progress_lock:
        _progress_store[job_id] = SolveProgress()


def _clear_progress(job_id: str) -> None:
    with _progress_lock:
        _progress_store.pop(job_id, None)


@dataclass
class InfeasibilityConflict:
    """A single constraint/rule that contributes to infeasibility."""
    source: str            # "user_constraint" | "brain_rule" | "system"
    name: str              # Human-readable name
    constraint_id: int | None = None
    rule_type: str | None = None
    details: str = ""


@dataclass
class SolveResult:
    status: SolutionStatus
    solutions: list[Solution]
    solve_time: float
    message: str
    diagnosis: list[InfeasibilityConflict] | None = None


@dataclass
class SolutionSnapshot:
    """A captured snapshot of variable assignments from the solver callback."""
    # key -> 1 for active variables
    x_values: dict[tuple[int, int, int, str, int], int]
    x_track_values: dict[tuple[int, str, int], int]
    x_meeting_values: dict[tuple[int, str, int], int]
    penalty_values: list[tuple[int, int, int]]  # (value, weight, constraint_id)
    penalty_upper_bounds: list[int]  # upper bound for each penalty variable
    objective_value: float


class MultiSolutionCallback(cp_model.CpSolverSolutionCallback):
    """Collects solutions during solving.

    When max_solutions == 1: keeps only the best solution found so far
    and lets the solver continue optimising until time runs out.
    When max_solutions > 1: collects diverse solutions and stops early.
    """

    def __init__(
        self,
        variables: SolverVariables,
        data: SolverData,
        max_solutions: int = 5,
        job_id: str | None = None,
        max_time: float = 300,
    ):
        super().__init__()
        self._variables = variables
        self._data = data
        self._max_solutions = max_solutions
        self.snapshots: list[SolutionSnapshot] = []
        self._fingerprints: list[set[str]] = []
        self._best_objective: float | None = None
        self._job_id = job_id
        self._max_time = max_time
        self._start_time = time.time()
        # Upper bounds computed lazily at first snapshot capture
        self._penalty_upper_bounds: list[int] | None = None

    def _compute_penalty_upper_bounds(self) -> list[int]:
        """Compute upper bounds for all penalty variables.

        Done lazily at first snapshot capture so that all penalties
        (including brain constraints added after user constraints) are included.
        """
        bounds: list[int] = []
        for var, _w, _cid in self._variables.penalties:
            try:
                domain = var.proto.domain
                ub = domain[len(domain) - 1] if len(domain) > 0 else 1
                bounds.append(max(ub, 1))  # At least 1 to avoid zero max_possible
            except (IndexError, AttributeError):
                bounds.append(1)
        return bounds

    def _capture_snapshot(self) -> SolutionSnapshot:
        # Compute upper bounds on first call (all penalties registered by now)
        if self._penalty_upper_bounds is None:
            self._penalty_upper_bounds = self._compute_penalty_upper_bounds()

        x_values: dict[tuple[int, int, int, str, int], int] = {}
        for key, var in self._variables.x.items():
            if self.value(var) == 1:
                x_values[key] = 1

        x_track_values: dict[tuple[int, str, int], int] = {}
        for key, var in self._variables.x_track.items():
            if self.value(var) == 1:
                x_track_values[key] = 1

        x_meeting_values: dict[tuple[int, str, int], int] = {}
        for key, var in self._variables.x_meeting.items():
            if self.value(var) == 1:
                x_meeting_values[key] = 1

        penalty_values = [
            (self.value(var), weight, cid)
            for var, weight, cid in self._variables.penalties
        ]

        return SolutionSnapshot(
            x_values=x_values,
            x_track_values=x_track_values,
            x_meeting_values=x_meeting_values,
            penalty_values=penalty_values,
            penalty_upper_bounds=self._penalty_upper_bounds,
            objective_value=self.objective_value,
        )

    def _report_progress(self) -> None:
        if not self._job_id:
            return
        elapsed = time.time() - self._start_time
        # Compute time-based percentage for the solving step (step 7)
        time_pct = min(int(elapsed / self._max_time * 100), 99) if self._max_time > 0 else 0
        _set_progress(
            self._job_id,
            step="solving",
            step_number=7,
            percent=time_pct,
            best_objective=self._best_objective,
            solutions_found=len(self.snapshots),
            elapsed=round(elapsed, 1),
        )

    def on_solution_callback(self) -> None:
        self._best_objective = self.objective_value

        if self._max_solutions == 1:
            # Single-solution mode: keep the best, let solver keep optimising
            snapshot = self._capture_snapshot()
            if not self.snapshots:
                self.snapshots.append(snapshot)
            else:
                self.snapshots[0] = snapshot  # Replace with improved solution
            self._report_progress()
            return

        # Multi-solution mode: collect diverse solutions
        snapshot = self._capture_snapshot()
        fingerprint: set[str] = set()
        for key in snapshot.x_values:
            fingerprint.add(str(key))
        for key in snapshot.x_track_values:
            fingerprint.add(f"tr_{key}")
        for key in snapshot.x_meeting_values:
            fingerprint.add(f"mt_{key}")

        for existing_fp in self._fingerprints:
            overlap = len(fingerprint & existing_fp)
            total = max(len(fingerprint | existing_fp), 1)
            if overlap / total > 0.9:
                self._report_progress()
                return  # Too similar, skip

        self.snapshots.append(snapshot)
        self._fingerprints.append(fingerprint)
        self._report_progress()

        if len(self.snapshots) >= self._max_solutions:
            self.stop_search()

    @property
    def solution_count(self) -> int:
        return len(self.snapshots)


def validate_data(data: SolverData) -> list[str]:
    """Pre-solve validation. Returns list of error messages."""
    errors: list[str] = []

    if not data.class_groups:
        errors.append("אין כיתות מוגדרות")
    if not data.requirements:
        errors.append("אין דרישות מקצועות מוגדרות")
    if not data.available_slots:
        errors.append("אין משבצות זמן זמינות — יש לייצר timeslots")

    # Check total hours fit
    total_slots = len(data.available_slots)
    if total_slots == 0:
        errors.append("אין משבצות זמינות")
    else:
        max_class_slots = total_slots
        for req in data.requirements:
            if req.is_grouped or req.teacher_id is None:
                continue
            if req.hours_per_week > max_class_slots:
                errors.append(
                    f"דרישת שעות ({req.hours_per_week}) חורגת ממשבצות זמינות "
                    f"({max_class_slots}) עבור כיתה {req.class_group_id} מקצוע {req.subject_id}"
                )

    # Check teachers have assignments
    for req in data.requirements:
        if not req.is_grouped and req.teacher_id is None:
            errors.append(
                f"לא הוקצה מורה לדרישה: כיתה {req.class_group_id} מקצוע {req.subject_id}"
            )

    # Check per-teacher capacity (hours vs available slots after blocks)
    available_set = set(data.available_slots)
    teacher_hours: dict[int, int] = {}
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        teacher_hours[req.teacher_id] = (
            teacher_hours.get(req.teacher_id, 0) + req.hours_per_week
        )
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teacher_hours[track.teacher_id] = (
                    teacher_hours.get(track.teacher_id, 0) + track.hours_per_week
                )
    # NOTE: meeting hours not counted — meetings use separate x_meeting variables.
    teacher_name_map: dict[int, str] = {}
    for req in data.requirements:
        if req.teacher_id and req.teacher:
            teacher_name_map[req.teacher_id] = req.teacher.name
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id and track.teacher:
                teacher_name_map[track.teacher_id] = track.teacher.name
    for tid, hours in teacher_hours.items():
        blocked = data.teacher_blocked_slots.get(tid, set())
        t_available = len(available_set - blocked)
        tname = teacher_name_map.get(tid, f"#{tid}")
        if hours > t_available:
            errors.append(
                f"מורה {tname}: {hours} שעות נדרשות "
                f"אך רק {t_available} משבצות פנויות אחרי חסימות"
            )

    # Check meetings
    for meeting in data.meetings:
        if not meeting.teachers:
            errors.append(f"ישיבה '{meeting.name}' ללא מורים משויכים")
        if meeting.hours_per_week <= 0:
            errors.append(f"ישיבה '{meeting.name}' עם 0 שעות")

    # Check pinned-slot conflicts
    errors.extend(_check_pinned_conflicts(data, teacher_name_map))

    return errors


def _check_pinned_conflicts(
    data: SolverData, teacher_name_map: dict[int, str]
) -> list[str]:
    """Detect conflicts caused by pinned slots.

    Checks:
    1. Teacher pinned in two places at the same timeslot
    2. Pinned slots on teacher-blocked timeslots
    3. Synced cluster tracks that inherit pinned slots and create teacher overlaps

    Skips conflicts where all involved PAIRS are in allowed_overlap_pairs.
    """
    from app.solver.model_builder import _normalize_pair

    errors: list[str] = []

    # Build map: teacher_id -> [(day, period, item_type, item_id, source_description)]
    teacher_pinned: dict[int, list[tuple[str, int, str, int, str]]] = {}

    # Collect pinned regular lessons
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        pinned = getattr(req, "pinned_slots", None)
        if not pinned:
            continue
        subj_name = req.subject.name if req.subject else f"מקצוע {req.subject_id}"
        class_name = None
        for cg in data.class_groups:
            if cg.id == req.class_group_id:
                class_name = cg.name
                break
        class_label = class_name or f"כיתה {req.class_group_id}"
        source = f"{subj_name} ל{class_label}"

        for slot in pinned:
            day = slot.get("day")
            period = slot.get("period")
            if day and period:
                teacher_pinned.setdefault(req.teacher_id, []).append(
                    (day, period, "requirement", req.id, source)
                )

    # Collect pinned tracks — including inherited pins via grouping sync
    cluster_pinned: dict[int, list[tuple[str, int]]] = {}
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            pinned = getattr(track, "pinned_slots", None)
            if not pinned:
                continue
            for slot in pinned:
                day = slot.get("day")
                period = slot.get("period")
                if day and period:
                    cluster_pinned.setdefault(cluster.id, []).append(
                        (day, period)
                    )

    for cluster in data.clusters:
        inherited_slots = cluster_pinned.get(cluster.id, [])
        if not inherited_slots:
            continue

        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            if getattr(track, "is_secondary", False):
                continue
            source = f"רצועה '{track.name}' באשכול '{cluster.name}' (סנכרון)"
            for day, period in inherited_slots:
                teacher_pinned.setdefault(track.teacher_id, []).append(
                    (day, period, "track", track.id, source)
                )

    # Collect pinned meetings (skip excused teachers)
    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        if not pinned:
            continue
        for slot in pinned:
            day = slot.get("day")
            period = slot.get("period")
            if day and period:
                for t in meeting.teachers:
                    # Skip teachers excused from this meeting
                    excused_pair = _normalize_pair(
                        "meeting", meeting.id, "teacher_absence", t.id
                    )
                    if excused_pair in data.allowed_overlap_pairs:
                        continue
                    teacher_pinned.setdefault(t.id, []).append(
                        (day, period, "meeting", meeting.id, f"ישיבה '{meeting.name}'")
                    )

    # Check for overlaps: same teacher pinned at same (day, period) from different sources
    # Skip pairs that are in allowed_overlap_pairs
    for tid, entries in teacher_pinned.items():
        tname = teacher_name_map.get(tid, f"מורה #{tid}")
        by_slot: dict[tuple[str, int], list[tuple[str, int, str]]] = {}
        for day, period, item_type, item_id, source in entries:
            by_slot.setdefault((day, period), []).append((item_type, item_id, source))

        for (day, period), slot_entries in by_slot.items():
            # Check if slot is blocked
            blocked = data.teacher_blocked_slots.get(tid, set())
            if (day, period) in blocked:
                errors.append(
                    f"מורה {tname}: הצמדה ל{_day_he(day)} שעה {period} "
                    f"({slot_entries[0][2]}) אבל המורה חסומה בזמן הזה"
                )

            # Check overlaps — skip pairs that are specifically allowed
            if len(slot_entries) > 1:
                has_disallowed_pair = False
                for i in range(len(slot_entries)):
                    for j in range(i + 1, len(slot_entries)):
                        pair = _normalize_pair(
                            slot_entries[i][0], slot_entries[i][1],
                            slot_entries[j][0], slot_entries[j][1],
                        )
                        if pair not in data.allowed_overlap_pairs:
                            has_disallowed_pair = True
                            break
                    if has_disallowed_pair:
                        break

                if has_disallowed_pair:
                    sources_str = " + ".join(src for _, _, src in slot_entries)
                    errors.append(
                        f"מורה {tname}: התנגשות הצמדות ב{_day_he(day)} שעה {period} — "
                        f"{sources_str}"
                    )

    return errors


_DAY_HEBREW = {
    "SUNDAY": "יום ראשון",
    "MONDAY": "יום שני",
    "TUESDAY": "יום שלישי",
    "WEDNESDAY": "יום רביעי",
    "THURSDAY": "יום חמישי",
    "FRIDAY": "יום שישי",
}


def _day_he(day: str) -> str:
    return _DAY_HEBREW.get(day, day)


def _diagnose_infeasibility(
    data: SolverData,
    db: Session,
    school_id: int,
    job_id: str | None = None,
) -> list[InfeasibilityConflict]:
    """Diagnose why the model is infeasible.

    Strategy (5 phases):
    0. Check system constraints alone — if infeasible, provide specific details
       about which teachers/classes/clusters are over-capacity.
    1. Test user constraints by rule-type group against system constraints.
    2. Drill into problematic groups to find specific constraints, with
       detailed conflict messages explaining WHY.
    2.5. Test pairs of problematic rule-type groups together to find
         cross-type combinations that cause infeasibility.
    3. Test brain rules on top of system + user constraints.
    4. Fallback: full combination message.

    Returns a list of conflicting constraints/rules.
    """
    import logging
    from collections import defaultdict
    from itertools import combinations
    from app.models.constraint import Constraint
    from app.solver.constraint_compiler import _compile_one, compile_all_constraints
    from app.solver import brain as brain_module
    from app.solver.model_builder import _normalize_pair

    log = logging.getLogger("solver.diagnosis")

    _QUICK_TIME = 5  # seconds per test
    _QUICK_WORKERS = 4

    def _quick_solve(model: cp_model.CpModel) -> int:
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = _QUICK_TIME
        solver.parameters.num_workers = _QUICK_WORKERS
        return solver.solve(model)

    def _build_base():
        """Build system-only model (known feasible baseline)."""
        m = cp_model.CpModel()
        v = create_variables(m, data)
        add_system_constraints(m, data, v)
        return m, v

    # ── Helper: build name maps ────────────────────────────────────────
    teacher_name_map: dict[int, str] = {}
    for req in data.requirements:
        if req.teacher_id and req.teacher:
            teacher_name_map[req.teacher_id] = req.teacher.name
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id and track.teacher:
                teacher_name_map[track.teacher_id] = track.teacher.name
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_name_map[t.id] = t.name

    class_name_map: dict[int, str] = {
        cg.id: cg.name for cg in data.class_groups
    }

    available_set = set(data.available_slots)
    slots_per_day: dict[str, set[int]] = defaultdict(set)
    for day, period in data.available_slots:
        slots_per_day[day].add(period)

    def _tname(tid: int) -> str:
        return teacher_name_map.get(tid, f"מורה #{tid}")

    def _cname(cid: int) -> str:
        return class_name_map.get(cid, f"כיתה #{cid}")

    # ── Helper: compute teacher hours and available slots ──────────────
    def _teacher_hours_and_availability() -> tuple[
        dict[int, int],
        dict[int, int],
        dict[int, list[str]],  # teacher -> list of assignment descriptions
    ]:
        """Return (teacher_total_hours, teacher_available_count, teacher_assignments)."""
        t_hours: dict[int, int] = defaultdict(int)
        t_assignments: dict[int, list[str]] = defaultdict(list)

        for req in data.requirements:
            if req.is_grouped or req.teacher_id is None:
                continue
            t_hours[req.teacher_id] += req.hours_per_week
            subj = req.subject.name if req.subject else f"מקצוע {req.subject_id}"
            t_assignments[req.teacher_id].append(
                f"{subj} ל{_cname(req.class_group_id)} ({req.hours_per_week}ש)"
            )

        for cluster in data.clusters:
            for track in cluster.tracks:
                if track.teacher_id is not None:
                    t_hours[track.teacher_id] += track.hours_per_week
                    t_assignments[track.teacher_id].append(
                        f"רצועה '{track.name}' ({track.hours_per_week}ש)"
                    )

        for meeting in data.meetings:
            for t in meeting.teachers:
                t_hours[t.id] += meeting.hours_per_week
                t_assignments[t.id].append(
                    f"ישיבה '{meeting.name}' ({meeting.hours_per_week}ש)"
                )

        t_avail: dict[int, int] = {}
        for tid in t_hours:
            blocked = data.teacher_blocked_slots.get(tid, set())
            t_avail[tid] = len(available_set - blocked)

        return dict(t_hours), t_avail, dict(t_assignments)

    # ── Helper: compute class hours ────────────────────────────────────
    def _class_hours() -> dict[int, int]:
        c_hours: dict[int, int] = defaultdict(int)
        for req in data.requirements:
            if req.is_grouped or req.teacher_id is None:
                continue
            c_hours[req.class_group_id] += req.hours_per_week
        # Clusters: hours apply to all source classes
        for cluster in data.clusters:
            if cluster.tracks:
                track_hours = max(t.hours_per_week for t in cluster.tracks)
                for sc in cluster.source_classes:
                    c_hours[sc.id] += track_hours
        return dict(c_hours)

    # ── Helper: detailed constraint explanation ────────────────────────
    def _explain_constraint(c) -> str:
        """Generate a detailed explanation of WHY a constraint conflicts."""
        rt = str(c.rule_type)
        params = c.parameters or {}
        target_id = c.target_id

        if rt == "BLOCK_DAY":
            day = params.get("day", "?")
            day_he = _day_he(day)
            if target_id and c.category in ("TEACHER",):
                tname = _tname(target_id)
                t_hours_map, t_avail_map, _ = _teacher_hours_and_availability()
                total_h = t_hours_map.get(target_id, 0)
                blocked_base = data.teacher_blocked_slots.get(target_id, set())
                # Count how many slots are on that day
                day_slots = slots_per_day.get(day, set())
                avail_after = len(available_set - blocked_base) - len(day_slots)
                return (
                    f"המורה {tname} חסומה ב{day_he}, אבל יש לה {total_h} שעות "
                    f"לשבץ ורק {max(avail_after, 0)} סלוטים פנויים אחרי החסימה. "
                    f"נסו לשנות ל-SOFT או לבטל זמנית."
                )
            return (
                f"חסימת {day_he} סותרת את אילוצי המערכת. "
                f"נסו לשנות ל-SOFT או לבטל זמנית."
            )

        if rt == "BLOCK_TIMESLOT":
            day = params.get("day", "?")
            period = params.get("period", "?")
            if target_id and c.category in ("TEACHER",):
                tname = _tname(target_id)
                return (
                    f"חסימת {tname} ב{_day_he(day)} שעה {period} "
                    f"מצמצמת את הסלוטים הפנויים מתחת לשעות הנדרשות. "
                    f"נסו לשנות ל-SOFT או לבטל."
                )
            return (
                f"חסימת סלוט {_day_he(day)} שעה {period} סותרת את אילוצי המערכת. "
                f"נסו לשנות ל-SOFT או לבטל."
            )

        if rt == "BLOCK_TIME_RANGE":
            day = params.get("day", "ALL")
            fp = params.get("from_period", "?")
            tp = params.get("to_period", "?")
            day_label = "כל הימים" if day == "ALL" else _day_he(day)
            if target_id and c.category in ("TEACHER",):
                tname = _tname(target_id)
                return (
                    f"חסימת טווח שעות {fp}-{tp} ב{day_label} עבור {tname} "
                    f"מצמצמת יותר מדי סלוטים. "
                    f"נסו לשנות ל-SOFT או לצמצם את הטווח."
                )
            return (
                f"חסימת טווח שעות {fp}-{tp} ב{day_label} סותרת אילוצי מערכת. "
                f"נסו לשנות ל-SOFT."
            )

        if rt == "MAX_TEACHING_HOURS_PER_DAY":
            max_h = params.get("max", "?")
            if target_id:
                tname = _tname(target_id)
                t_hours_map, _, _ = _teacher_hours_and_availability()
                total_h = t_hours_map.get(target_id, 0)
                num_days = len(data.days)
                min_needed = (total_h + int(max_h) - 1) // int(max_h) if int(max_h) > 0 else num_days
                return (
                    f"למורה {tname} יש {total_h} שעות, ומקסימום {max_h} ליום "
                    f"דורש לפחות {min_needed} ימים, אבל אין מספיק ימים/סלוטים פנויים. "
                    f"נסו להגדיל את המקסימום או לשנות ל-SOFT."
                )
            return (
                f"מגבלת {max_h} שעות הוראה ליום סותרת — לא מספיק ימים. "
                f"נסו לשנות ל-SOFT."
            )

        if rt == "MAX_TEACHING_DAYS":
            max_d = params.get("max_days", "?")
            if target_id:
                tname = _tname(target_id)
                t_hours_map, _, _ = _teacher_hours_and_availability()
                total_h = t_hours_map.get(target_id, 0)
                max_per_day = max(len(v) for v in slots_per_day.values()) if slots_per_day else 0
                return (
                    f"למורה {tname} יש {total_h} שעות, אבל מוגבל ל-{max_d} ימים "
                    f"(מקסימום {max_per_day} שעות ביום) — לא מספיק קיבולת. "
                    f"נסו להגדיל מספר הימים או לשנות ל-SOFT."
                )
            return (
                f"מגבלת {max_d} ימי הוראה סותרת את נפח השעות. "
                f"נסו לשנות ל-SOFT."
            )

        if rt == "MIN_FREE_DAYS":
            min_d = params.get("min_days", "?")
            if target_id:
                tname = _tname(target_id)
                allowed_days = len(data.days) - int(min_d) if isinstance(min_d, int) else "?"
                t_hours_map, _, _ = _teacher_hours_and_availability()
                total_h = t_hours_map.get(target_id, 0)
                return (
                    f"למורה {tname} יש {total_h} שעות, אבל {min_d} ימים חופשיים "
                    f"מותירים רק {allowed_days} ימי עבודה — לא מספיק. "
                    f"נסו להפחית ימים חופשיים או לשנות ל-SOFT."
                )
            return f"דרישה ל-{min_d} ימים חופשיים סותרת. נסו לשנות ל-SOFT."

        if rt in ("MAX_PER_DAY", "MIN_DAYS_SPREAD", "REQUIRE_CONSECUTIVE_PERIODS"):
            subj_name = ""
            if target_id:
                for s in data.all_subjects:
                    if s.id == target_id:
                        subj_name = s.name
                        break
            if rt == "MAX_PER_DAY":
                max_v = params.get("max", "?")
                return (
                    f"מגבלת {max_v} שעות ליום עבור מקצוע '{subj_name or target_id}' "
                    f"סותרת — לא מספיק ימים לפזר את כל השעות הנדרשות. "
                    f"נסו להגדיל את המקסימום או לשנות ל-SOFT."
                )
            if rt == "MIN_DAYS_SPREAD":
                min_d = params.get("min_days", "?")
                return (
                    f"פיזור מינימלי ל-{min_d} ימים עבור '{subj_name or target_id}' "
                    f"סותר — אין מספיק ימים פנויים. נסו לשנות ל-SOFT."
                )
            if rt == "REQUIRE_CONSECUTIVE_PERIODS":
                cnt = params.get("consecutive_count", 2)
                return (
                    f"דרישת {cnt} שעות רצופות עבור '{subj_name or target_id}' "
                    f"סותרת — אין מספיק סלוטים רצופים. נסו לשנות ל-SOFT."
                )

        if rt == "NO_GAPS":
            entity = ""
            if c.category == "TEACHER" and target_id:
                entity = f"מורה {_tname(target_id)}"
            elif c.category == "CLASS" and target_id:
                entity = f"כיתה {_cname(target_id)}"
            return (
                f"איסור חלונות עבור {entity or 'היעד'} סותר את שאר האילוצים — "
                f"לא ניתן לשבץ ללא חלונות. נסו לשנות ל-SOFT."
            )

        if rt == "CLASS_DAY_LENGTH_LIMIT":
            max_p = params.get("max_periods", "?")
            day = params.get("day", "ALL")
            day_label = "כל הימים" if day == "ALL" else _day_he(day)
            return (
                f"מגבלת {max_p} שעות ב{day_label} לכיתות סותרת — "
                f"לא מספיק סלוטים לשבץ את כל השעות הנדרשות. "
                f"נסו להגדיל את המגבלה או לשנות ל-SOFT."
            )

        # Generic fallback
        return (
            f"האילוץ '{c.name}' (סוג {rt}) סותר את אילוצי המערכת. "
            f"נסו לשנות ל-SOFT או לבטל זמנית."
        )

    conflicts: list[InfeasibilityConflict] = []

    if job_id:
        _set_progress(job_id, step="diagnosing", step_number=8,
                      elapsed=0, result_message="מאבחן את סיבת הכשל...")

    # ── Phase 0: System constraints alone ──────────────────────────────
    log.info("Diagnosis: testing system constraints alone")
    m0, _ = _build_base()
    if _quick_solve(m0) == cp_model.INFEASIBLE:
        log.info("Diagnosis: system constraints INFEASIBLE — analyzing specifics")

        # Analyze specific causes of system infeasibility
        t_hours_map, t_avail_map, t_assignments = _teacher_hours_and_availability()
        c_hours_map = _class_hours()
        total_available = len(available_set)

        found_specific = False

        # Check 1: Teacher capacity (hours > available slots)
        for tid in sorted(t_hours_map, key=lambda x: t_hours_map[x] - t_avail_map.get(x, 0), reverse=True):
            hours = t_hours_map[tid]
            avail = t_avail_map.get(tid, 0)
            if hours > avail:
                tname = _tname(tid)
                blocked_count = len(data.teacher_blocked_slots.get(tid, set()))
                assignments_str = "; ".join(t_assignments.get(tid, [])[:5])
                if len(t_assignments.get(tid, [])) > 5:
                    assignments_str += f" (+{len(t_assignments[tid]) - 5} נוספים)"
                conflicts.append(InfeasibilityConflict(
                    source="system",
                    name=f"עומס יתר: {tname}",
                    details=(
                        f"למורה {tname} יש {hours} שעות נדרשות "
                        f"אבל רק {avail} סלוטים פנויים "
                        f"(מתוך {total_available} סלוטים, {blocked_count} חסומים). "
                        f"שיבוצים: {assignments_str}"
                    ),
                ))
                found_specific = True

        # Check 2: Class capacity (hours > available slots)
        for cid, hours in c_hours_map.items():
            if hours > total_available:
                conflicts.append(InfeasibilityConflict(
                    source="system",
                    name=f"עומס יתר: כיתה {_cname(cid)}",
                    details=(
                        f"לכיתה {_cname(cid)} יש {hours} שעות נדרשות "
                        f"אבל רק {total_available} סלוטים זמינים בשבוע."
                    ),
                ))
                found_specific = True

        # Check 3: Grouping clusters — overlapping teacher availability
        for cluster in data.clusters:
            primary_tracks = [t for t in cluster.tracks if not getattr(t, "is_secondary", False)]
            if len(primary_tracks) < 2:
                continue

            # All tracks must be synced — check if teachers have enough common free slots
            teacher_ids = [t.teacher_id for t in primary_tracks if t.teacher_id is not None]
            if len(teacher_ids) < 2:
                continue

            # Find overlap of available slots for all teachers in the cluster
            common_slots = set(data.available_slots)
            for tid in teacher_ids:
                blocked = data.teacher_blocked_slots.get(tid, set())
                common_slots -= blocked

            needed_hours = primary_tracks[0].hours_per_week if primary_tracks else 0
            if needed_hours > len(common_slots):
                teacher_names = ", ".join(_tname(tid) for tid in teacher_ids)
                blocked_details = []
                for tid in teacher_ids:
                    b_count = len(data.teacher_blocked_slots.get(tid, set()))
                    if b_count > 0:
                        blocked_details.append(f"{_tname(tid)}: {b_count} חסימות")
                blocked_str = "; ".join(blocked_details) if blocked_details else "ללא חסימות"
                conflicts.append(InfeasibilityConflict(
                    source="system",
                    name=f"הקבצה '{cluster.name}' — אין חפיפה מספקת",
                    details=(
                        f"אשכול '{cluster.name}' צריך {needed_hours} שעות מסונכרנות "
                        f"אבל למורים ({teacher_names}) יש רק {len(common_slots)} "
                        f"סלוטים פנויים משותפים. חסימות: {blocked_str}"
                    ),
                ))
                found_specific = True

        # Check 4: Meetings conflicting with teaching capacity
        for meeting in data.meetings:
            if not meeting.teachers:
                continue
            for t in meeting.teachers:
                tid = t.id
                blocked = data.teacher_blocked_slots.get(tid, set())
                t_avail_count = len(available_set - blocked)
                t_total = t_hours_map.get(tid, 0)
                # Meeting hours are already in t_total — check if tight
                if t_total > t_avail_count:
                    # Check if removing the meeting would fix it
                    non_meeting_hours = t_total - meeting.hours_per_week
                    if non_meeting_hours <= t_avail_count:
                        conflicts.append(InfeasibilityConflict(
                            source="system",
                            name=f"ישיבה '{meeting.name}' — עומס על {_tname(tid)}",
                            details=(
                                f"ישיבה '{meeting.name}' ({meeting.hours_per_week}ש) "
                                f"גורמת לעומס יתר על {_tname(tid)} — "
                                f"{t_total} שעות כוללות אבל רק {t_avail_count} סלוטים פנויים. "
                                f"ללא הישיבה יש {non_meeting_hours} שעות שיכולות להיכנס."
                            ),
                        ))
                        found_specific = True

        # Check 5: Meeting + grouping teacher conflicts
        # meeting_teacher_slots[teacher_id] = [(meeting_id, meeting_name, day, period), ...]
        meeting_teacher_slots: dict[int, list[tuple[int, str, str, int]]] = defaultdict(list)
        for meeting in data.meetings:
            pinned = getattr(meeting, "pinned_slots", None)
            if pinned:
                for t in meeting.teachers:
                    for slot in pinned:
                        day = slot.get("day")
                        period = slot.get("period")
                        if day and period:
                            meeting_teacher_slots[t.id].append((meeting.id, meeting.name, day, period))

        for cluster in data.clusters:
            for track in cluster.tracks:
                if track.teacher_id is None:
                    continue
                tid = track.teacher_id
                if tid not in meeting_teacher_slots:
                    continue
                track_pinned = getattr(track, "pinned_slots", None) or []
                for m_id, m_name, m_day, m_period in meeting_teacher_slots[tid]:
                    # Skip if this overlap was approved
                    pair = _normalize_pair("meeting", m_id, "track", track.id)
                    if pair in data.allowed_overlap_pairs:
                        continue
                    for tslot in track_pinned:
                        if tslot.get("day") == m_day and tslot.get("period") == m_period:
                            conflicts.append(InfeasibilityConflict(
                                source="system",
                                name=f"ישיבה '{m_name}' חופפת הקבצה '{cluster.name}'",
                                details=(
                                    f"ישיבת '{m_name}' ב{_day_he(m_day)} שעה {m_period} "
                                    f"חופפת עם הקבצה '{cluster.name}' שמחייבת "
                                    f"את {_tname(tid)} באותו זמן."
                                ),
                            ))
                            found_specific = True

        if not found_specific:
            conflicts.append(InfeasibilityConflict(
                source="system",
                name="אילוצי מערכת בסיסיים",
                details=(
                    "אילוצי המערכת הבסיסיים (חפיפת מורים, כיתות, שעות, הקבצות) "
                    "סותרים — ייתכן שהנתונים מכילים שגיאה מבנית. "
                    "בדקו שכמות השעות, חסימות מורים, והקבצות עקביים."
                ),
            ))

        return conflicts

    # ── Phase 1: User constraints — test by rule-type group ────────────
    active_constraints = (
        db.query(Constraint)
        .filter(Constraint.school_id == school_id, Constraint.is_active == True)
        .all()
    )

    by_rule: dict[str, list] = defaultdict(list)
    for c in active_constraints:
        by_rule[str(c.rule_type)].append(c)

    problematic_groups: list[str] = []
    for rule_type, group in by_rule.items():
        m, v = _build_base()
        for c in group:
            _compile_one(m, data, v, c)
        status = _quick_solve(m)
        if status == cp_model.INFEASIBLE:
            problematic_groups.append(rule_type)
            log.info(f"Diagnosis: rule_type {rule_type} ({len(group)} constraints) -> INFEASIBLE")

    # ── Phase 2: Drill into problematic groups ─────────────────────────
    for rule_type in problematic_groups:
        group = by_rule[rule_type]
        if len(group) == 1:
            c = group[0]
            conflicts.append(InfeasibilityConflict(
                source="user_constraint",
                name=c.name,
                constraint_id=c.id,
                rule_type=rule_type,
                details=_explain_constraint(c),
            ))
        else:
            # Test each constraint in the group individually
            individual_culprits: list = []
            for c in group:
                m, v = _build_base()
                _compile_one(m, data, v, c)
                status = _quick_solve(m)
                if status == cp_model.INFEASIBLE:
                    individual_culprits.append(c)
                    conflicts.append(InfeasibilityConflict(
                        source="user_constraint",
                        name=c.name,
                        constraint_id=c.id,
                        rule_type=rule_type,
                        details=_explain_constraint(c),
                    ))

            # If no individual constraint caused INFEASIBLE, it's a combination
            if not individual_culprits:
                names = ", ".join(c.name for c in group[:5])
                if len(group) > 5:
                    names += f" (+{len(group) - 5} נוספים)"
                conflicts.append(InfeasibilityConflict(
                    source="user_constraint",
                    name=f"שילוב אילוצים מסוג {rule_type}",
                    rule_type=rule_type,
                    details=f"השילוב של {len(group)} אילוצים מסוג זה יחד סותר "
                            f"את אילוצי המערכת: {names}. "
                            f"נסו לבטל חלק מהם או לשנות ל-SOFT.",
                ))

    # ── Phase 2.5: Cross rule-type combinations ────────────────────────
    # If Phase 2 found nothing, test pairs of rule-type groups that each
    # passed alone but might conflict together.
    if not conflicts and len(by_rule) >= 2:
        log.info("Diagnosis: testing cross rule-type pairs")
        # Only test pairs involving rule types that are "suspicious" —
        # time blocks, load limits, gap rules, and grouping rules are
        # most likely to interact.
        suspicious_prefixes = {
            "BLOCK_", "MAX_", "MIN_", "NO_GAPS", "REQUIRE_",
            "CLASS_DAY_", "SYNC_",
        }
        candidate_types = [
            rt for rt in by_rule
            if any(rt.startswith(p) or rt == p for p in suspicious_prefixes)
        ]
        # Also include any rule type not already found problematic
        all_rule_types = [rt for rt in by_rule if rt not in problematic_groups]

        # Prioritize suspicious types, but test all if needed
        test_types = candidate_types if candidate_types else all_rule_types
        cross_conflicts_found = False

        for rt1, rt2 in combinations(test_types, 2):
            m, v = _build_base()
            for c in by_rule[rt1]:
                _compile_one(m, data, v, c)
            for c in by_rule[rt2]:
                _compile_one(m, data, v, c)
            status = _quick_solve(m)
            if status == cp_model.INFEASIBLE:
                names1 = ", ".join(c.name for c in by_rule[rt1][:3])
                names2 = ", ".join(c.name for c in by_rule[rt2][:3])
                conflicts.append(InfeasibilityConflict(
                    source="user_constraint",
                    name=f"שילוב בין {rt1} ו-{rt2}",
                    rule_type=f"{rt1}+{rt2}",
                    details=(
                        f"שילוב אילוצים מסוג {rt1} ({names1}) "
                        f"עם אילוצים מסוג {rt2} ({names2}) "
                        f"גורם לסתירה. כל קבוצה לחוד עוברת, אבל ביחד אין פתרון. "
                        f"נסו לשנות חלק מהם ל-SOFT."
                    ),
                ))
                cross_conflicts_found = True
                log.info(f"Diagnosis: cross-type pair {rt1}+{rt2} -> INFEASIBLE")

        if not cross_conflicts_found:
            log.info("Diagnosis: no cross-type pair found infeasible")

    # ── Phase 3: Test brain rules ──────────────────────────────────────
    # Build model with system + all user constraints (to test brain on top)
    # But only if user constraints alone are feasible
    if not conflicts:
        m_base, v_base = _build_base()
        compile_all_constraints(m_base, data, v_base, db, school_id)
        base_status = _quick_solve(m_base)

        if base_status != cp_model.INFEASIBLE:
            # User constraints alone are OK, test brain functions
            brain_functions = [
                ("same_day_consecutive", "שעות רצופות באותו יום", brain_module._apply_same_day_consecutive),
                ("always_double", "שעות כפולות (חובה)", brain_module._apply_always_double),
                ("max_days_by_frontal", "ימי עבודה לפי שעות פרונטליות", None),
                ("oz_la_tmura", "כללי עוז לתמורה (חלונות)", None),
                ("max_consecutive_frontal", "מקסימום שעות פרונטליות רצופות", brain_module._apply_max_consecutive_frontal),
            ]

            for func_name, display_name, func in brain_functions:
                m, v = _build_base()
                compile_all_constraints(m, data, v, db, school_id)
                brain_module._NEXT_BRAIN_ID_HOLDER.clear()
                brain_module._NEXT_BRAIN_ID_HOLDER.append(-1)

                if func is not None:
                    func(m, data, v)
                else:
                    # Functions that need shared data
                    teacher_frontal = brain_module._compute_teacher_frontal(data)
                    gap_indicators = brain_module._build_teacher_gap_indicators(m, data, v)
                    if func_name == "oz_la_tmura":
                        brain_module._apply_oz_la_tmura(m, data, v, gap_indicators, teacher_frontal)
                    elif func_name == "max_days_by_frontal":
                        brain_module._apply_max_days_by_frontal(m, data, v, teacher_frontal)

                status = _quick_solve(m)
                if status == cp_model.INFEASIBLE:
                    # Build detailed message for brain conflicts
                    extra_detail = ""
                    if func_name == "max_days_by_frontal":
                        teacher_frontal = brain_module._compute_teacher_frontal(data)
                        for tid, frontal in sorted(teacher_frontal.items(), key=lambda x: -x[1]):
                            # Max days formula: roughly frontal/6 rounded up, capped
                            # Show teachers that are tight
                            if frontal > 0:
                                extra_detail += f"\n  - {_tname(tid)}: {frontal} שעות פרונטליות"
                        if extra_detail:
                            extra_detail = "\nמורים עם שעות פרונטליות:" + extra_detail
                    elif func_name == "oz_la_tmura":
                        extra_detail = (
                            "\nכלל זה מגביל חלונות (שעות ריקות) ליום לפי נפח שעות פרונטליות. "
                            "ייתכן שלמורים מסוימים אין מספיק גמישות ביום."
                        )
                    elif func_name == "max_consecutive_frontal":
                        extra_detail = (
                            "\nכלל זה מגביל ל-6 שעות פרונטליות רצופות. "
                            "ייתכן שאין מספיק הפסקות/ישיבות לפצל את הבלוקים."
                        )

                    conflicts.append(InfeasibilityConflict(
                        source="brain_rule",
                        name=display_name,
                        details=(
                            f"כלל המוח '{display_name}' בשילוב עם שאר האילוצים "
                            f"הופך את הבעיה לבלתי פתירה.{extra_detail}"
                        ),
                    ))

    # ── Phase 4: If still nothing found, test full combination ─────────
    if not conflicts:
        conflicts.append(InfeasibilityConflict(
            source="combination",
            name="שילוב אילוצים",
            details="לא נמצא אילוץ בודד או זוג שגורם לבעיה — השילוב של כל האילוצים "
                    "יחד הופך את הבעיה לבלתי פתירה. נסו להגדיל את זמן הפתרון, "
                    "או לבטל זמנית חלק מהאילוצים.",
        ))

    log.info(f"Diagnosis complete: {len(conflicts)} conflicts found")
    return conflicts


def _apply_warm_start(
    model: cp_model.CpModel,
    variables: SolverVariables,
    data: SolverData,
    db: Session,
    baseline_solution_id: int,
    edit_constraints: list[dict],
    deviation_weight: int,
) -> None:
    """Load baseline solution, add hints + deviation penalties + edit constraints."""
    from app.models.timetable import ScheduledLesson, ScheduledMeeting

    # --- Load baseline assignments ---
    baseline_lessons = (
        db.query(ScheduledLesson)
        .filter(ScheduledLesson.solution_id == baseline_solution_id)
        .all()
    )
    baseline_meetings = (
        db.query(ScheduledMeeting)
        .filter(ScheduledMeeting.solution_id == baseline_solution_id)
        .all()
    )

    # Build sets of active keys from baseline
    baseline_x: set[tuple[int, int, int, str, int]] = set()
    for l in baseline_lessons:
        if l.track_id is not None:
            continue  # track lessons handled via x_track
        key = (l.class_group_id, l.subject_id, l.teacher_id, l.day, l.period)
        baseline_x.add(key)

    baseline_track: set[tuple[int, str, int]] = set()
    for l in baseline_lessons:
        if l.track_id is not None:
            key = (l.track_id, l.day, l.period)
            baseline_track.add(key)

    baseline_meeting: set[tuple[int, str, int]] = set()
    for m in baseline_meetings:
        key = (m.meeting_id, m.day, m.period)
        baseline_meeting.add(key)

    # --- Compute forced-edit keys (excluded from deviation penalties) ---
    forced_keys: set[str] = set()
    for edit in edit_constraints:
        edit_type = edit.get("type", "")
        params = edit.get("params", {})

        if edit_type == "PIN_LESSON":
            # Pin specific (class, subject, teacher) to (day, period)
            key = (params["class_id"], params["subject_id"],
                   params["teacher_id"], params["day"], params["period"])
            if key in variables.x:
                model.add(variables.x[key] == 1)
                forced_keys.add(f"x_{key}")

        elif edit_type == "BLOCK_TEACHER_SLOT":
            teacher_id = params["teacher_id"]
            day = params["day"]
            period = params["period"]
            for k, var in variables.x.items():
                if k[2] == teacher_id and k[3] == day and k[4] == period:
                    model.add(var == 0)
                    forced_keys.add(f"x_{k}")
            for k, var in variables.x_track.items():
                # Need to check track teacher
                pass  # track teacher checked via data
            for k, var in variables.x_meeting.items():
                if k[1] == day and k[2] == period:
                    forced_keys.add(f"mt_{k}")

        elif edit_type == "PIN_TEACHER_DAY_CONSECUTIVE":
            teacher_id = params["teacher_id"]
            day = params["day"]
            consecutive_count = params.get("consecutive_count", 2)
            _add_teacher_day_consecutive_edit(
                model, variables, data, teacher_id, day, consecutive_count,
            )
            # Mark all teacher slots on that day as forced
            for k in variables.x:
                if k[2] == teacher_id and k[3] == day:
                    forced_keys.add(f"x_{k}")

    # --- Add hints for ALL variables (warm-start seeding) ---
    for key, var in variables.x.items():
        model.add_hint(var, 1 if key in baseline_x else 0)
    for key, var in variables.x_track.items():
        model.add_hint(var, 1 if key in baseline_track else 0)
    for key, var in variables.x_meeting.items():
        model.add_hint(var, 1 if key in baseline_meeting else 0)

    # --- Add deviation penalties (only for baseline=1 variables, skip forced) ---
    DEVIATION_CID = -999  # Special pseudo-constraint ID for deviation tracking

    for key, var in variables.x.items():
        if f"x_{key}" in forced_keys:
            continue
        if key in baseline_x:
            # Penalize removing an existing lesson
            dev = model.new_bool_var(f"dev_x_{key}")
            model.add(dev >= 1 - var)
            variables.penalties.append((dev, deviation_weight, DEVIATION_CID))

    for key, var in variables.x_track.items():
        if f"tr_{key}" in forced_keys:
            continue
        if key in baseline_track:
            dev = model.new_bool_var(f"dev_tr_{key}")
            model.add(dev >= 1 - var)
            variables.penalties.append((dev, deviation_weight, DEVIATION_CID))

    for key, var in variables.x_meeting.items():
        if f"mt_{key}" in forced_keys:
            continue
        if key in baseline_meeting:
            dev = model.new_bool_var(f"dev_mt_{key}")
            model.add(dev >= 1 - var)
            variables.penalties.append((dev, deviation_weight, DEVIATION_CID))


def _add_teacher_day_consecutive_edit(
    model: cp_model.CpModel,
    variables: SolverVariables,
    data: SolverData,
    teacher_id: int,
    day: str,
    consecutive_count: int,
) -> None:
    """Add hard constraint: teacher must have at least `consecutive_count` consecutive
    teaching hours on the given day."""
    # Collect all lesson variables for this teacher on this day, sorted by period
    period_vars: dict[int, list] = {}
    for key, var in variables.x.items():
        c, s, t, d, p = key
        if t == teacher_id and d == day:
            period_vars.setdefault(p, []).append(var)
    for key, var in variables.x_track.items():
        tk_id, d, p = key
        if d != day:
            continue
        # Check if this track belongs to the teacher
        for cluster in data.clusters:
            for track in cluster.tracks:
                if track.id == tk_id and track.teacher_id == teacher_id:
                    period_vars.setdefault(p, []).append(var)

    if not period_vars:
        return

    periods = sorted(period_vars.keys())

    # For each period, create a bool: teacher_teaches[p] = 1 iff any lesson at p
    teaches: dict[int, cp_model.IntVar] = {}
    for p in periods:
        t_var = model.new_bool_var(f"edit_teaches_t{teacher_id}_{day}_p{p}")
        model.add_max_equality(t_var, period_vars[p])
        teaches[p] = t_var

    # Require at least one block of consecutive_count consecutive teaching periods
    block_starts: list[cp_model.IntVar] = []
    for i in range(len(periods) - consecutive_count + 1):
        # Check if periods[i:i+consecutive_count] are actually consecutive integers
        is_contiguous = all(
            periods[i + j + 1] == periods[i + j] + 1
            for j in range(consecutive_count - 1)
        )
        if not is_contiguous:
            continue

        block_var = model.new_bool_var(
            f"edit_block_t{teacher_id}_{day}_start_p{periods[i]}"
        )
        # If block chosen, all periods in the block must have teaching
        for j in range(consecutive_count):
            model.add(teaches[periods[i + j]] == 1).only_enforce_if(block_var)
        block_starts.append(block_var)

    if block_starts:
        # At least one consecutive block must exist
        model.add(sum(block_starts) >= 1)


def solve(
    db: Session,
    school_id: int,
    max_time: int | None = None,
    max_solutions: int | None = None,
    num_workers: int | None = None,
    job_id: str | None = None,
    baseline_solution_id: int | None = None,
    edit_constraints: list[dict] | None = None,
    deviation_weight: int = 10,
) -> SolveResult:
    """Run the full solve pipeline.

    When baseline_solution_id is provided, the solver uses warm-start hints
    from the existing solution and adds deviation penalties to minimize changes.
    edit_constraints are temporary hard constraints applied on top (e.g. pin lesson, block slot).
    """
    start_time = time.time()
    _effective_max_time = max_time or settings.solver_max_time

    def _step(num: int, name: str) -> None:
        if job_id:
            _set_progress(job_id, step=name, step_number=num,
                          elapsed=round(time.time() - start_time, 1))

    # Step 1: Load data
    _step(1, "loading_data")
    data = load_solver_data(db, school_id)

    # Step 2: Validate
    _step(2, "validating")
    errors = validate_data(data)
    if errors:
        if job_id:
            _set_progress(job_id, done=True, result_status="INFEASIBLE",
                          result_message="שגיאות בנתונים")
        return SolveResult(
            status=SolutionStatus.INFEASIBLE,
            solutions=[],
            solve_time=time.time() - start_time,
            message="שגיאות בנתונים: " + "; ".join(errors),
        )

    # Step 3: Build model
    _step(3, "building_model")
    model = cp_model.CpModel()
    variables = create_variables(model, data)

    # Step 4: System constraints
    _step(4, "system_constraints")
    add_system_constraints(model, data, variables)

    # Step 5: User constraints
    _step(5, "user_constraints")
    compile_all_constraints(model, data, variables, db, school_id)
    apply_brain_constraints(model, data, variables)

    # Step 5.5: Warm-start from baseline + apply edit constraints
    if baseline_solution_id is not None:
        _step(5, "warm_start")
        _apply_warm_start(
            model, variables, data, db, baseline_solution_id,
            edit_constraints or [], deviation_weight,
        )

    # Step 6: Set objective
    _step(6, "setting_objective")
    if variables.penalties:
        model.minimize(
            sum(var * weight for var, weight, _cid in variables.penalties)
        )

    # Step 7: Solve
    _step(7, "solving")
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = _effective_max_time
    solver.parameters.num_workers = num_workers or settings.solver_num_workers

    _max_sol = max_solutions or settings.solver_max_solutions
    callback = MultiSolutionCallback(
        variables, data, _max_sol,
        job_id=job_id, max_time=_effective_max_time,
    )
    status = solver.solve(model, callback)

    solve_time = time.time() - start_time

    # Step 8: Map status
    _step(8, "mapping_status")
    if status == cp_model.OPTIMAL:
        sol_status = SolutionStatus.OPTIMAL
    elif status == cp_model.FEASIBLE:
        sol_status = SolutionStatus.FEASIBLE
    elif status == cp_model.INFEASIBLE:
        # Run infeasibility diagnosis
        _step(8, "diagnosing")
        if job_id:
            _set_progress(job_id, step="diagnosing", step_number=8,
                          result_message="מאבחן את סיבת הכשל...")
        diagnosis = _diagnose_infeasibility(data, db, school_id, job_id)
        diag_msg = ""
        if diagnosis:
            diag_names = [d.name for d in diagnosis]
            diag_msg = " | גורמים: " + ", ".join(diag_names)
        msg = "לא נמצא פתרון — ייתכן שהאילוצים סותרים זה את זה" + diag_msg
        if job_id:
            _set_progress(job_id, done=True, result_status="INFEASIBLE",
                          result_message=msg)
        return SolveResult(
            status=SolutionStatus.INFEASIBLE,
            solutions=[],
            solve_time=time.time() - start_time,
            message=msg,
            diagnosis=diagnosis,
        )
    else:
        if job_id:
            _set_progress(job_id, done=True, result_status="TIMEOUT",
                          result_message="החיפוש הסתיים ללא פתרון בזמן המוקצב")
        return SolveResult(
            status=SolutionStatus.TIMEOUT,
            solutions=[],
            solve_time=solve_time,
            message="החיפוש הסתיים ללא פתרון בזמן המוקצב",
        )

    # Step 9: Parse, score, and save each collected solution
    _step(9, "saving_solutions")
    saved_solutions: list[Solution] = []

    for idx, snapshot in enumerate(callback.snapshots):
        score_breakdown = compute_score_breakdown_from_snapshot(
            snapshot, variables, db, school_id
        )

        # Detect violations
        violation_list = detect_violations(snapshot, data, db, school_id)
        score_breakdown["violations"] = violation_list

        solution = Solution(
            school_id=school_id,
            solve_time_seconds=round(solve_time, 2),
            total_score=score_breakdown["total_score"],
            score_breakdown=score_breakdown,
            status=sol_status if idx == 0 else SolutionStatus.FEASIBLE,
            is_baseline=(idx == 0),
        )
        db.add(solution)
        db.flush()

        lessons, scheduled_meetings = parse_solution_from_snapshot(snapshot, data, solution.id)
        for lesson in lessons:
            db.add(lesson)
        for sm in scheduled_meetings:
            db.add(sm)

        saved_solutions.append(solution)

    db.commit()
    for sol in saved_solutions:
        db.refresh(sol)

    # NOTE: allow_overlap flags are NOT cleared automatically.
    # Pinned-slot overlaps are structural — clearing them would make the
    # system infeasible on the next run.  Users can revoke overlap approvals
    # manually through the UI if needed.

    # Sort by score descending
    saved_solutions.sort(key=lambda s: s.total_score, reverse=True)

    msg = f"נמצאו {len(saved_solutions)} פתרונות בתוך {solve_time:.1f} שניות"
    if job_id:
        _set_progress(job_id, done=True, percent=100,
                      result_status=sol_status.value, result_message=msg)

    return SolveResult(
        status=sol_status,
        solutions=saved_solutions,
        solve_time=solve_time,
        message=msg,
    )


def _clear_allow_overlaps(db: Session, school_id: int) -> None:
    """Reset all allow_overlap flags after a successful solve.

    Overlap approvals are temporary — they allow the solver to run once
    with conflicts, but must be re-approved before the next run.
    """
    db.query(SubjectRequirement).filter(
        SubjectRequirement.school_id == school_id,
        SubjectRequirement.allow_overlap == True,
    ).update({"allow_overlap": False})

    # Tracks don't have school_id directly — go through clusters
    from app.models.class_group import GroupingCluster
    cluster_ids = [
        c.id for c in db.query(GroupingCluster.id).filter(
            GroupingCluster.school_id == school_id
        ).all()
    ]
    if cluster_ids:
        db.query(Track).filter(
            Track.cluster_id.in_(cluster_ids),
            Track.allow_overlap == True,
        ).update({"allow_overlap": False}, synchronize_session="fetch")

    db.query(Meeting).filter(
        Meeting.school_id == school_id,
        Meeting.allow_overlap == True,
    ).update({"allow_overlap": False})

    db.commit()
