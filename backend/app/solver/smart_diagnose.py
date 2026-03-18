"""Smart diagnosis script — finds minimal relaxations to make an infeasible problem solvable.

Run from the backend directory:
    .venv/bin/python -m app.solver.smart_diagnose

Algorithm:
  1. Load solver data for school_id=3
  2. Build full model (system + all user constraints including GRADE_ACTIVITY_HOURS)
  3. Quick-solve (60s). If feasible, exit.
  4. If INFEASIBLE, try many small relaxations independently and rank by "drama score".
"""

import copy
import logging
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from types import SimpleNamespace

from ortools.sat.python import cp_model

# Suppress SQLAlchemy noise
logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

SCHOOL_ID = 3
QUICK_TIMEOUT = 30  # seconds per relaxation attempt
FULL_TIMEOUT = 60   # seconds for the initial full solve
NUM_WORKERS = 8

_DAY_HEBREW = {
    "SUNDAY": "יום ראשון",
    "MONDAY": "יום שני",
    "TUESDAY": "יום שלישי",
    "WEDNESDAY": "יום רביעי",
    "THURSDAY": "יום חמישי",
    "FRIDAY": "יום שישי",
}

_DAY_SHORT = {
    "SUNDAY": "א'",
    "MONDAY": "ב'",
    "TUESDAY": "ג'",
    "WEDNESDAY": "ד'",
    "THURSDAY": "ה'",
    "FRIDAY": "ו'",
}


def _day_he(day: str) -> str:
    return _DAY_HEBREW.get(day, day)


def _day_short(day: str) -> str:
    return _DAY_SHORT.get(day, day)


# ── Result container ────────────────────────────────────────────────────

@dataclass
class RelaxationResult:
    """A single relaxation attempt that succeeded."""
    strategy: str           # strategy name (a-g)
    description_he: str     # Hebrew description of the change
    drama_score: int        # 1-10, lower = less dramatic
    solve_status: str       # OPTIMAL / FEASIBLE
    solve_time: float       # seconds


# ── Helper: build model ────────────────────────────────────────────────

def _build_full_model(data, grade_activity_constraints, all_user_constraints):
    """Build model with system constraints + GRADE_ACTIVITY_HOURS + brain + all user constraints."""
    from app.solver.model_builder import create_variables, add_system_constraints
    from app.solver.constraint_compiler import _compile_one
    from app.solver.brain import apply_brain_constraints

    m = cp_model.CpModel()
    v = create_variables(m, data)
    add_system_constraints(m, data, v)
    for c in grade_activity_constraints:
        _compile_one(m, data, v, c)
    for c in all_user_constraints:
        _compile_one(m, data, v, c)
    apply_brain_constraints(m, data, v)
    return m, v


def _build_base_model(data, grade_activity_constraints):
    """Build model with system constraints + GRADE_ACTIVITY_HOURS + brain only."""
    from app.solver.model_builder import create_variables, add_system_constraints
    from app.solver.constraint_compiler import _compile_one
    from app.solver.brain import apply_brain_constraints

    m = cp_model.CpModel()
    v = create_variables(m, data)
    add_system_constraints(m, data, v)
    for c in grade_activity_constraints:
        _compile_one(m, data, v, c)
    apply_brain_constraints(m, data, v)
    return m, v


def _quick_solve(model, timeout=QUICK_TIMEOUT):
    """Solve quickly and return (status_int, status_name, elapsed)."""
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = timeout
    solver.parameters.num_workers = NUM_WORKERS
    t0 = time.time()
    status = solver.solve(model)
    elapsed = time.time() - t0
    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }.get(status, f"STATUS_{status}")
    return status, status_name, elapsed


def _is_feasible(status):
    return status in (cp_model.OPTIMAL, cp_model.FEASIBLE)


# ── Name maps ───────────────────────────────────────────────────────────

def _build_name_maps(data):
    teacher_map = {}
    for req in data.requirements:
        if req.teacher_id and req.teacher:
            teacher_map[req.teacher_id] = req.teacher.name
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id and track.teacher:
                teacher_map[track.teacher_id] = track.teacher.name
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_map[t.id] = t.name

    class_map = {cg.id: cg.name for cg in data.class_groups}

    grade_map = {}
    for cg in data.class_groups:
        if hasattr(cg, 'grade') and cg.grade:
            grade_map[cg.grade_id] = cg.grade.name
        elif cg.grade_id not in grade_map:
            grade_map[cg.grade_id] = f"שכבה #{cg.grade_id}"

    subject_map = {s.id: s.name for s in data.all_subjects}

    return teacher_map, class_map, grade_map, subject_map


