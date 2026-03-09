"""What-if scenario engine — allows comparing solver results under different conditions."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.constraint import Constraint, ConstraintType
from app.models.timetable import ScheduledLesson, Solution
from app.solver.engine import solve


def run_scenario_toggle_constraint(
    db: Session,
    school_id: int,
    constraint_id: int,
    new_active: bool,
    scenario_name: str,
    max_time: int | None = None,
) -> dict:
    """Toggle a constraint and re-solve, then restore the original state."""
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        return {"error": "אילוץ לא נמצא"}

    original_active = constraint.is_active
    try:
        constraint.is_active = new_active
        db.flush()

        result = solve(db, school_id, max_time=max_time, max_solutions=1)

        # Tag solutions with scenario name
        for sol in result.solutions:
            sol.scenario_name = scenario_name
            sol.is_baseline = False

        db.commit()

        return {
            "status": result.status.value,
            "message": result.message,
            "solve_time": round(result.solve_time, 2),
            "solutions": [{"id": s.id, "total_score": s.total_score} for s in result.solutions],
            "change": f"אילוץ '{constraint.name}' {'הופעל' if new_active else 'הושבת'}",
        }
    finally:
        constraint.is_active = original_active
        db.commit()


def run_scenario_change_weight(
    db: Session,
    school_id: int,
    constraint_id: int,
    new_weight: int,
    scenario_name: str,
    max_time: int | None = None,
) -> dict:
    """Change a soft constraint weight and re-solve, then restore."""
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        return {"error": "אילוץ לא נמצא"}
    if constraint.type != ConstraintType.SOFT:
        return {"error": "ניתן לשנות משקל רק לאילוצים רכים"}

    original_weight = constraint.weight
    try:
        constraint.weight = new_weight
        db.flush()

        result = solve(db, school_id, max_time=max_time, max_solutions=1)

        for sol in result.solutions:
            sol.scenario_name = scenario_name
            sol.is_baseline = False

        db.commit()

        return {
            "status": result.status.value,
            "message": result.message,
            "solve_time": round(result.solve_time, 2),
            "solutions": [{"id": s.id, "total_score": s.total_score} for s in result.solutions],
            "change": f"משקל '{constraint.name}' שונה מ-{original_weight} ל-{new_weight}",
        }
    finally:
        constraint.weight = original_weight
        db.commit()


def run_scenario_change_type(
    db: Session,
    school_id: int,
    constraint_id: int,
    new_type: str,
    scenario_name: str,
    max_time: int | None = None,
) -> dict:
    """Switch constraint between HARD and SOFT, re-solve, then restore."""
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        return {"error": "אילוץ לא נמצא"}

    original_type = constraint.type
    try:
        constraint.type = ConstraintType(new_type)
        db.flush()

        result = solve(db, school_id, max_time=max_time, max_solutions=1)

        for sol in result.solutions:
            sol.scenario_name = scenario_name
            sol.is_baseline = False

        db.commit()

        return {
            "status": result.status.value,
            "message": result.message,
            "solve_time": round(result.solve_time, 2),
            "solutions": [{"id": s.id, "total_score": s.total_score} for s in result.solutions],
            "change": f"סוג '{constraint.name}' שונה מ-{original_type} ל-{new_type}",
        }
    finally:
        constraint.type = ConstraintType(original_type)
        db.commit()


def compare_solutions(
    db: Session,
    solution_id_a: int,
    solution_id_b: int,
) -> dict:
    """Compare two solutions side by side."""
    sol_a = db.get(Solution, solution_id_a)
    sol_b = db.get(Solution, solution_id_b)

    if not sol_a or not sol_b:
        return {"error": "פתרון לא נמצא"}

    lessons_a = (
        db.query(ScheduledLesson)
        .filter(ScheduledLesson.solution_id == solution_id_a)
        .all()
    )
    lessons_b = (
        db.query(ScheduledLesson)
        .filter(ScheduledLesson.solution_id == solution_id_b)
        .all()
    )

    # Build slot sets for comparison
    def lesson_key(l: ScheduledLesson) -> str:
        return f"{l.class_group_id or l.track_id}-{l.subject_id}-{l.teacher_id}-{l.day}-{l.period}"

    set_a = {lesson_key(l) for l in lessons_a}
    set_b = {lesson_key(l) for l in lessons_b}

    common = set_a & set_b
    only_a = set_a - set_b
    only_b = set_b - set_a

    # Score comparison
    breakdown_a = sol_a.score_breakdown or {}
    breakdown_b = sol_b.score_breakdown or {}

    soft_a = {s["constraint_id"]: s for s in breakdown_a.get("soft_scores", [])}
    soft_b = {s["constraint_id"]: s for s in breakdown_b.get("soft_scores", [])}

    all_cids = set(soft_a.keys()) | set(soft_b.keys())
    constraint_diffs = []
    for cid in sorted(all_cids):
        sa = soft_a.get(cid, {})
        sb = soft_b.get(cid, {})
        sat_a = sa.get("satisfaction", 0)
        sat_b = sb.get("satisfaction", 0)
        if sat_a != sat_b:
            constraint_diffs.append({
                "constraint_id": cid,
                "name": sa.get("name") or sb.get("name", ""),
                "satisfaction_a": sat_a,
                "satisfaction_b": sat_b,
                "delta": round(sat_b - sat_a, 3),
            })

    return {
        "solution_a": {
            "id": sol_a.id,
            "total_score": sol_a.total_score,
            "status": sol_a.status,
            "scenario_name": sol_a.scenario_name,
        },
        "solution_b": {
            "id": sol_b.id,
            "total_score": sol_b.total_score,
            "status": sol_b.status,
            "scenario_name": sol_b.scenario_name,
        },
        "score_delta": round(sol_b.total_score - sol_a.total_score, 1),
        "common_lessons": len(common),
        "only_in_a": len(only_a),
        "only_in_b": len(only_b),
        "similarity_pct": round(len(common) / max(len(set_a | set_b), 1) * 100, 1),
        "constraint_diffs": constraint_diffs,
    }
