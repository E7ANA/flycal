"""Translates database Constraint records into OR-Tools CP-SAT constraints.

For HARD constraints: adds model.add(...) directly.
For SOFT constraints: creates penalty variables and appends to objective terms.
"""

from types import SimpleNamespace

from ortools.sat.python import cp_model
from sqlalchemy.orm import Session

from app.models.constraint import Constraint, ConstraintType, RuleType
from app.solver.model_builder import SolverData, SolverVariables

# Cache for cluster consecutive counts (populated lazily in compile_all_constraints)
_cluster_consecutive_counts: dict[int, int] = {}


def _get_cluster_consecutive_count(data: SolverData, cluster_id: int) -> int | None:
    """Get the REQUIRE_CONSECUTIVE_PERIODS count for a cluster, if any."""
    return _cluster_consecutive_counts.get(cluster_id)


def _max_pinned_per_day_for_cluster(cluster) -> int:
    """Return the max number of pinned slots on any single day for this cluster."""
    from collections import Counter
    day_counts: Counter[str] = Counter()
    for track in cluster.tracks:
        pinned = getattr(track, "pinned_slots", None)
        if not pinned:
            continue
        for slot in pinned:
            day = slot.get("day")
            if day:
                day_counts[day] += 1
        break  # Tracks are synced — pinned slots are the same; count once
    return max(day_counts.values()) if day_counts else 0


def compile_all_constraints(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    db: Session,
    school_id: int,
) -> None:
    """Load active user constraints from DB and compile them into the model."""
    constraints = (
        db.query(Constraint)
        .filter(Constraint.school_id == school_id, Constraint.is_active == True)
        .all()
    )

    # Build cluster consecutive counts cache for MAX_PER_DAY interaction.
    # Query ALL REQUIRE_CONSECUTIVE_PERIODS constraints (active or not) because
    # the consecutive count is a structural property of the cluster — MAX_PER_DAY
    # must respect it even if the REQUIRE_CONSECUTIVE_PERIODS constraint is inactive.
    _cluster_consecutive_counts.clear()
    all_consec = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == school_id,
            Constraint.rule_type == "REQUIRE_CONSECUTIVE_PERIODS",
            Constraint.target_id.isnot(None),
        )
        .all()
    )
    for c in all_consec:
        count = (c.parameters or {}).get("consecutive_count")
        if count:
            _cluster_consecutive_counts[c.target_id] = count

    # Split into specific (target_id set) and global defaults (target_id is None)
    specific = [c for c in constraints if c.target_id is not None]
    global_defaults = [
        c for c in constraints
        if c.target_id is None and c.category in ("SUBJECT", "TEACHER", "CLASS")
    ]
    # Constraints with category GLOBAL or GROUPING are compiled as-is
    other = [
        c for c in constraints
        if c.target_id is None and c.category not in ("SUBJECT", "TEACHER", "CLASS")
    ]

    # Compile specific constraints normally
    for constraint in specific:
        _compile_one(model, data, variables, constraint)

    # Compile GLOBAL/GROUPING constraints as-is
    for constraint in other:
        _compile_one(model, data, variables, constraint)

    # Expand global defaults to all matching entities, skipping overrides
    _expand_global_defaults(model, data, variables, specific, global_defaults)


def _compile_one(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    constraint,
) -> None:
    """Dispatch to the correct compiler function based on rule_type."""
    compiler = _COMPILERS.get(RuleType(constraint.rule_type))
    if compiler is None:
        return  # Unknown rule_type — skip silently
    compiler(model, data, variables, constraint)


def _clone_constraint_with_target(constraint: Constraint, target_id: int):
    """Create a lightweight copy of a constraint with a specific target_id."""
    return SimpleNamespace(
        id=constraint.id,
        school_id=constraint.school_id,
        name=constraint.name,
        category=constraint.category,
        type=constraint.type,
        weight=constraint.weight,
        rule_type=constraint.rule_type,
        parameters=constraint.parameters,
        target_type=constraint.target_type,
        target_id=target_id,
        is_active=True,
    )


def _expand_global_defaults(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    specific: list[Constraint],
    global_defaults: list[Constraint],
) -> None:
    """Expand global defaults to all matching entities, skipping overrides."""
    if not global_defaults:
        return

    # Build override lookup: {(category, rule_type, target_id)}
    overrides = {(c.category, c.rule_type, c.target_id) for c in specific}

    for gc in global_defaults:
        if gc.category == "SUBJECT":
            subject_ids = {r.subject_id for r in data.requirements if not r.is_grouped}
            # Also include subjects that only exist in clusters
            for cluster in data.clusters:
                if cluster.subject_id:
                    subject_ids.add(cluster.subject_id)
            for sid in subject_ids:
                if (gc.category, gc.rule_type, sid) in overrides:
                    continue  # Specific override exists
                virtual = _clone_constraint_with_target(gc, sid)
                _compile_one(model, data, variables, virtual)

        elif gc.category == "TEACHER":
            teacher_ids = {
                r.teacher_id for r in data.requirements
                if r.teacher_id and not r.is_grouped
            }
            # Also include teachers from grouping tracks
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id:
                        teacher_ids.add(track.teacher_id)
            for tid in teacher_ids:
                if (gc.category, gc.rule_type, tid) in overrides:
                    continue
                virtual = _clone_constraint_with_target(gc, tid)
                _compile_one(model, data, variables, virtual)

        elif gc.category == "CLASS":
            class_ids = {cg.id for cg in data.class_groups}
            for cid in class_ids:
                if (gc.category, gc.rule_type, cid) in overrides:
                    continue
                virtual = _clone_constraint_with_target(gc, cid)
                _compile_one(model, data, variables, virtual)



# ---------------------------------------------------------------------------
# Helper: get variables matching a constraint's target
# ---------------------------------------------------------------------------

def _vars_for_teacher(
    variables: SolverVariables, data: SolverData, teacher_id: int
) -> dict[tuple[str, int], list[cp_model.IntVar]]:
    """Return {(day, period): [vars]} for a specific teacher.

    Includes regular lesson vars and track vars (NOT meetings —
    use _vars_for_teacher_with_meetings for constraints that need presence).
    """
    result: dict[tuple[str, int], list[cp_model.IntVar]] = {}
    for key, var in variables.x.items():
        c_id, s_id, t_id, d, p = key
        if t_id == teacher_id:
            result.setdefault((d, p), []).append(var)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id == teacher_id:
                for tk, var in variables.x_track.items():
                    tr_id, d, p = tk
                    if tr_id == track.id:
                        result.setdefault((d, p), []).append(var)
    return result


def _vars_for_teacher_with_meetings(
    variables: SolverVariables, data: SolverData, teacher_id: int
) -> dict[tuple[str, int], list[cp_model.IntVar]]:
    """Like _vars_for_teacher but also includes meeting vars."""
    result = _vars_for_teacher(variables, data, teacher_id)
    for meeting in data.meetings:
        if any(t.id == teacher_id for t in meeting.teachers):
            for mk, var in variables.x_meeting.items():
                m_id, d, p = mk
                if m_id == meeting.id:
                    result.setdefault((d, p), []).append(var)
    return result


def _vars_for_teacher_by_day(
    variables: SolverVariables, data: SolverData, teacher_id: int,
    include_meetings: bool = False,
) -> dict[str, list[cp_model.IntVar]]:
    """Return {day: [all vars on that day]} for a teacher."""
    result: dict[str, list[cp_model.IntVar]] = {}
    if include_meetings:
        slot_vars = _vars_for_teacher_with_meetings(variables, data, teacher_id)
    else:
        slot_vars = _vars_for_teacher(variables, data, teacher_id)
    for (day, period), vlist in slot_vars.items():
        result.setdefault(day, []).extend(vlist)
    return result


def _vars_for_subject_class(
    variables: SolverVariables, data: SolverData,
    subject_id: int, class_group_id: int | None = None,
) -> dict[tuple[str, int], list[cp_model.IntVar]]:
    """Return {(day, period): [vars]} for a subject (optionally filtered by class)."""
    result: dict[tuple[str, int], list[cp_model.IntVar]] = {}
    for key, var in variables.x.items():
        c_id, s_id, t_id, d, p = key
        if s_id == subject_id and (class_group_id is None or c_id == class_group_id):
            result.setdefault((d, p), []).append(var)
    return result


