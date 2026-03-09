"""Scores and ranks solutions based on constraint satisfaction."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.models.constraint import Constraint, ConstraintType
from app.solver.model_builder import SolverVariables

if TYPE_CHECKING:
    from app.solver.engine import SolutionSnapshot


def compute_score_breakdown_from_snapshot(
    snapshot: SolutionSnapshot,
    variables: SolverVariables,
    db: Session,
    school_id: int,
) -> dict:
    """Compute a detailed score breakdown from a solution snapshot."""
    constraints = (
        db.query(Constraint)
        .filter(Constraint.school_id == school_id, Constraint.is_active == True)
        .all()
    )

    hard_count = sum(1 for c in constraints if c.type == ConstraintType.HARD)

    # Group penalties by constraint_id from snapshot
    penalties_by_constraint: dict[int, list[tuple[int, int]]] = defaultdict(list)
    max_by_constraint: dict[int, int] = defaultdict(int)
    total_penalty = 0
    max_possible_penalty = 0

    for idx, (penalty_var, weight, cid) in enumerate(variables.penalties):
        # Get value from snapshot
        val = snapshot.penalty_values[idx][0]
        total_penalty += val * weight
        penalties_by_constraint[cid].append((val, weight))

        # Use pre-computed upper bound from snapshot
        ub = snapshot.penalty_upper_bounds[idx] if idx < len(snapshot.penalty_upper_bounds) else 1
        max_possible_penalty += ub * weight
        max_by_constraint[cid] += ub * weight

    # Score: 100 = perfect (no penalties), 0 = worst
    if max_possible_penalty > 0:
        total_score = max(0.0, 100.0 * (1.0 - total_penalty / max_possible_penalty))
    else:
        total_score = 100.0

    # Per-constraint soft scores — with per-label (per-grade/class) breakdown
    # Group penalties by (constraint_id, label) for granular breakdown
    penalties_by_constraint_label: dict[tuple[int, str], list[tuple[int, int]]] = defaultdict(list)
    max_by_constraint_label: dict[tuple[int, str], int] = defaultdict(int)

    for idx, (penalty_var, weight, cid) in enumerate(variables.penalties):
        label = variables.penalty_labels.get(idx)
        if label:
            val = snapshot.penalty_values[idx][0]
            penalties_by_constraint_label[(cid, label)].append((val, weight))
            ub = snapshot.penalty_upper_bounds[idx] if idx < len(snapshot.penalty_upper_bounds) else 1
            max_by_constraint_label[(cid, label)] += ub * weight

    soft_scores: list[dict] = []
    for c in constraints:
        if c.type != ConstraintType.SOFT:
            continue
        c_entries = penalties_by_constraint.get(c.id, [])
        c_penalty = sum(val * w for val, w in c_entries)
        c_max = max_by_constraint.get(c.id, 0)

        satisfaction = 1.0 - (c_penalty / c_max) if c_max > 0 else 1.0

        # Per-label breakdown (per grade/class)
        label_breakdown = []
        for (cid, label), entries in penalties_by_constraint_label.items():
            if cid != c.id:
                continue
            lp = sum(val * w for val, w in entries)
            lm = max_by_constraint_label.get((cid, label), 0)
            ls = 1.0 - (lp / lm) if lm > 0 else 1.0
            label_breakdown.append({
                "label": label,
                "satisfaction": round(ls, 3),
                "penalty": lp,
                "max_penalty": lm,
            })

        entry = {
            "constraint_id": c.id,
            "name": c.name,
            "weight": c.weight,
            "satisfaction": round(satisfaction, 3),
            "weighted_score": round(satisfaction * c.weight, 1),
        }
        if label_breakdown:
            entry["breakdown"] = sorted(label_breakdown, key=lambda x: x["satisfaction"])
        soft_scores.append(entry)

    # Brain constraint scores (negative IDs)
    brain_scores: list[dict] = []
    for brain_id, info in variables.brain_info.items():
        is_hard = info.get("is_hard", False)
        weight = info.get("weight", 0)

        if is_hard:
            # HARD brain constraints (e.g. Oz LaTmura) — no penalty scoring
            entry = {
                "constraint_id": brain_id,
                "name": info["name"],
                "weight": 0,
                "satisfaction": 1.0,
                "weighted_score": 0,
                "is_brain": True,
                "is_hard": True,
            }
            if "breakdown" in info:
                entry["breakdown"] = info["breakdown"]
            brain_scores.append(entry)
        else:
            b_entries = penalties_by_constraint.get(brain_id, [])
            b_penalty = sum(val * w for val, w in b_entries)
            b_max = max_by_constraint.get(brain_id, 0)
            satisfaction = 1.0 - (b_penalty / b_max) if b_max > 0 else 1.0
            brain_scores.append({
                "constraint_id": brain_id,
                "name": info["name"],
                "weight": weight,
                "satisfaction": round(satisfaction, 3),
                "weighted_score": round(satisfaction * weight, 1),
                "is_brain": True,
            })

    return {
        "satisfied_hard": hard_count,
        "total_hard": hard_count,
        "soft_scores": soft_scores,
        "brain_scores": brain_scores,
        "total_soft_penalty": total_penalty,
        "max_possible_penalty": max_possible_penalty,
        "total_score": round(total_score, 1),
    }
