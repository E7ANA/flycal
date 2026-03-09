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
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_hours[t.id] = (
                teacher_hours.get(t.id, 0) + meeting.hours_per_week
            )
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

    # Collect pinned meetings
    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        if not pinned:
            continue
        for slot in pinned:
            day = slot.get("day")
            period = slot.get("period")
            if day and period:
                for t in meeting.teachers:
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

    Strategy:
    1. Verify system constraints alone are feasible.
    2. Add user constraints by rule-type group — find which groups break it.
    3. Drill into problematic groups to find specific constraints.
    4. Test brain rules on top.
    Returns a list of conflicting constraints/rules.
    """
    import logging
    from collections import defaultdict
    from app.models.constraint import Constraint
    from app.solver.constraint_compiler import _compile_one, compile_all_constraints
    from app.solver import brain as brain_module

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

    conflicts: list[InfeasibilityConflict] = []

    if job_id:
        _set_progress(job_id, step="diagnosing", step_number=8,
                      elapsed=0, result_message="מאבחן את סיבת הכשל...")

    # ── Phase 0: System constraints alone ──────────────────────────────
    log.info("Diagnosis: testing system constraints alone")
    m0, _ = _build_base()
    if _quick_solve(m0) == cp_model.INFEASIBLE:
        conflicts.append(InfeasibilityConflict(
            source="system",
            name="אילוצי מערכת בסיסיים",
            details="אילוצי המערכת הבסיסיים (חפיפת מורים, כיתות, שעות) סותרים — "
                    "ייתכן שהנתונים מכילים שגיאה מבנית",
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
                details=f"האילוץ '{c.name}' סותר את אילוצי המערכת הבסיסיים. "
                        f"נסו לשנות אותו ל-SOFT או לבטלו זמנית.",
            ))
        else:
            # Test each constraint in the group individually
            for c in group:
                m, v = _build_base()
                _compile_one(m, data, v, c)
                status = _quick_solve(m)
                if status == cp_model.INFEASIBLE:
                    conflicts.append(InfeasibilityConflict(
                        source="user_constraint",
                        name=c.name,
                        constraint_id=c.id,
                        rule_type=rule_type,
                        details=f"האילוץ '{c.name}' סותר את אילוצי המערכת לבד. "
                                f"נסו לשנות אותו ל-SOFT או לבטלו זמנית.",
                    ))

            # If no individual constraint caused INFEASIBLE, it's a combination
            if not any(c.rule_type == rule_type for c in conflicts
                       if hasattr(c, 'rule_type')):
                names = ", ".join(c.name for c in group[:5])
                if len(group) > 5:
                    names += f" (+{len(group) - 5} נוספים)"
                conflicts.append(InfeasibilityConflict(
                    source="user_constraint",
                    name=f"שילוב אילוצים מסוג {rule_type}",
                    rule_type=rule_type,
                    details=f"השילוב של {len(group)} אילוצים מסוג זה יחד סותר "
                            f"את אילוצי המערכת: {names}",
                ))

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
                    conflicts.append(InfeasibilityConflict(
                        source="brain_rule",
                        name=display_name,
                        details=f"כלל המוח '{display_name}' בשילוב עם שאר האילוצים "
                                f"הופך את הבעיה לבלתי פתירה.",
                    ))

    # ── Phase 4: If still nothing found, test full combination ─────────
    if not conflicts:
        conflicts.append(InfeasibilityConflict(
            source="combination",
            name="שילוב אילוצים",
            details="לא נמצא אילוץ בודד שגורם לבעיה — השילוב של כל האילוצים "
                    "יחד הופך את הבעיה לבלתי פתירה. נסו להגדיל את זמן הפתרון, "
                    "או לבטל זמנית חלק מהאילוצים.",
        ))

    log.info(f"Diagnosis complete: {len(conflicts)} conflicts found")
    return conflicts


def solve(
    db: Session,
    school_id: int,
    max_time: int | None = None,
    max_solutions: int | None = None,
    num_workers: int | None = None,
    job_id: str | None = None,
) -> SolveResult:
    """Run the full solve pipeline."""
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