def _vars_for_class(
    variables: SolverVariables, data: SolverData, class_group_id: int
) -> dict[tuple[str, int], list[cp_model.IntVar]]:
    """Return {(day, period): [vars]} for a class group.

    Includes both regular lesson vars and ALL track vars from clusters
    where this class is a source (not just one representative).
    A period is "occupied" if any var in the list is 1.
    """
    result: dict[tuple[str, int], list[cp_model.IntVar]] = {}
    for key, var in variables.x.items():
        c_id, s_id, t_id, d, p = key
        if c_id == class_group_id:
            result.setdefault((d, p), []).append(var)

    # Add track vars for clusters involving this class.
    # Only include tracks that SERVE this class:
    #   - source_class_id is None → shared track, serves all source classes
    #   - source_class_id == class_group_id → track tied to this class
    #   - source_class_id == other → skip (track serves a different class)
    # This matches the logic in model_builder._add_class_no_overlap.
    added_tracks: set[int] = set()
    for cluster in data.clusters:
        source_ids = {sc.id for sc in cluster.source_classes}
        if class_group_id not in source_ids:
            continue
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            if (track.source_class_id is not None
                    and track.source_class_id != class_group_id):
                continue  # Track serves a different class
            if track.id in added_tracks:
                continue
            added_tracks.add(track.id)
            for tk, var in variables.x_track.items():
                tr_id, d, p = tk
                if tr_id == track.id:
                    result.setdefault((d, p), []).append(var)
    return result


def _class_label(data: SolverData, class_group_id: int) -> str:
    """Get class group name for penalty labels."""
    for cg in data.class_groups:
        if cg.id == class_group_id:
            return cg.name
    return str(class_group_id)


def _add_soft_penalty(
    model: cp_model.CpModel,
    variables: SolverVariables,
    constraint: Constraint,
    violation_var: cp_model.IntVar,
    label: str | None = None,
) -> None:
    """Add a weighted penalty variable for soft constraint violations."""
    idx = len(variables.penalties)
    variables.penalties.append((violation_var, constraint.weight, constraint.id))
    if label:
        variables.penalty_labels[idx] = label


# ---------------------------------------------------------------------------
# TIME RULES
# ---------------------------------------------------------------------------