# ── Clone constraint as soft ────────────────────────────────────────────

def _clone_as_soft(c, weight=50):
    """Clone a constraint but change type to SOFT with given weight."""
    return SimpleNamespace(
        id=c.id,
        school_id=c.school_id,
        name=c.name,
        category=c.category,
        type="SOFT",
        weight=weight,
        rule_type=c.rule_type,
        parameters=c.parameters,
        target_type=c.target_type,
        target_id=c.target_id,
        is_active=True,
    )


def _clone_constraint_with_params(c, new_params):
    """Clone a constraint with modified parameters."""
    return SimpleNamespace(
        id=c.id,
        school_id=c.school_id,
        name=c.name,
        category=c.category,
        type=c.type,
        weight=c.weight,
        rule_type=c.rule_type,
        parameters=new_params,
        target_type=c.target_type,
        target_id=c.target_id,
        is_active=True,
    )


# ── Teacher hours computation ───────────────────────────────────────────

def _compute_teacher_hours(data):
    """Return {teacher_id: total_hours}."""
    t_hours = defaultdict(int)
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        t_hours[req.teacher_id] += req.hours_per_week
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                t_hours[track.teacher_id] += track.hours_per_week
    for meeting in data.meetings:
        for t in meeting.teachers:
            t_hours[t.id] += meeting.hours_per_week
    return dict(t_hours)


def _compute_class_hours(data):
    """Return {class_group_id: total_hours}."""
    c_hours = defaultdict(int)
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        c_hours[req.class_group_id] += req.hours_per_week
    for cluster in data.clusters:
        if cluster.tracks:
            track_hours = max(t.hours_per_week for t in cluster.tracks)
            for sc in cluster.source_classes:
                c_hours[sc.id] += track_hours
    return dict(c_hours)


# ── Main diagnosis ──────────────────────────────────────────────────────

def run():
    from app.database import SessionLocal
    from app.solver.model_builder import load_solver_data, create_variables, add_system_constraints
    from app.solver.constraint_compiler import _compile_one, compile_all_constraints
    from app.models.constraint import Constraint
    from app.solver.brain import apply_brain_constraints

    db = SessionLocal()
    start_time = time.time()

    try:
        _run_diagnosis(db, start_time)
    finally:
        db.close()


def _run_diagnosis(db, start_time):
    from app.solver.model_builder import load_solver_data, create_variables, add_system_constraints
    from app.solver.constraint_compiler import _compile_one
    from app.models.constraint import Constraint

    print("=" * 70)
    print("  אבחון חכם — חיפוש הרפיות מינימליות לפתרון")
    print(f"  בית ספר: {SCHOOL_ID}")
    print("=" * 70)
    print()

    # ── Step 1: Load data ────────────────────────────────────────────
    print("שלב 1: טעינת נתונים...")
    data = load_solver_data(db, SCHOOL_ID)
    teacher_map, class_map, grade_map, subject_map = _build_name_maps(data)
    print(f"  כיתות: {len(data.class_groups)}, דרישות: {len(data.requirements)}, "
          f"אשכולות: {len(data.clusters)}, ישיבות: {len(data.meetings)}")
    print(f"  סלוטים זמינים: {len(data.available_slots)}, ימים: {data.days}")
    print()

    def tname(tid):
        return teacher_map.get(tid, f"מורה #{tid}")

    def cname(cid):
        return class_map.get(cid, f"כיתה #{cid}")

    def gname(gid):
        return grade_map.get(gid, f"שכבה #{gid}")

    def sname(sid):
        return subject_map.get(sid, f"מקצוע #{sid}")

    # ── Step 2: Load constraints ─────────────────────────────────────
    print("שלב 2: טעינת אילוצים...")

    grade_activity_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == SCHOOL_ID,
            Constraint.rule_type == "GRADE_ACTIVITY_HOURS",
            Constraint.is_active == True,
        )
        .all()
    )

    all_user_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == SCHOOL_ID,
            Constraint.is_active == True,
        )
        .all()
    )
    # Exclude GRADE_ACTIVITY_HOURS from user constraints (they're in the base)
    gah_ids = {c.id for c in grade_activity_constraints}
    user_constraints = [c for c in all_user_constraints if c.id not in gah_ids]

    hard_constraints = [c for c in user_constraints if c.type == "HARD"]
    soft_constraints = [c for c in user_constraints if c.type == "SOFT"]

    print(f"  GRADE_ACTIVITY_HOURS: {len(grade_activity_constraints)}")
    print(f"  אילוצי משתמש: {len(user_constraints)} (HARD: {len(hard_constraints)}, SOFT: {len(soft_constraints)})")
    print()

    # ── Step 3: Full solve ───────────────────────────────────────────
    print("שלב 3: ניסיון פתרון מלא (60 שניות)...")
    m_full, v_full = _build_full_model(data, grade_activity_constraints, user_constraints)
    status, status_name, elapsed = _quick_solve(m_full, timeout=FULL_TIMEOUT)
    print(f"  תוצאה: {status_name} ({elapsed:.1f}s)")

    if _is_feasible(status):
        print()
        print("=" * 70)
        print("  נמצא פתרון! אין צורך בהרפיות.")
        print("=" * 70)
        return

    if status != cp_model.INFEASIBLE:
        print(f"  סטטוס: {status_name} — ייתכן שצריך יותר זמן. ממשיך לאבחון...")

    print()
    print("=" * 70)
    print("  הבעיה בלתי פתירה. מתחיל חיפוש הרפיות...")
    print("=" * 70)
    print()

    results: list[RelaxationResult] = []
    attempt_count = 0

    def try_relaxation(strategy, desc_he, drama, build_fn):
        """Try a single relaxation. build_fn() should return (model, variables) or None to skip."""
        nonlocal attempt_count
        attempt_count += 1
        result = build_fn()
        if result is None:
            return False
        m, v = result
        st, st_name, el = _quick_solve(m)
        if _is_feasible(st):
            results.append(RelaxationResult(
                strategy=strategy,
                description_he=desc_he,
                drama_score=drama,
                solve_status=st_name,
                solve_time=el,
            ))
            print(f"    ✓ פתיר! ({st_name}, {el:.1f}s) — דרמה: {drama}/10")
            return True
        return False

    # ── Strategy A: Remove one HARD constraint at a time ─────────────
    print("אסטרטגיה א': הסרת אילוץ HARD אחד בכל פעם")
    print(f"  {len(hard_constraints)} אילוצים לבדוק...")

    for i, c in enumerate(hard_constraints):
        desc = f"הסרת האילוץ '{c.name}' (#{c.id}, {c.rule_type})"
        print(f"  [{i+1}/{len(hard_constraints)}] בודק: {c.name}...", end=" ", flush=True)

        remaining = [uc for uc in user_constraints if uc.id != c.id]

        def build_without(remaining=remaining):
            return _build_full_model(data, grade_activity_constraints, remaining)

        found = try_relaxation("A", desc, drama=5, build_fn=build_without)
        if not found:
            print("    ✗ עדיין לא פתיר")

    print()

    # ── Strategy B: Add one extra period to one day for one grade ─────
    print("אסטרטגיה ב': הוספת שעה אחת ליום אחד בשכבה")
    b_attempts = []
    for gah in grade_activity_constraints:
        grade_id = gah.target_id
        params = gah.parameters or {}
        pmap = params.get("periods_per_day_map", {})
        for day, periods in pmap.items():
            b_attempts.append((gah, grade_id, day, periods))

    print(f"  {len(b_attempts)} שילובים לבדוק...")

    for i, (gah, grade_id, day, periods) in enumerate(b_attempts):
        new_periods = periods + 1
        desc = f"הוספת שעה ב{_day_short(day)} ל{gname(grade_id)}: {periods}→{new_periods}"
        print(f"  [{i+1}/{len(b_attempts)}] בודק: {desc}...", end=" ", flush=True)

        new_pmap = dict((gah.parameters or {}).get("periods_per_day_map", {}))
        new_pmap[day] = new_periods
        new_params = dict(gah.parameters or {})
        new_params["periods_per_day_map"] = new_pmap

        modified_gah = _clone_constraint_with_params(gah, new_params)
        other_gahs = [g for g in grade_activity_constraints if g.id != gah.id]

        def build_extra_period(modified_gah=modified_gah, other_gahs=other_gahs):
            return _build_full_model(data, [modified_gah] + other_gahs, user_constraints)

        found = try_relaxation("B", desc, drama=3, build_fn=build_extra_period)
        if not found:
            print("    ✗")

    print()

    # ── Strategy C: Unblock specific teacher — full day ──────────────
    print("אסטרטגיה ג': ביטול חסימת יום שלם למורה")
    t_hours = _compute_teacher_hours(data)
    c_hours = _compute_class_hours(data)
    available_set = set(data.available_slots)

    c_attempts = []
    for tid, blocked_slots in data.teacher_blocked_slots.items():
        if not blocked_slots:
            continue
        # Group blocked slots by day
        blocked_by_day = defaultdict(set)
        for day, period in blocked_slots:
            blocked_by_day[day].add(period)
        for day, periods in blocked_by_day.items():
            c_attempts.append((tid, day, periods))

    # Prioritize teachers with most hours relative to available slots
    def _teacher_pressure(item):
        tid = item[0]
        hours = t_hours.get(tid, 0)
        avail = len(available_set - data.teacher_blocked_slots.get(tid, set()))
        return hours - avail  # higher = more pressure

    c_attempts.sort(key=_teacher_pressure, reverse=True)
    print(f"  {len(c_attempts)} שילובים לבדוק...")

    for i, (tid, day, periods) in enumerate(c_attempts):
        desc = f"ביטול חסימת {tname(tid)} ב{_day_short(day)} ({len(periods)} שעות)"
        print(f"  [{i+1}/{len(c_attempts)}] בודק: {desc}...", end=" ", flush=True)

        # Create modified data with this teacher's day unblocked
        import copy as _copy
        new_blocked = dict(data.teacher_blocked_slots)
        if tid in new_blocked:
            new_blocked[tid] = new_blocked[tid] - {(day, p) for p in periods}
            if not new_blocked[tid]:
                del new_blocked[tid]

        def build_unblock(new_blocked=new_blocked):
            # We need to rebuild data with modified blocked slots
            # Use a shallow copy approach
            orig_blocked = data.teacher_blocked_slots
            data.teacher_blocked_slots = new_blocked
            try:
                return _build_full_model(data, grade_activity_constraints, user_constraints)
            finally:
                data.teacher_blocked_slots = orig_blocked

        found = try_relaxation("C", desc, drama=4, build_fn=build_unblock)
        if not found:
            print("    ✗")

        # Time check
        if time.time() - start_time > 480:  # 8 minutes
            print("  (חריגה מזמן, עובר לאסטרטגיה הבאה)")
            break

    print()

    # ── Strategy D: Reduce one requirement by 1 hour ─────────────────
    print("אסטרטגיה ד': הפחתת שעה אחת מדרישה")
    d_attempts = []
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        if req.hours_per_week > 1:
            d_attempts.append(req)

    print(f"  {len(d_attempts)} דרישות לבדוק...")

    for i, req in enumerate(d_attempts):
        subj = sname(req.subject_id)
        cls = cname(req.class_group_id)
        desc = f"הפחתת שעה ב{subj} ל{cls}: {req.hours_per_week}→{req.hours_per_week - 1}"
        print(f"  [{i+1}/{len(d_attempts)}] בודק: {desc}...", end=" ", flush=True)

        orig_hours = req.hours_per_week

        def build_reduce(req=req, orig_hours=orig_hours):
            req.hours_per_week = orig_hours - 1
            try:
                return _build_full_model(data, grade_activity_constraints, user_constraints)
            finally:
                req.hours_per_week = orig_hours

        found = try_relaxation("D", desc, drama=6, build_fn=build_reduce)
        if not found:
            print("    ✗")

        if time.time() - start_time > 480:
            print("  (חריגה מזמן, עובר לאסטרטגיה הבאה)")
            break

    print()

    # ── Strategy E: Change one HARD to SOFT ──────────────────────────
    print("אסטרטגיה ה': שינוי אילוץ HARD ל-SOFT (משקל 50)")
    print(f"  {len(hard_constraints)} אילוצים לבדוק...")

    for i, c in enumerate(hard_constraints):
        desc = f"שינוי '{c.name}' (#{c.id}) מ-HARD ל-SOFT"
        print(f"  [{i+1}/{len(hard_constraints)}] בודק: {c.name}...", end=" ", flush=True)

        softened = _clone_as_soft(c, weight=50)
        modified = [softened if uc.id == c.id else uc for uc in user_constraints]

        def build_softened(modified=modified):
            return _build_full_model(data, grade_activity_constraints, modified)

        found = try_relaxation("E", desc, drama=3, build_fn=build_softened)
        if not found:
            print("    ✗")

        if time.time() - start_time > 480:
            print("  (חריגה מזמן, עובר לאסטרטגיה הבאה)")
            break

    print()

    # ── Strategy F: Unblock co-teachers on cluster-forced days ────────
    print("אסטרטגיה ו': ביטול חסימת מורים בימי אשכול מאולצים")

    f_attempts = []
    for cluster in data.clusters:
        # Check if cluster has pinned slots that force specific days
        pinned_days = set()
        for track in cluster.tracks:
            pinned = getattr(track, "pinned_slots", None)
            if pinned:
                for slot in pinned:
                    day = slot.get("day")
                    if day:
                        pinned_days.add(day)

        if not pinned_days:
            continue

        # Find all teachers in this cluster
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            tid = track.teacher_id
            blocked = data.teacher_blocked_slots.get(tid, set())
            for day in pinned_days:
                blocked_on_day = {(d, p) for d, p in blocked if d == day}
                if blocked_on_day:
                    f_attempts.append((cluster, tid, day, blocked_on_day))

    print(f"  {len(f_attempts)} שילובים לבדוק...")

    for i, (cluster, tid, day, blocked_on_day) in enumerate(f_attempts):
        desc = (f"ביטול חסימת {tname(tid)} ב{_day_short(day)} "
                f"(נדרש לאשכול '{cluster.name}')")
        print(f"  [{i+1}/{len(f_attempts)}] בודק: {desc}...", end=" ", flush=True)

        new_blocked = dict(data.teacher_blocked_slots)
        if tid in new_blocked:
            new_blocked[tid] = new_blocked[tid] - blocked_on_day
            if not new_blocked[tid]:
                del new_blocked[tid]

        def build_unblock_f(new_blocked=new_blocked):
            orig_blocked = data.teacher_blocked_slots
            data.teacher_blocked_slots = new_blocked
            try:
                return _build_full_model(data, grade_activity_constraints, user_constraints)
            finally:
                data.teacher_blocked_slots = orig_blocked

        found = try_relaxation("F", desc, drama=4, build_fn=build_unblock_f)
        if not found:
            print("    ✗")

    print()

    # ── Strategy G: Combinations of 2 small changes ──────────────────
    print("אסטרטגיה ז': שילובים של 2 שינויים קטנים")

    # Pick the most promising single relaxations (even if they didn't solve alone,
    # pick the ones with lowest drama). If we already have results, combine those.
    # Otherwise, combine the top strategies from A+E (remove/soften constraints).

    if not results:
        # No single fix found — try pairs
        # Combine: soften pairs of HARD constraints
        candidates = hard_constraints[:15]  # limit to avoid explosion
        pairs = list(combinations(candidates, 2))
        print(f"  בודק {len(pairs)} זוגות של שינויי HARD→SOFT...")

        for i, (c1, c2) in enumerate(pairs):
            desc = f"שינוי '{c1.name}' + '{c2.name}' ל-SOFT"
            print(f"  [{i+1}/{len(pairs)}] בודק...", end=" ", flush=True)

            s1 = _clone_as_soft(c1, weight=50)
            s2 = _clone_as_soft(c2, weight=50)
            modified = []
            for uc in user_constraints:
                if uc.id == c1.id:
                    modified.append(s1)
                elif uc.id == c2.id:
                    modified.append(s2)
                else:
                    modified.append(uc)

            def build_pair(modified=modified):
                return _build_full_model(data, grade_activity_constraints, modified)

            found = try_relaxation("G", desc, drama=5, build_fn=build_pair)
            if not found:
                print("    ✗")

            if time.time() - start_time > 540:  # 9 minutes
                print("  (חריגה מזמן)")
                break
    else:
        # We have single results — try combining pairs of different strategies
        # e.g., soften one constraint + add one period
        single_descs = [(r.strategy, r.description_he) for r in results[:5]]
        print(f"  נמצאו {len(results)} הרפיות בודדות, מנסה שילובים...")

        # Try combining: soften a constraint + add a period to a grade
        combo_attempted = 0
        for c in hard_constraints[:10]:
            for gah in grade_activity_constraints:
                params = gah.parameters or {}
                pmap = params.get("periods_per_day_map", {})
                for day, periods in pmap.items():
                    new_pmap = dict(pmap)
                    new_pmap[day] = periods + 1
                    new_params = dict(params)
                    new_params["periods_per_day_map"] = new_pmap

                    modified_gah = _clone_constraint_with_params(gah, new_params)
                    other_gahs = [g for g in grade_activity_constraints if g.id != gah.id]
                    softened = _clone_as_soft(c, weight=50)
                    modified_uc = [softened if uc.id == c.id else uc for uc in user_constraints]

                    desc = (f"שינוי '{c.name}' ל-SOFT + "
                            f"הוספת שעה ב{_day_short(day)} ל{gname(gah.target_id)}")

                    print(f"  [{combo_attempted+1}] בודק...", end=" ", flush=True)

                    def build_combo(modified_gah=modified_gah, other_gahs=other_gahs,
                                    modified_uc=modified_uc):
                        return _build_full_model(data, [modified_gah] + other_gahs, modified_uc)

                    found = try_relaxation("G", desc, drama=5, build_fn=build_combo)
                    if not found:
                        print("    ✗")

                    combo_attempted += 1
                    if combo_attempted >= 30 or time.time() - start_time > 540:
                        break
                if combo_attempted >= 30 or time.time() - start_time > 540:
                    break
            if combo_attempted >= 30 or time.time() - start_time > 540:
                break

    print()

    # ── Final report ─────────────────────────────────────────────────
    elapsed_total = time.time() - start_time

    print("=" * 70)
    print(f"  סיכום — {elapsed_total:.0f} שניות, {attempt_count} ניסיונות")
    print("=" * 70)
    print()

    if not results:
        print("  לא נמצאו הרפיות שמאפשרות פתרון בזמן הנתון.")
        print("  ייתכן שצריך שילוב של 3+ שינויים, או שהבעיה עמוקה יותר.")
        print("  המלצות:")
        print("    - הגדילו את טיימאוט הסולבר")
        print("    - בדקו עומס מורים מול סלוטים פנויים")
        print("    - בדקו שעות כיתות מול שעות פעילות שכבה")
        return

    # Sort by drama score (ascending), then by solve time
    results.sort(key=lambda r: (r.drama_score, r.solve_time))

    # Show top 5
    top = results[:5]
    print(f"  נמצאו {len(results)} הרפיות שעובדות. להלן 5 המובילות:")
    print()

    for i, r in enumerate(top, 1):
        print(f"  ── פתרון #{i} ──")
        print(f"  אסטרטגיה: {r.strategy}")
        print(f"  שינוי: {r.description_he}")
        print(f"  דרמטיות: {'●' * r.drama_score}{'○' * (10 - r.drama_score)} ({r.drama_score}/10)")
        print(f"  סטטוס: {r.solve_status} ({r.solve_time:.1f}s)")
        print()

    # Summary of all results by strategy
    by_strategy = defaultdict(list)
    for r in results:
        by_strategy[r.strategy].append(r)

    print("  ── סיכום לפי אסטרטגיה ──")
    strategy_names = {
        "A": "הסרת אילוץ HARD",
        "B": "הוספת שעה לשכבה",
        "C": "ביטול חסימת מורה (יום)",
        "D": "הפחתת שעה מדרישה",
        "E": "HARD → SOFT",
        "F": "ביטול חסימה ביום אשכול",
        "G": "שילוב 2 שינויים",
    }
    for strategy in "ABCDEFG":
        if strategy in by_strategy:
            count = len(by_strategy[strategy])
            best = min(by_strategy[strategy], key=lambda r: r.drama_score)
            print(f"  {strategy_names.get(strategy, strategy)}: "
                  f"{count} פתרונות, הטוב ביותר: דרמה {best.drama_score}/10")

    print()
    print("=" * 70)


# ── Entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    run()