def _compile_block_timeslot(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    day = constraint.parameters.get("day")
    period = constraint.parameters.get("period")
    if day is None or period is None:
        return

    target_id = constraint.target_id
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category == "TEACHER" and target_id:
        slot_vars = _vars_for_teacher(variables, data, target_id)
        blocked = slot_vars.get((day, period), [])
    elif constraint.category == "CLASS" and target_id:
        slot_vars = _vars_for_class(variables, data, target_id)
        blocked = slot_vars.get((day, period), [])
    else:
        return

    if not blocked:
        return

    if is_hard:
        for var in blocked:
            model.add(var == 0)
    else:
        penalty = model.new_bool_var(f"penalty_block_ts_{constraint.id}")
        model.add(sum(blocked) == 0).only_enforce_if(penalty.negated())
        model.add(sum(blocked) >= 1).only_enforce_if(penalty)
        _add_soft_penalty(model, variables, constraint, penalty)


def _compile_block_day(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    day = constraint.parameters.get("day")
    if day is None:
        return

    target_id = constraint.target_id
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category == "TEACHER" and target_id:
        by_day = _vars_for_teacher_by_day(variables, data, target_id)
        day_vars = by_day.get(day, [])
    elif constraint.category == "CLASS" and target_id:
        slot_vars = _vars_for_class(variables, data, target_id)
        day_vars = [v for (d, p), vlist in slot_vars.items() for v in vlist if d == day]
    else:
        return

    if not day_vars:
        return

    if is_hard:
        for var in day_vars:
            model.add(var == 0)
    else:
        # Penalty = 1 if any lesson on this day
        penalty = model.new_bool_var(f"penalty_block_day_{constraint.id}_{day}")
        model.add(sum(day_vars) == 0).only_enforce_if(penalty.negated())
        model.add(sum(day_vars) >= 1).only_enforce_if(penalty)
        _add_soft_penalty(model, variables, constraint, penalty)


def _compile_block_time_range(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    from_p = constraint.parameters.get("from_period")
    to_p = constraint.parameters.get("to_period")
    day_filter = constraint.parameters.get("day", "ALL")
    if from_p is None or to_p is None:
        return

    target_id = constraint.target_id
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category == "TEACHER" and target_id:
        slot_vars = _vars_for_teacher(variables, data, target_id)
    elif constraint.category == "CLASS" and target_id:
        slot_vars = _vars_for_class(variables, data, target_id)
    else:
        return

    blocked: list[cp_model.IntVar] = []
    for (d, p), vlist in slot_vars.items():
        if (day_filter == "ALL" or d == day_filter) and from_p <= p <= to_p:
            blocked.extend(vlist)

    if not blocked:
        return

    if is_hard:
        for var in blocked:
            model.add(var == 0)
    else:
        penalty = model.new_bool_var(f"penalty_block_range_{constraint.id}")
        model.add(sum(blocked) == 0).only_enforce_if(penalty.negated())
        model.add(sum(blocked) >= 1).only_enforce_if(penalty)
        _add_soft_penalty(model, variables, constraint, penalty)


def _compile_prefer_time_range(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: prefer lessons in a time range. Penalize lessons outside it."""
    from_p = constraint.parameters.get("from_period")
    to_p = constraint.parameters.get("to_period")
    day_filter = constraint.parameters.get("day", "ALL")
    if from_p is None or to_p is None:
        return

    target_id = constraint.target_id

    if constraint.category == "SUBJECT" and target_id:
        # For each class that has this subject
        for req in data.requirements:
            if req.subject_id == target_id and not req.is_grouped and req.teacher_id:
                slot_vars = _vars_for_subject_class(
                    variables, data, target_id, req.class_group_id
                )
                outside: list[cp_model.IntVar] = []
                for (d, p), vlist in slot_vars.items():
                    if day_filter != "ALL" and d != day_filter:
                        continue
                    if not (from_p <= p <= to_p):
                        outside.extend(vlist)
                if outside:
                    count_outside = model.new_int_var(
                        0, len(outside),
                        f"prefer_range_{constraint.id}_c{req.class_group_id}"
                    )
                    model.add(count_outside == sum(outside))
                    _add_soft_penalty(model, variables, constraint, count_outside,
                                      label=_class_label(data, req.class_group_id))

    elif constraint.category == "TEACHER" and target_id:
        slot_vars = _vars_for_teacher(variables, data, target_id)
        outside: list[cp_model.IntVar] = []
        for (d, p), vlist in slot_vars.items():
            if day_filter != "ALL" and d != day_filter:
                continue
            if not (from_p <= p <= to_p):
                outside.extend(vlist)
        if outside:
            count_outside = model.new_int_var(
                0, len(outside), f"prefer_range_{constraint.id}"
            )
            model.add(count_outside == sum(outside))
            _add_soft_penalty(model, variables, constraint, count_outside)


def _compile_avoid_last_period(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: penalize lessons in the last period of each day."""
    target_id = constraint.target_id

    if constraint.category == "SUBJECT" and target_id:
        for req in data.requirements:
            if req.subject_id == target_id and not req.is_grouped and req.teacher_id:
                slot_vars = _vars_for_subject_class(
                    variables, data, target_id, req.class_group_id
                )
                last_period_vars: list[cp_model.IntVar] = []
                for (d, p), vlist in slot_vars.items():
                    if p == data.max_period_per_day.get(d, 0):
                        last_period_vars.extend(vlist)
                if last_period_vars:
                    cnt = model.new_int_var(
                        0, len(last_period_vars),
                        f"avoid_last_{constraint.id}_c{req.class_group_id}"
                    )
                    model.add(cnt == sum(last_period_vars))
                    _add_soft_penalty(model, variables, constraint, cnt,
                                      label=_class_label(data, req.class_group_id))

    elif constraint.category == "TEACHER" and target_id:
        slot_vars = _vars_for_teacher(variables, data, target_id)
        last_period_vars: list[cp_model.IntVar] = []
        for (d, p), vlist in slot_vars.items():
            if p == data.max_period_per_day.get(d, 0):
                last_period_vars.extend(vlist)
        if last_period_vars:
            cnt = model.new_int_var(
                0, len(last_period_vars), f"avoid_last_{constraint.id}"
            )
            model.add(cnt == sum(last_period_vars))
            _add_soft_penalty(model, variables, constraint, cnt)


# ---------------------------------------------------------------------------
# DISTRIBUTION RULES
# ---------------------------------------------------------------------------

def _compile_max_per_day(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    max_val = constraint.parameters.get("max")
    if max_val is None:
        return

    target_id = constraint.target_id
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category == "SUBJECT" and target_id:
        # Regular (non-grouped) requirements
        for req in data.requirements:
            if req.subject_id == target_id and not req.is_grouped and req.teacher_id:
                slot_vars = _vars_for_subject_class(
                    variables, data, target_id, req.class_group_id
                )
                for day in data.days:
                    day_vars = [
                        v for (d, p), vlist in slot_vars.items()
                        for v in vlist if d == day
                    ]
                    if not day_vars:
                        continue
                    if is_hard:
                        model.add(sum(day_vars) <= max_val)
                    else:
                        excess = model.new_int_var(
                            0, len(day_vars),
                            f"max_per_day_{constraint.id}_c{req.class_group_id}_{day}"
                        )
                        model.add(sum(day_vars) - max_val <= excess)
                        model.add(excess >= 0)
                        _add_soft_penalty(model, variables, constraint, excess,
                                          label=_class_label(data, req.class_group_id))

        # Grouped subjects — constrain via cluster track variables
        for cluster in data.clusters:
            if cluster.subject_id != target_id:
                continue
            # Use the track with max hours as reference (matches SYNC logic)
            tracks_with_teacher = [
                t for t in cluster.tracks if t.teacher_id is not None
            ]
            if not tracks_with_teacher:
                continue
            ref_track = max(tracks_with_teacher, key=lambda t: t.hours_per_week)

            # Effective max: raise to accommodate constraints that force
            # multiple hours on the same day (consecutive blocks, pinned slots)
            effective_max = max_val
            cluster_consec = _get_cluster_consecutive_count(data, cluster.id)
            if cluster_consec and cluster_consec > effective_max:
                effective_max = cluster_consec
            # Also respect pinned slots: if pinned slots put N hours on one day,
            # the effective max must be at least N
            pinned_per_day = _max_pinned_per_day_for_cluster(cluster)
            if pinned_per_day > effective_max:
                effective_max = pinned_per_day

            for day in data.days:
                day_vars = [
                    variables.x_track[tk]
                    for tk in variables.x_track
                    if tk[0] == ref_track.id and tk[1] == day
                ]
                if not day_vars:
                    continue
                if is_hard:
                    model.add(sum(day_vars) <= effective_max)
                else:
                    excess = model.new_int_var(
                        0, len(day_vars),
                        f"max_per_day_{constraint.id}_cl{cluster.id}_{day}"
                    )
                    model.add(sum(day_vars) - effective_max <= excess)
                    model.add(excess >= 0)
                    _add_soft_penalty(model, variables, constraint, excess,
                                      label=cluster.name)

    elif constraint.category == "TEACHER" and target_id:
        by_day = _vars_for_teacher_by_day(variables, data, target_id)
        for day, day_vars in by_day.items():
            if is_hard:
                model.add(sum(day_vars) <= max_val)
            else:
                excess = model.new_int_var(
                    0, len(day_vars),
                    f"max_per_day_{constraint.id}_{day}"
                )
                model.add(sum(day_vars) - max_val <= excess)
                model.add(excess >= 0)
                _add_soft_penalty(model, variables, constraint, excess)


def _compile_min_days_spread(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    min_days = constraint.parameters.get("min_days")
    if min_days is None:
        return
    target_id = constraint.target_id
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category != "SUBJECT" or not target_id:
        return

    for req in data.requirements:
        if req.subject_id != target_id or req.is_grouped or not req.teacher_id:
            continue
        slot_vars = _vars_for_subject_class(variables, data, target_id, req.class_group_id)
        day_has_lesson: list[cp_model.IntVar] = []
        for day in data.days:
            day_vars = [v for (d, p), vlist in slot_vars.items() for v in vlist if d == day]
            if day_vars:
                b = model.new_bool_var(
                    f"spread_{constraint.id}_c{req.class_group_id}_{day}"
                )
                model.add(sum(day_vars) >= 1).only_enforce_if(b)
                model.add(sum(day_vars) == 0).only_enforce_if(b.negated())
                day_has_lesson.append(b)

        if day_has_lesson:
            if is_hard:
                model.add(sum(day_has_lesson) >= min_days)
            else:
                deficit = model.new_int_var(
                    0, min_days,
                    f"spread_deficit_{constraint.id}_c{req.class_group_id}"
                )
                model.add(min_days - sum(day_has_lesson) <= deficit)
                model.add(deficit >= 0)
                _add_soft_penalty(model, variables, constraint, deficit,
                                  label=_class_label(data, req.class_group_id))


def _compile_require_consecutive_periods(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """Require that lessons of this subject appear in blocks of `consecutive_count`.

    Approach: for each day, create a bool for each valid block-start position.
    A lesson at period p must belong to exactly one block. The number of lessons
    on that day must be a multiple of consecutive_count.
    """
    count = constraint.parameters.get("consecutive_count", 2)
    target_id = constraint.target_id
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category == "GROUPING":
        _compile_require_consecutive_periods_grouping(
            model, data, variables, constraint, count, is_hard
        )
        return

    if constraint.category != "SUBJECT" or not target_id:
        return

    for req in data.requirements:
        if req.subject_id != target_id or req.is_grouped or not req.teacher_id:
            continue
        slot_vars = _vars_for_subject_class(variables, data, target_id, req.class_group_id)

        _apply_consecutive_periods_to_day_vars(
            model, data, variables, constraint, slot_vars, count, is_hard,
            f"c{req.class_group_id}"
        )


def _apply_consecutive_periods_to_day_vars(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint,
    slot_vars: dict[tuple[str, int], list[cp_model.IntVar]],
    count: int, is_hard: bool, label: str,
) -> None:
    """Shared logic for requiring consecutive blocks on a set of (day,period)->vars."""
    for day in data.days:
        day_period_vars: dict[int, list[cp_model.IntVar]] = {}
        for (d, p), vlist in slot_vars.items():
            if d == day:
                day_period_vars[p] = vlist

        if not day_period_vars:
            continue

        periods = sorted(day_period_vars.keys())
        all_day_vars = [v for p in periods for v in day_period_vars[p]]
        if not all_day_vars:
            continue

        block_starts: list[int] = []
        for p in periods:
            if all(p + offset in day_period_vars for offset in range(count)):
                block_starts.append(p)

        if is_hard:
            start_bools: dict[int, cp_model.IntVar] = {}
            for p in block_starts:
                start_bools[p] = model.new_bool_var(
                    f"consec_start_{constraint.id}_{label}_{day}_p{p}"
                )

            for p in periods:
                covering_starts = [
                    s for s in block_starts if s <= p < s + count
                ]
                if not covering_starts:
                    for v in day_period_vars[p]:
                        model.add(v == 0)
                else:
                    for v in day_period_vars[p]:
                        model.add(
                            sum(start_bools[s] for s in covering_starts) >= v
                        )

            for p in block_starts:
                for offset in range(count):
                    for v in day_period_vars[p + offset]:
                        model.add(v >= start_bools[p])

            if all_day_vars:
                total_blocks = model.new_int_var(
                    0, len(block_starts),
                    f"consec_nblocks_{constraint.id}_{label}_{day}"
                )
                model.add(total_blocks == sum(start_bools[p] for p in block_starts))
                model.add(sum(all_day_vars) == count * total_blocks)
        else:
            remainder = model.new_int_var(
                0, count - 1,
                f"consec_rem_{constraint.id}_{label}_{day}"
            )
            model.add_modulo_equality(remainder, sum(all_day_vars), count)
            _add_soft_penalty(model, variables, constraint, remainder,
                              label=label)


def _compile_require_consecutive_periods_grouping(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint,
    count: int, is_hard: bool,
) -> None:
    """Apply REQUIRE_CONSECUTIVE_PERIODS to grouping cluster tracks."""
    cluster_id = constraint.target_id
    if cluster_id is None:
        cluster_id = constraint.parameters.get("cluster_id")
    if cluster_id is None:
        return

    for cluster in data.clusters:
        if cluster.id != cluster_id:
            continue
        # Use the track with max hours as reference (matches SYNC logic).
        # Since all tracks are synced, constraining the envelope track
        # constrains all.
        tracks_with_teacher = [
            t for t in cluster.tracks if t.teacher_id is not None
        ]
        if not tracks_with_teacher:
            return
        ref_track = max(tracks_with_teacher, key=lambda t: t.hours_per_week)

        slot_vars: dict[tuple[str, int], list[cp_model.IntVar]] = {}
        for tk, var in variables.x_track.items():
            tr_id, d, p = tk
            if tr_id == ref_track.id:
                slot_vars.setdefault((d, p), []).append(var)

        _apply_consecutive_periods_to_day_vars(
            model, data, variables, constraint, slot_vars, count, is_hard,
            f"cl{cluster.id}"
        )
        return


def _compile_no_consecutive_days(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: penalize subject appearing on consecutive days."""
    target_id = constraint.target_id
    if constraint.category != "SUBJECT" or not target_id:
        return

    day_order = [d for d in [
        "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"
    ] if d in data.days]

    for req in data.requirements:
        if req.subject_id != target_id or req.is_grouped or not req.teacher_id:
            continue
        slot_vars = _vars_for_subject_class(variables, data, target_id, req.class_group_id)

        for i in range(len(day_order) - 1):
            d1, d2 = day_order[i], day_order[i + 1]
            vars_d1 = [v for (d, p), vlist in slot_vars.items() for v in vlist if d == d1]
            vars_d2 = [v for (d, p), vlist in slot_vars.items() for v in vlist if d == d2]
            if not vars_d1 or not vars_d2:
                continue

            b1 = model.new_bool_var(f"consday_{constraint.id}_c{req.class_group_id}_{d1}")
            b2 = model.new_bool_var(f"consday_{constraint.id}_c{req.class_group_id}_{d2}")
            model.add(sum(vars_d1) >= 1).only_enforce_if(b1)
            model.add(sum(vars_d1) == 0).only_enforce_if(b1.negated())
            model.add(sum(vars_d2) >= 1).only_enforce_if(b2)
            model.add(sum(vars_d2) == 0).only_enforce_if(b2.negated())

            penalty = model.new_bool_var(
                f"penalty_consday_{constraint.id}_c{req.class_group_id}_{d1}_{d2}"
            )
            # penalty=1 if both days have lessons
            model.add_bool_and([b1, b2]).only_enforce_if(penalty)
            model.add_bool_or([b1.negated(), b2.negated()]).only_enforce_if(penalty.negated())
            _add_soft_penalty(model, variables, constraint, penalty,
                              label=_class_label(data, req.class_group_id))


# ---------------------------------------------------------------------------
# LOAD RULES
# ---------------------------------------------------------------------------

def _compile_max_teaching_hours_per_day(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    _compile_max_per_day(model, data, variables, Constraint(
        id=constraint.id, school_id=constraint.school_id,
        name=constraint.name, category="TEACHER",
        type=constraint.type, weight=constraint.weight,
        rule_type=constraint.rule_type, parameters=constraint.parameters,
        target_type=constraint.target_type, target_id=constraint.target_id,
        is_active=True,
    ))


def _compile_max_teaching_days(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    max_days = constraint.parameters.get("max_days")
    if max_days is None:
        return
    target_id = constraint.target_id
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category != "TEACHER" or not target_id:
        return

    by_day = _vars_for_teacher_by_day(variables, data, target_id)
    day_active: list[cp_model.IntVar] = []
    for day, day_vars in by_day.items():
        b = model.new_bool_var(f"teach_day_{constraint.id}_{day}")
        model.add(sum(day_vars) >= 1).only_enforce_if(b)
        model.add(sum(day_vars) == 0).only_enforce_if(b.negated())
        day_active.append(b)

    if day_active:
        if is_hard:
            model.add(sum(day_active) <= max_days)
        else:
            excess = model.new_int_var(
                0, len(day_active), f"teach_days_excess_{constraint.id}"
            )
            model.add(sum(day_active) - max_days <= excess)
            model.add(excess >= 0)
            _add_soft_penalty(model, variables, constraint, excess)


def _compile_min_free_days(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    min_days = constraint.parameters.get("min_days")
    if min_days is None:
        return
    # Equivalent to max_teaching_days = total_days - min_free_days
    total_days = len(data.days)
    max_teaching = total_days - min_days
    if max_teaching < 0:
        max_teaching = 0

    # Reuse max_teaching_days logic
    modified = Constraint(
        id=constraint.id, school_id=constraint.school_id,
        name=constraint.name, category=constraint.category,
        type=constraint.type, weight=constraint.weight,
        rule_type=RuleType.MAX_TEACHING_DAYS,
        parameters={"max_days": max_teaching},
        target_type=constraint.target_type, target_id=constraint.target_id,
        is_active=True,
    )
    _compile_max_teaching_days(model, data, variables, modified)


def _compile_balanced_daily_load(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: penalize if daily load difference exceeds max_difference."""
    max_diff = constraint.parameters.get("max_difference", 2)
    target_id = constraint.target_id
    if constraint.category != "TEACHER" or not target_id:
        return

    by_day = _vars_for_teacher_by_day(variables, data, target_id)
    if len(by_day) < 2:
        return

    day_counts: list[cp_model.IntVar] = []
    for day, day_vars in by_day.items():
        cnt = model.new_int_var(0, len(day_vars), f"load_{constraint.id}_{day}")
        model.add(cnt == sum(day_vars))
        day_counts.append(cnt)

    # Penalize each pair where difference > max_diff
    for i in range(len(day_counts)):
        for j in range(i + 1, len(day_counts)):
            diff = model.new_int_var(
                0, 20, f"load_diff_{constraint.id}_{i}_{j}"
            )
            # diff >= |count_i - count_j| - max_diff
            model.add(diff >= day_counts[i] - day_counts[j] - max_diff)
            model.add(diff >= day_counts[j] - day_counts[i] - max_diff)
            model.add(diff >= 0)
            _add_soft_penalty(model, variables, constraint, diff)


# ---------------------------------------------------------------------------
# GAP RULES
# ---------------------------------------------------------------------------

def _compile_no_gaps(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: penalize gaps (free periods between first and last lesson)."""
    target_id = constraint.target_id

    def _add_gap_penalties_for_slots(
        slot_vars: dict[tuple[str, int], list[cp_model.IntVar]],
        prefix: str,
    ) -> None:
        for day in data.days:
            periods = sorted(
                [p for (d, p) in slot_vars if d == day]
            )
            if len(periods) < 2:
                continue

            period_bools: dict[int, cp_model.IntVar] = {}
            for p in periods:
                vlist = slot_vars.get((day, p), [])
                if vlist:
                    b = model.new_bool_var(f"occ_{prefix}_{day}_p{p}")
                    model.add(sum(vlist) >= 1).only_enforce_if(b)
                    model.add(sum(vlist) == 0).only_enforce_if(b.negated())
                    period_bools[p] = b

            # A gap at period p: period p is free, but there are lessons
            # both before and after p.
            for idx in range(1, len(periods) - 1):
                p = periods[idx]
                if p not in period_bools:
                    continue
                # gap_p = NOT occupied AND some earlier occupied AND some later occupied
                # Simplification: penalize each unoccupied period between first and last
                gap_var = model.new_bool_var(f"gap_{prefix}_{day}_p{p}")
                # gap if not occupied at p but occupied at some earlier and some later
                model.add_bool_or(
                    [period_bools[periods[i]] for i in range(idx)]
                ).only_enforce_if(gap_var)
                model.add_bool_or(
                    [period_bools[periods[i]] for i in range(idx + 1, len(periods))]
                ).only_enforce_if(gap_var)
                model.add(period_bools[p] == 0).only_enforce_if(gap_var)
                _add_soft_penalty(model, variables, constraint, gap_var,
                                  label=prefix)

    if constraint.category == "CLASS" and target_id:
        slot_vars = _vars_for_class(variables, data, target_id)
        _add_gap_penalties_for_slots(slot_vars, _class_label(data, target_id))
    elif constraint.category == "TEACHER" and target_id:
        slot_vars = _vars_for_teacher(variables, data, target_id)
        _add_gap_penalties_for_slots(slot_vars, f"teacher_{target_id}")


def _compile_max_gaps_per_day(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: limit gaps per day."""
    # For now, use no_gaps which penalizes each gap individually.
    # The weight system handles prioritization.
    _compile_no_gaps(model, data, variables, constraint)


def _compile_max_gaps_per_week(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: limit total weekly gaps."""
    _compile_no_gaps(model, data, variables, constraint)


# ---------------------------------------------------------------------------
# GLOBAL RULES
# ---------------------------------------------------------------------------

def _compile_early_finish(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: prefer lessons earlier in the day."""
    if constraint.category == "CLASS" and constraint.target_id:
        targets = [constraint.target_id]
    elif constraint.category == "GLOBAL":
        targets = [cg.id for cg in data.class_groups]
    else:
        return

    for cg_id in targets:
        slot_vars = _vars_for_class(variables, data, cg_id)
        for (d, p), vlist in slot_vars.items():
            # Higher period = more penalty
            if p > 1:
                for var in vlist:
                    weighted = model.new_int_var(
                        0, p, f"early_{constraint.id}_c{cg_id}_{d}_p{p}"
                    )
                    model.add(weighted == p * var)
                    # Small penalty proportional to period number
                    variables.penalties.append((weighted, max(1, constraint.weight // 10), constraint.id))


def _compile_class_day_length_limit(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    max_periods = constraint.parameters.get("max_periods")
    day_filter = constraint.parameters.get("day", "ALL")
    if max_periods is None:
        return
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category == "CLASS" and constraint.target_id:
        targets = [constraint.target_id]
    elif constraint.category in ("GLOBAL", "GRADE"):
        targets = [cg.id for cg in data.class_groups]
    else:
        return

    for cg_id in targets:
        slot_vars = _vars_for_class(variables, data, cg_id)
        for day in data.days:
            if day_filter != "ALL" and day != day_filter:
                continue
            # Only count lessons in periods beyond max_periods
            late_vars: list[cp_model.IntVar] = []
            for (d, p), vlist in slot_vars.items():
                if d == day and p > max_periods:
                    late_vars.extend(vlist)
            if not late_vars:
                continue
            if is_hard:
                for var in late_vars:
                    model.add(var == 0)
            else:
                cnt = model.new_int_var(
                    0, len(late_vars),
                    f"day_len_{constraint.id}_c{cg_id}_{day}"
                )
                model.add(cnt == sum(late_vars))
                _add_soft_penalty(model, variables, constraint, cnt,
                                  label=_class_label(data, cg_id))


def _compile_minimize_teacher_days(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: minimize total teaching days across all teachers."""
    teacher_ids: set[int] = set()
    for req in data.requirements:
        if req.teacher_id and not req.is_grouped:
            teacher_ids.add(req.teacher_id)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id:
                teacher_ids.add(track.teacher_id)

    for teacher_id in teacher_ids:
        by_day = _vars_for_teacher_by_day(variables, data, teacher_id)
        for day, day_vars in by_day.items():
            b = model.new_bool_var(f"min_days_{constraint.id}_t{teacher_id}_{day}")
            model.add(sum(day_vars) >= 1).only_enforce_if(b)
            model.add(sum(day_vars) == 0).only_enforce_if(b.negated())
            _add_soft_penalty(model, variables, constraint, b)


def _compile_teacher_first_last_preference(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: teacher prefers first/last period or avoids them."""
    prefer = constraint.parameters.get("prefer")
    target_id = constraint.target_id
    if not prefer or not target_id:
        return

    slot_vars = _vars_for_teacher(variables, data, target_id)
    penalized: list[cp_model.IntVar] = []

    if prefer == "NOT_FIRST":
        for (d, p), vlist in slot_vars.items():
            if p == 1:
                penalized.extend(vlist)
    elif prefer == "NOT_LAST":
        for (d, p), vlist in slot_vars.items():
            if p == data.max_period_per_day.get(d, 0):
                penalized.extend(vlist)
    elif prefer == "FIRST":
        # Penalize NOT being in first period on teaching days
        by_day = _vars_for_teacher_by_day(variables, data, target_id)
        for day, day_vars in by_day.items():
            first_vars = [v for (d, p), vlist in slot_vars.items() for v in vlist if d == day and p == 1]
            if first_vars and day_vars:
                has_lesson = model.new_bool_var(f"fl_has_{constraint.id}_{day}")
                model.add(sum(day_vars) >= 1).only_enforce_if(has_lesson)
                model.add(sum(day_vars) == 0).only_enforce_if(has_lesson.negated())
                has_first = model.new_bool_var(f"fl_first_{constraint.id}_{day}")
                model.add(sum(first_vars) >= 1).only_enforce_if(has_first)
                model.add(sum(first_vars) == 0).only_enforce_if(has_first.negated())
                pen = model.new_bool_var(f"fl_pen_{constraint.id}_{day}")
                # Penalize: has lesson on day but not in first period
                model.add_bool_and([has_lesson, has_first.negated()]).only_enforce_if(pen)
                model.add_bool_or([has_lesson.negated(), has_first]).only_enforce_if(pen.negated())
                _add_soft_penalty(model, variables, constraint, pen)
        return
    elif prefer == "LAST":
        by_day = _vars_for_teacher_by_day(variables, data, target_id)
        for day, day_vars in by_day.items():
            last_p = data.max_period_per_day.get(day, 0)
            last_vars = [v for (d, p), vlist in slot_vars.items() for v in vlist if d == day and p == last_p]
            if last_vars and day_vars:
                has_lesson = model.new_bool_var(f"fl_has_{constraint.id}_{day}")
                model.add(sum(day_vars) >= 1).only_enforce_if(has_lesson)
                model.add(sum(day_vars) == 0).only_enforce_if(has_lesson.negated())
                has_last = model.new_bool_var(f"fl_last_{constraint.id}_{day}")
                model.add(sum(last_vars) >= 1).only_enforce_if(has_last)
                model.add(sum(last_vars) == 0).only_enforce_if(has_last.negated())
                pen = model.new_bool_var(f"fl_pen_{constraint.id}_{day}")
                model.add_bool_and([has_lesson, has_last.negated()]).only_enforce_if(pen)
                model.add_bool_or([has_lesson.negated(), has_last]).only_enforce_if(pen.negated())
                _add_soft_penalty(model, variables, constraint, pen)
        return

    if penalized:
        cnt = model.new_int_var(0, len(penalized), f"fl_{constraint.id}")
        model.add(cnt == sum(penalized))
        _add_soft_penalty(model, variables, constraint, cnt)


# ---------------------------------------------------------------------------
# SAME_DAY_GROUPING, NOT_SAME_DAY_AS, MIN_TEACHING_HOURS_PER_DAY, SYNC_TEACHER_CLASSES
# ---------------------------------------------------------------------------

def _compile_same_day_grouping(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: prefer all hours of a subject for a class on the same day."""
    target_id = constraint.target_id
    if constraint.category != "SUBJECT" or not target_id:
        return

    for req in data.requirements:
        if req.subject_id != target_id or req.is_grouped or not req.teacher_id:
            continue
        slot_vars = _vars_for_subject_class(variables, data, target_id, req.class_group_id)

        # Count how many days have at least one lesson — penalize each extra day beyond 1
        day_bools: list[cp_model.IntVar] = []
        for day in data.days:
            day_vars = [v for (d, p), vlist in slot_vars.items() for v in vlist if d == day]
            if day_vars:
                b = model.new_bool_var(
                    f"sameday_{constraint.id}_c{req.class_group_id}_{day}"
                )
                model.add(sum(day_vars) >= 1).only_enforce_if(b)
                model.add(sum(day_vars) == 0).only_enforce_if(b.negated())
                day_bools.append(b)

        if len(day_bools) > 1:
            # Penalize each day beyond the first
            extra_days = model.new_int_var(
                0, len(day_bools),
                f"sameday_extra_{constraint.id}_c{req.class_group_id}"
            )
            model.add(extra_days == sum(day_bools) - 1)
            model.add(extra_days >= 0)
            _add_soft_penalty(model, variables, constraint, extra_days,
                              label=_class_label(data, req.class_group_id))


def _compile_not_same_day_as(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: two subjects should not appear on the same day for a class."""
    target_id = constraint.target_id  # subject 1
    other_id = constraint.parameters.get("other_subject_id")
    if not target_id or not other_id:
        return

    # Apply to each class that has both subjects
    class_ids = set()
    for req in data.requirements:
        if req.subject_id == target_id and not req.is_grouped and req.teacher_id:
            class_ids.add(req.class_group_id)

    for cid in class_ids:
        vars1 = _vars_for_subject_class(variables, data, target_id, cid)
        vars2 = _vars_for_subject_class(variables, data, other_id, cid)
        if not vars1 or not vars2:
            continue

        for day in data.days:
            dv1 = [v for (d, p), vlist in vars1.items() for v in vlist if d == day]
            dv2 = [v for (d, p), vlist in vars2.items() for v in vlist if d == day]
            if not dv1 or not dv2:
                continue

            b1 = model.new_bool_var(f"notsd_{constraint.id}_c{cid}_{day}_s1")
            b2 = model.new_bool_var(f"notsd_{constraint.id}_c{cid}_{day}_s2")
            model.add(sum(dv1) >= 1).only_enforce_if(b1)
            model.add(sum(dv1) == 0).only_enforce_if(b1.negated())
            model.add(sum(dv2) >= 1).only_enforce_if(b2)
            model.add(sum(dv2) == 0).only_enforce_if(b2.negated())

            # Penalize both subjects on same day
            penalty = model.new_bool_var(f"notsd_pen_{constraint.id}_c{cid}_{day}")
            model.add_bool_and([b1, b2]).only_enforce_if(penalty)
            model.add_bool_or([b1.negated(), b2.negated()]).only_enforce_if(penalty.negated())
            _add_soft_penalty(model, variables, constraint, penalty,
                              label=_class_label(data, cid))


def _compile_min_teaching_hours_per_day(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: if a teacher teaches on a day, they should have at least min hours."""
    min_val = constraint.parameters.get("min")
    target_id = constraint.target_id
    if min_val is None or not target_id:
        return

    by_day = _vars_for_teacher_by_day(variables, data, target_id)
    for day, day_vars in by_day.items():
        if not day_vars:
            continue
        # has_lesson = teacher teaches on this day
        has_lesson = model.new_bool_var(f"minhr_has_{constraint.id}_{day}")
        model.add(sum(day_vars) >= 1).only_enforce_if(has_lesson)
        model.add(sum(day_vars) == 0).only_enforce_if(has_lesson.negated())

        # deficit: how many hours below minimum (only when teaching)
        deficit = model.new_int_var(0, min_val, f"minhr_def_{constraint.id}_{day}")
        model.add(deficit >= min_val - sum(day_vars)).only_enforce_if(has_lesson)
        model.add(deficit == 0).only_enforce_if(has_lesson.negated())
        _add_soft_penalty(model, variables, constraint, deficit)


def _compile_sync_teacher_classes(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT only: prefer a teacher's classes to be on the same days."""
    target_id = constraint.target_id
    if not target_id:
        return

    # Find all class_groups this teacher teaches
    teacher_classes: dict[int, list] = {}  # class_id -> [(day, period, var)]
    for key, var in variables.x.items():
        c_id, s_id, t_id, d, p = key
        if t_id == target_id:
            teacher_classes.setdefault(c_id, []).append((d, p, var))

    class_ids = list(teacher_classes.keys())
    if len(class_ids) < 2:
        return

    # For each pair of classes, penalize if one has lessons on a day and the other doesn't
    for day in data.days:
        day_bools: list[cp_model.IntVar] = []
        for cid in class_ids:
            day_vars = [v for d, p, v in teacher_classes[cid] if d == day]
            if day_vars:
                b = model.new_bool_var(f"sync_tc_{constraint.id}_c{cid}_{day}")
                model.add(sum(day_vars) >= 1).only_enforce_if(b)
                model.add(sum(day_vars) == 0).only_enforce_if(b.negated())
                day_bools.append(b)

        if len(day_bools) < 2:
            continue

        # Penalize: some classes on this day, some not (spread = bad)
        # Ideal: all on or all off. Penalize if not uniform.
        total_on = model.new_int_var(0, len(day_bools), f"sync_tc_on_{constraint.id}_{day}")
        model.add(total_on == sum(day_bools))
        # Penalty if 0 < total_on < len (not all same)
        some_on = model.new_bool_var(f"sync_tc_some_{constraint.id}_{day}")
        all_on = model.new_bool_var(f"sync_tc_all_{constraint.id}_{day}")
        model.add(total_on >= 1).only_enforce_if(some_on)
        model.add(total_on == 0).only_enforce_if(some_on.negated())
        model.add(total_on == len(day_bools)).only_enforce_if(all_on)
        model.add(total_on < len(day_bools)).only_enforce_if(all_on.negated())

        penalty = model.new_bool_var(f"sync_tc_pen_{constraint.id}_{day}")
        # penalty = some_on AND NOT all_on
        model.add_bool_and([some_on, all_on.negated()]).only_enforce_if(penalty)
        model.add_bool_or([some_on.negated(), all_on]).only_enforce_if(penalty.negated())
        _add_soft_penalty(model, variables, constraint, penalty)


# ---------------------------------------------------------------------------
# GRADE RULES
# ---------------------------------------------------------------------------

def _compile_grade_activity_hours(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint,
) -> None:
    """HARD: Block timeslots beyond the max period for each day per grade.

    Parameters:
      periods_per_day_map: {"SUNDAY": 8, "FRIDAY": 4, ...}
      allow_grouped_beyond: int | null  — if set, grouped tracks (הקבצות)
          may extend up to this period even when the class limit is lower.
          Example: allow_grouped_beyond=9 lets מגמות use period 9.
    target_type=GRADE, target_id=grade_id
    """
    periods_map = constraint.parameters.get("periods_per_day_map", {})
    grade_id = constraint.target_id
    allow_grouped_beyond = constraint.parameters.get("allow_grouped_beyond")
    if not periods_map or not grade_id:
        return

    # Find all classes in this grade
    grade_classes = [cg for cg in data.class_groups if cg.grade_id == grade_id]
    if not grade_classes:
        return

    # Build set of track variable names to skip when allow_grouped_beyond is set
    track_var_names: set[str] = set()
    if allow_grouped_beyond:
        for cluster in data.clusters:
            for track in cluster.tracks:
                if track.teacher_id is None:
                    continue
                for tk, var in variables.x_track.items():
                    tr_id, d, p = tk
                    if tr_id == track.id:
                        track_var_names.add(var.name)

    for cg in grade_classes:
        slot_vars = _vars_for_class(variables, data, cg.id)
        for (day, period), vlist in slot_vars.items():
            max_period = periods_map.get(day)
            if max_period is not None and period > max_period:
                for var in vlist:
                    # If allow_grouped_beyond is set and this is a track var
                    # within the extended range, skip blocking it
                    if (allow_grouped_beyond
                            and period <= allow_grouped_beyond
                            and var.name in track_var_names):
                        continue
                    model.add(var == 0)


def _compile_short_days_flexible(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint,
) -> None:
    """HARD: At least N days per week must be 'short' (no lessons after max_period_short).

    Parameters: {"num_short_days": 2, "max_period_short": 5}
    target_type=GRADE, target_id=grade_id
    The solver chooses which days are short.
    """
    num_short = constraint.parameters.get("num_short_days", 2)
    max_p_short = constraint.parameters.get("max_period_short", 5)
    grade_id = constraint.target_id
    if not grade_id:
        return

    grade_classes = [cg for cg in data.class_groups if cg.grade_id == grade_id]
    if not grade_classes:
        return

    for cg in grade_classes:
        slot_vars = _vars_for_class(variables, data, cg.id)
        is_short: list[cp_model.IntVar] = []

        for day in data.days:
            # Collect vars for periods > max_p_short on this day
            late_vars: list[cp_model.IntVar] = []
            for (d, p), vlist in slot_vars.items():
                if d == day and p > max_p_short:
                    late_vars.extend(vlist)

            if not late_vars:
                # Day is always short (no late slots available) — counts as short
                is_short_day = model.new_bool_var(
                    f"short_{constraint.id}_c{cg.id}_{day}"
                )
                model.add(is_short_day == 1)
                is_short.append(is_short_day)
                continue

            # is_short_day = 1 if NO lessons after max_p_short
            is_short_day = model.new_bool_var(
                f"short_{constraint.id}_c{cg.id}_{day}"
            )
            model.add(sum(late_vars) == 0).only_enforce_if(is_short_day)
            model.add(sum(late_vars) >= 1).only_enforce_if(is_short_day.negated())
            is_short.append(is_short_day)

        if is_short:
            model.add(sum(is_short) >= num_short)


# ---------------------------------------------------------------------------
# SECONDARY_TRACK_END_OF_DAY
# Secondary tracks must be contiguous and at the end of the school day.
# HARD: consecutive hours ending at the last period.
# SOFT: penalty proportional to how early each active hour is.
# ---------------------------------------------------------------------------
def _compile_secondary_track_end_of_day(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    target_cluster_id = constraint.target_id  # None means ALL clusters
    is_hard = constraint.type == "HARD"

    for cluster in data.clusters:
        if target_cluster_id is not None and cluster.id != target_cluster_id:
            continue

        for track in cluster.tracks:
            if not track.is_secondary or track.teacher_id is None:
                continue

            for day in data.days:
                max_p = data.max_period_per_day.get(day, 8)
                periods = sorted(
                    p for p in range(1, max_p + 1)
                    if (track.id, day, p) in variables.x_track
                )
                if not periods:
                    continue

                if is_hard:
                    # 1) Contiguous suffix: if active at p, must be active at p+1
                    #    i.e. x[p] <= x[p+1] for all consecutive periods
                    for i in range(len(periods) - 1):
                        p_curr = periods[i]
                        p_next = periods[i + 1]
                        k_curr = (track.id, day, p_curr)
                        k_next = (track.id, day, p_next)
                        model.add(
                            variables.x_track[k_curr] <= variables.x_track[k_next]
                        )

                    # 2) End of day: if any hour active on this day,
                    #    the last period must be active.
                    day_vars = [
                        variables.x_track[(track.id, day, p)]
                        for p in periods
                    ]
                    last_k = (track.id, day, periods[-1])
                    # If sum(day_vars) >= 1, then x_track[last] == 1
                    has_any = model.new_bool_var(
                        f"sec_eod_any_{constraint.id}_t{track.id}_{day}"
                    )
                    model.add(sum(day_vars) >= 1).only_enforce_if(has_any)
                    model.add(sum(day_vars) == 0).only_enforce_if(has_any.negated())
                    model.add(
                        variables.x_track[last_k] == 1
                    ).only_enforce_if(has_any)
                else:
                    # SOFT: penalty proportional to (max_p - period)
                    for p in periods:
                        penalty_weight = max_p - p
                        if penalty_weight > 0:
                            variables.penalties.append(
                                (variables.x_track[(track.id, day, p)],
                                 penalty_weight, constraint.id)
                            )


# ---------------------------------------------------------------------------
# GROUPING_EXTRA_AT_END
# In variable-hours groupings, extra hours (reference active, short inactive)
# must be at the end of the day.
# HARD: extra hours form a contiguous suffix (enforced via contiguous prefix
#   already in SC12) AND the grouping block itself ends at the last period.
# SOFT: penalty proportional to how early each extra hour is.
# ---------------------------------------------------------------------------
def _compile_grouping_extra_at_end(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    target_cluster_id = constraint.target_id  # None means ALL clusters
    is_hard = constraint.type == "HARD"

    for cluster in data.clusters:
        if target_cluster_id is not None and cluster.id != target_cluster_id:
            continue

        primary_tracks = [
            t for t in cluster.tracks
            if t.teacher_id is not None and not t.is_secondary
        ]
        if len(primary_tracks) < 2:
            continue

        hours_set = set(t.hours_per_week for t in primary_tracks)
        if len(hours_set) <= 1:
            continue  # All same hours — no extra hours concept

        max_hours = max(hours_set)
        ref_track = next(t for t in primary_tracks if t.hours_per_week == max_hours)

        for day in data.days:
            max_p = data.max_period_per_day.get(day, 8)

            for period in range(1, max_p + 1):
                k_ref = (ref_track.id, day, period)
                if k_ref not in variables.x_track:
                    continue

                if is_hard:
                    # HARD: if ref track is active at this period on this day,
                    # then ref must also be active at the last period.
                    # This ensures the grouping block reaches the end of the day.
                    k_last = (ref_track.id, day, max_p)
                    if k_last in variables.x_track and period != max_p:
                        # x_ref[period] => x_ref[max_p]
                        model.add(
                            variables.x_track[k_last] >= variables.x_track[k_ref]
                        )
                else:
                    # SOFT: for each (ref active, short inactive) extra hour,
                    # penalize early placement
                    short_tracks = [
                        t for t in primary_tracks if t.hours_per_week < max_hours
                    ]
                    for short_track in short_tracks:
                        k_short = (short_track.id, day, period)
                        if k_short not in variables.x_track:
                            continue
                        # is_extra = ref active AND short inactive
                        is_extra = model.new_bool_var(
                            f"extra_eod_{constraint.id}_c{cluster.id}"
                            f"_t{short_track.id}_{day}_p{period}"
                        )
                        model.add(
                            variables.x_track[k_ref] - variables.x_track[k_short] == 1
                        ).only_enforce_if(is_extra)
                        model.add(
                            variables.x_track[k_ref] - variables.x_track[k_short] != 1
                        ).only_enforce_if(is_extra.negated())

                        penalty_weight = max_p - period
                        if penalty_weight > 0:
                            variables.penalties.append(
                                (is_extra, penalty_weight, constraint.id)
                            )


# ---------------------------------------------------------------------------
# COMPACT_SCHOOL_DAY
# Lessons form a contiguous block starting from period 1, min N periods.
# HARD: strictly enforced (prefix property + min count).
# SOFT: penalty for each violation (gap, late start, short day).
# ---------------------------------------------------------------------------
def _compile_compact_school_day(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    min_periods = constraint.parameters.get("min_periods", 6)
    is_hard = constraint.type == "HARD"

    # Determine target classes
    if constraint.category == "CLASS" and constraint.target_id:
        targets = [constraint.target_id]
    elif constraint.category in ("GLOBAL", "CLASS"):
        targets = [cg.id for cg in data.class_groups]
    else:
        return

    for cg_id in targets:
        slot_vars = _vars_for_class(variables, data, cg_id)

        for day in data.days:
            max_p = data.max_period_per_day.get(day, 0)
            if max_p < 1:
                continue

            periods = sorted(p for (d, p) in slot_vars if d == day)
            if not periods:
                continue

            # Build occupied[p] bool for each period
            occ: dict[int, cp_model.IntVar] = {}
            for p in periods:
                vlist = slot_vars.get((day, p), [])
                if vlist:
                    b = model.new_bool_var(f"compact_occ_{cg_id}_{day}_p{p}")
                    model.add(sum(vlist) >= 1).only_enforce_if(b)
                    model.add(sum(vlist) == 0).only_enforce_if(b.negated())
                    occ[p] = b

            if not occ:
                continue

            # day_active = at least one lesson this day
            day_active = model.new_bool_var(f"compact_active_{cg_id}_{day}")
            model.add(sum(occ.values()) >= 1).only_enforce_if(day_active)
            model.add(sum(occ.values()) == 0).only_enforce_if(day_active.negated())

            if is_hard:
                # 1) If day active, period 1 must be occupied
                if 1 in occ:
                    model.add(occ[1] == 1).only_enforce_if(day_active)

                # 2) Prefix property: if period p is free, all later periods free
                #    (no gaps, contiguous from period 1)
                for i in range(len(periods) - 1):
                    p_cur = periods[i]
                    p_next = periods[i + 1]
                    if p_cur in occ and p_next in occ:
                        # if p_cur is free, p_next must be free
                        model.add(occ[p_next] == 0).only_enforce_if(
                            occ[p_cur].negated()
                        )

                # 3) Min periods: if day active, at least min_periods lessons
                model.add(
                    sum(occ.values()) >= min_periods
                ).only_enforce_if(day_active)

            else:
                # SOFT: penalize violations
                # Penalty for not starting at period 1
                if 1 in occ:
                    not_at_1 = model.new_bool_var(
                        f"compact_no1_{cg_id}_{day}"
                    )
                    model.add(occ[1] == 0).only_enforce_if(not_at_1)
                    model.add(occ[1] == 1).only_enforce_if(not_at_1.negated())
                    # Only penalize if day is active
                    pen = model.new_bool_var(f"compact_pen1_{cg_id}_{day}")
                    model.add_bool_and([not_at_1, day_active]).only_enforce_if(pen)
                    model.add_bool_or([not_at_1.negated(), day_active.negated()]).only_enforce_if(pen.negated())
                    _add_soft_penalty(model, variables, constraint, pen,
                                      label=_class_label(data, cg_id))

                # Penalty for gaps (prefix violation)
                for i in range(len(periods) - 1):
                    p_cur = periods[i]
                    p_next = periods[i + 1]
                    if p_cur in occ and p_next in occ:
                        gap = model.new_bool_var(
                            f"compact_gap_{cg_id}_{day}_p{p_cur}"
                        )
                        # gap if p_cur free but p_next occupied
                        model.add_bool_and(
                            [occ[p_cur].negated(), occ[p_next]]
                        ).only_enforce_if(gap)
                        model.add_bool_or(
                            [occ[p_cur], occ[p_next].negated()]
                        ).only_enforce_if(gap.negated())
                        _add_soft_penalty(model, variables, constraint, gap,
                                          label=_class_label(data, cg_id))

                # Penalty for short day
                shortfall = model.new_int_var(
                    0, min_periods,
                    f"compact_short_{cg_id}_{day}",
                )
                model.add(
                    min_periods - sum(occ.values()) <= shortfall
                )
                model.add(shortfall >= 0)
                # Only penalize if day active
                shortfall_if_active = model.new_int_var(
                    0, min_periods,
                    f"compact_short_act_{cg_id}_{day}",
                )
                model.add(shortfall_if_active == shortfall).only_enforce_if(day_active)
                model.add(shortfall_if_active == 0).only_enforce_if(day_active.negated())
                _add_soft_penalty(
                    model, variables, constraint, shortfall_if_active,
                    label=_class_label(data, cg_id),
                )


def _compile_homeroom_early(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """SOFT: homeroom teacher lessons for their class should be at the beginning of the day.

    For each teacher with homeroom_class_id, penalize their lessons for that
    specific class when scheduled in later periods.  The penalty grows with
    the period number so periods 1-2 are free, and later periods get increasing cost.
    """
    if not data.homeroom_map:
        return

    for teacher_id, class_id in data.homeroom_map.items():
        # Find x variables where this teacher teaches this class
        for key, var in variables.x.items():
            c_id, s_id, t_id, day, period = key
            if t_id != teacher_id or c_id != class_id:
                continue
            # No penalty for first 2 periods — homeroom is fine there
            if period <= 2:
                continue
            # Penalty proportional to how late in the day (period 3→1, 4→2, 5→3, ...)
            lateness = period - 2
            weighted = model.new_int_var(
                0, lateness,
                f"hr_early_{constraint.id}_t{teacher_id}_c{class_id}_{day}_p{period}",
            )
            model.add(weighted == lateness * var)
            _add_soft_penalty(model, variables, constraint, weighted)


# ---------------------------------------------------------------------------
# CLASS_END_TIME — classes must finish at specific periods on given days
# ---------------------------------------------------------------------------

def _compile_class_end_time(
    model: cp_model.CpModel, data: SolverData,
    variables: SolverVariables, constraint: Constraint,
) -> None:
    """CLASS_END_TIME: on specified days, the last lesson for each class must
    fall within [min_period, max_period].

    Parameters:
        days: list[str] — which days (e.g. ["MONDAY", "WEDNESDAY"])
        min_period: int — earliest allowed end period
        max_period: int — latest allowed end period
    """
    target_days = constraint.parameters.get("days", [])
    min_period = constraint.parameters.get("min_period")
    max_period = constraint.parameters.get("max_period")
    if not target_days or min_period is None or max_period is None:
        return
    is_hard = constraint.type == ConstraintType.HARD

    if constraint.category == "CLASS" and constraint.target_id:
        targets = [constraint.target_id]
    else:
        targets = [cg.id for cg in data.class_groups]

    for cg_id in targets:
        slot_vars = _vars_for_class(variables, data, cg_id)
        for day in data.days:
            if day not in target_days:
                continue

            # 1) No lessons after max_period
            late_vars: list[cp_model.IntVar] = []
            for (d, p), vlist in slot_vars.items():
                if d == day and p > max_period:
                    late_vars.extend(vlist)
            if late_vars:
                if is_hard:
                    for var in late_vars:
                        model.add(var == 0)
                else:
                    cnt = model.new_int_var(
                        0, len(late_vars),
                        f"end_late_{constraint.id}_c{cg_id}_{day}",
                    )
                    model.add(cnt == sum(late_vars))
                    _add_soft_penalty(model, variables, constraint, cnt,
                                      label=_class_label(data, cg_id))

            # 2) At least one lesson in [min_period, max_period]
            target_vars: list[cp_model.IntVar] = []
            for (d, p), vlist in slot_vars.items():
                if d == day and min_period <= p <= max_period:
                    target_vars.extend(vlist)
            if target_vars:
                if is_hard:
                    model.add(sum(target_vars) >= 1)
                else:
                    has_end = model.new_bool_var(
                        f"end_has_{constraint.id}_c{cg_id}_{day}",
                    )
                    model.add(sum(target_vars) >= 1).only_enforce_if(has_end)
                    model.add(sum(target_vars) == 0).only_enforce_if(has_end.negated())
                    missing = model.new_bool_var(
                        f"end_miss_{constraint.id}_c{cg_id}_{day}",
                    )
                    model.add(missing == 1 - has_end)
                    _add_soft_penalty(model, variables, constraint, missing,
                                      label=_class_label(data, cg_id))


# ---------------------------------------------------------------------------
# Compiler dispatch table
# ---------------------------------------------------------------------------

_COMPILERS = {
    RuleType.BLOCK_TIMESLOT: _compile_block_timeslot,
    RuleType.BLOCK_DAY: _compile_block_day,
    RuleType.BLOCK_TIME_RANGE: _compile_block_time_range,
    RuleType.PREFER_TIME_RANGE: _compile_prefer_time_range,
    RuleType.PREFER_TIMESLOT: _compile_block_timeslot,  # Same logic, soft
    RuleType.AVOID_LAST_PERIOD: _compile_avoid_last_period,
    RuleType.MAX_PER_DAY: _compile_max_per_day,
    RuleType.MIN_DAYS_SPREAD: _compile_min_days_spread,
    RuleType.NO_CONSECUTIVE_DAYS: _compile_no_consecutive_days,
    RuleType.REQUIRE_CONSECUTIVE_PERIODS: _compile_require_consecutive_periods,
    RuleType.SAME_DAY_GROUPING: _compile_same_day_grouping,
    RuleType.NOT_SAME_DAY_AS: _compile_not_same_day_as,
    RuleType.MAX_TEACHING_HOURS_PER_DAY: _compile_max_teaching_hours_per_day,
    RuleType.MIN_TEACHING_HOURS_PER_DAY: _compile_min_teaching_hours_per_day,
    RuleType.MAX_TEACHING_DAYS: _compile_max_teaching_days,
    RuleType.MIN_FREE_DAYS: _compile_min_free_days,
    RuleType.BALANCED_DAILY_LOAD: _compile_balanced_daily_load,
    RuleType.NO_GAPS: _compile_no_gaps,
    RuleType.MAX_GAPS_PER_DAY: _compile_max_gaps_per_day,
    RuleType.MAX_GAPS_PER_WEEK: _compile_max_gaps_per_week,
    # SYNC_TRACKS is handled by system constraint in model_builder — skip here
    RuleType.SYNC_TEACHER_CLASSES: _compile_sync_teacher_classes,
    RuleType.EARLY_FINISH: _compile_early_finish,
    RuleType.MINIMIZE_TEACHER_DAYS: _compile_minimize_teacher_days,
    RuleType.CLASS_DAY_LENGTH_LIMIT: _compile_class_day_length_limit,
    RuleType.TEACHER_FIRST_LAST_PREFERENCE: _compile_teacher_first_last_preference,
    RuleType.GRADE_ACTIVITY_HOURS: _compile_grade_activity_hours,
    RuleType.SHORT_DAYS_FLEXIBLE: _compile_short_days_flexible,
    RuleType.SECONDARY_TRACK_END_OF_DAY: _compile_secondary_track_end_of_day,
    RuleType.GROUPING_EXTRA_AT_END: _compile_grouping_extra_at_end,
    RuleType.COMPACT_SCHOOL_DAY: _compile_compact_school_day,
    RuleType.HOMEROOM_EARLY: _compile_homeroom_early,
    RuleType.CLASS_END_TIME: _compile_class_end_time,
}
