"""Brain module — intelligent scheduling principles.

The brain encodes pedagogical heuristics that an experienced human scheduler
would apply intuitively.  These are always-on soft constraints with calibrated
weights that steer the optimizer toward better solutions without the user
needing to configure them manually.

Brain constraints use negative IDs to distinguish them from user constraints.
"""

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from app.solver.model_builder import SolverData, SolverVariables

# ── Double-period targets ──────────────────────────────────────────────────
# hours_per_week → ideal number of double-period (consecutive pair) sessions.
_DOUBLE_TARGETS: dict[int, int] = {
    3: 1,   # 1 double + 1 single = 3
    4: 1,   # 1 double + 2 singles = 4
    5: 2,   # 2 doubles + 1 single = 5
    6: 2,   # 2 doubles + 2 singles = 6
    7: 3,   # 3 doubles + 1 single = 7
    8: 3,   # 3 doubles + 2 singles = 8
}


def _target_doubles(hours: int) -> int:
    """How many double-period sessions a subject ideally needs."""
    if hours in _DOUBLE_TARGETS:
        return _DOUBLE_TARGETS[hours]
    if hours <= 2:
        return 0
    return max(1, (hours + 1) // 3)


def _double_weight(hours: int) -> int:
    """Soft constraint weight for double-period preference.

    More weekly hours → higher importance for having doubles.
    3h→60, 4h→70, 5h→80, 6h→85, 7h+→90
    """
    if hours <= 3:
        return 60
    if hours <= 4:
        return 70
    if hours <= 5:
        return 80
    if hours <= 6:
        return 85
    return 90


def _get_subject_priority(subject_obj: object | None) -> int | None:
    """Get manual double_priority from a Subject, if set."""
    return getattr(subject_obj, "double_priority", None)


# ══════════════════════════════════════════════════════════════════════════
# AUTOMATIC PRINCIPLES — always-on, all schools, not user-configurable.
# These encode basic scheduling reality:
#   1. Compact school day: classes start at period 1, no gaps (HARD)
# ══════════════════════════════════════════════════════════════════════════

def _class_slot_vars(
    data: SolverData, variables: SolverVariables, class_group_id: int,
) -> dict[tuple[str, int], list[cp_model.IntVar]]:
    """Return {(day, period): [vars]} for a class — lessons + relevant tracks."""
    result: dict[tuple[str, int], list[cp_model.IntVar]] = {}
    for key, var in variables.x.items():
        c_id, _s, _t, d, p = key
        if c_id == class_group_id:
            result.setdefault((d, p), []).append(var)

    added_tracks: set[int] = set()
    for cluster in data.clusters:
        source_ids = {sc.id for sc in cluster.source_classes}
        if class_group_id not in source_ids:
            continue
        for track in cluster.tracks:
            if track.id in added_tracks:
                continue
            src = getattr(track, "source_class_id", None)
            if src is not None and src != class_group_id:
                continue
            added_tracks.add(track.id)
            for tk_key, var in variables.x_track.items():
                tk_id, d, p = tk_key
                if tk_id == track.id:
                    result.setdefault((d, p), []).append(var)

    return result


def _auto_compact_school_day(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Automatic principle: compact school day for ALL classes.

    HARD constraint — classes must have a contiguous block of lessons
    starting from period 1 with no gaps.
    """
    for cg in data.class_groups:
        cg_id = cg.id
        slot_vars = _class_slot_vars(data, variables, cg_id)

        for day in data.days:
            max_p = data.max_period_per_day.get(day, 0)
            if max_p < 1:
                continue

            periods = sorted(p for (d, p) in slot_vars if d == day)
            if not periods:
                continue

            # Build occupied[p] = bool var for each period
            occ: dict[int, cp_model.IntVar] = {}
            for p in periods:
                vlist = slot_vars.get((day, p), [])
                if vlist:
                    b = model.new_bool_var(f"auto_compact_{cg_id}_{day}_p{p}")
                    model.add(sum(vlist) >= 1).only_enforce_if(b)
                    model.add(sum(vlist) == 0).only_enforce_if(b.negated())
                    occ[p] = b

            if not occ:
                continue

            # day_active = at least one lesson this day
            day_active = model.new_bool_var(f"auto_compact_active_{cg_id}_{day}")
            model.add(sum(occ.values()) >= 1).only_enforce_if(day_active)
            model.add(sum(occ.values()) == 0).only_enforce_if(day_active.negated())

            # 1) If day active, period 1 must be occupied
            if 1 in occ:
                model.add(occ[1] == 1).only_enforce_if(day_active)

            # 2) Prefix property: if period p is free, all later periods free
            #    (no gaps — contiguous block from period 1)
            for i in range(len(periods) - 1):
                p_cur = periods[i]
                p_next = periods[i + 1]
                if p_cur in occ and p_next in occ:
                    model.add(occ[p_next] == 0).only_enforce_if(
                        occ[p_cur].negated()
                    )


# ── Main entry point ──────────────────────────────────────────────────────

def apply_brain_constraints(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Apply all brain heuristics to the model."""
    _NEXT_BRAIN_ID_HOLDER.clear()

    # ═══════════════════════════════════════════════════════════════════════
    # Automatic principles — fundamental rules that apply to ALL schools.
    # These are not configurable by the user; they represent basic
    # scheduling reality that every school timetable must follow.
    # ═══════════════════════════════════════════════════════════════════════
    _auto_compact_school_day(model, data, variables)

    # ═══════════════════════════════════════════════════════════════════════
    # Brain heuristics — intelligent scheduling preferences
    # ═══════════════════════════════════════════════════════════════════════
    _apply_same_day_consecutive(model, data, variables)
    # MAX_SUBJECT_PER_DAY removed — now managed via DB constraint (MAX_PER_DAY)
    _apply_always_double(model, data, variables)
    _apply_double_period_preferences(model, data, variables)
    _apply_morning_priority(model, data, variables)
    _apply_flexible_meeting_attendance(model, data, variables)
    _apply_plenary_preferred_attendance(model, data, variables)
    _apply_plenary_preferred_no_overlap(model, data, variables)
    _apply_non_plenary_teachers_teach_during_plenary(model, data, variables)
    _apply_homeroom_daily_meeting(model, data, variables)
    _apply_max_consecutive_meetings(model, data, variables)

    # Compute frontal hours per teacher (shared by oz la tmura)
    teacher_frontal = _compute_teacher_frontal(data)

    # Build shared gap indicators ONCE
    gap_indicators = _build_teacher_gap_indicators(model, data, variables)

    # SOFT: minimize gaps (existing brain rule)
    _apply_teacher_gap_minimization(model, data, variables, gap_indicators)
    # HARD: Oz LaTmura gap limit (accounts for meetings as שהייה)
    _apply_oz_la_tmura(model, data, variables, gap_indicators, teacher_frontal)
    # HARD: max teaching days based on frontal hours (עוז לתמורה ימי עבודה)
    _apply_max_days_by_frontal(model, data, variables, teacher_frontal)
    # HARD: max 6 consecutive frontal teaching hours per day
    _apply_max_consecutive_frontal(model, data, variables)
    # HARD: management team gets at least 1 free day per week
    _apply_management_free_day(model, data, variables)
    # SOFT: transport teachers prefer early finish
    _apply_transport_early_finish(model, data, variables)


# ── Same-day consecutive (HARD) ───────────────────────────────────────────

def _collect_subject_day_vars(
    data: SolverData, variables: SolverVariables,
) -> list[tuple[str, str, dict[int, cp_model.IntVar]]]:
    """Collect {period: var} per (label, day) for all subject-class combos.

    Returns list of (label, day, {period: var}) tuples covering both
    regular requirements and grouping tracks.
    """
    result: list[tuple[str, str, dict[int, cp_model.IntVar]]] = []

    # Regular requirements grouped by (class_group_id, subject_id)
    req_groups: dict[tuple[int, int], list] = defaultdict(list)
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        req_groups[(req.class_group_id, req.subject_id)].append(req)

    for (cg_id, s_id), reqs in req_groups.items():
        for day in data.days:
            period_vars: dict[int, cp_model.IntVar] = {}
            for req in reqs:
                for p in range(1, data.max_period_per_day.get(day, 0) + 1):
                    var = variables.x.get((cg_id, s_id, req.teacher_id, day, p))
                    if var is not None:
                        if p in period_vars:
                            # Multiple teachers for same subject-class — OR them
                            # (rare, but handle gracefully by summing)
                            pass
                        else:
                            period_vars[p] = var
            if period_vars:
                result.append((f"c{cg_id}_s{s_id}", day, period_vars))

    # Grouping tracks — EACH track individually
    # (not just the representative, because variable-hours tracks that are
    # subsets of the rep can cherry-pick non-consecutive slots)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            for day in data.days:
                period_vars: dict[int, cp_model.IntVar] = {}
                for p in range(1, data.max_period_per_day.get(day, 0) + 1):
                    var = variables.x_track.get((track.id, day, p))
                    if var is not None:
                        period_vars[p] = var
                if period_vars:
                    result.append((f"cl{cluster.id}_tr{track.id}", day, period_vars))

    return result


def _apply_same_day_consecutive(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """HARD: if a subject has 2+ hours on the same day, they must be consecutive.

    Enforced via contiguity: for any three consecutive periods (p, p+1, p+2),
    if both p and p+2 are active then p+1 must also be active.
    """
    for label, day, period_vars in _collect_subject_day_vars(data, variables):
        sorted_periods = sorted(period_vars.keys())
        for i in range(len(sorted_periods) - 2):
            p_a = sorted_periods[i]
            for j in range(i + 2, len(sorted_periods)):
                p_c = sorted_periods[j]
                # Check all intermediate periods exist
                for k in range(i + 1, j):
                    p_b = sorted_periods[k]
                    if p_b in period_vars:
                        # x[p_a] + x[p_c] <= 1 + x[p_b]
                        model.add(
                            period_vars[p_a] + period_vars[p_c]
                            <= 1 + period_vars[p_b]
                        )



# ── Double-period preference ──────────────────────────────────────────────

def _apply_double_period_preferences(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Brain principle: subjects with 3+ hours/week should have double periods.

    Applies to both regular requirements and grouping tracks.
    """
    # Collect entries: (subject_id, subject_obj, hours, var_getter)
    # Each entry produces pair_vars for one "unit" (requirement or track)
    SubjectEntry = tuple  # (subject_id, subject_obj, hours, pair_var_builder)

    entries_by_subject: dict[int, list[dict]] = defaultdict(list)

    # ── Regular requirements ──────────────────────────────────────────
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        if req.hours_per_week < 3:
            continue
        entries_by_subject[req.subject_id].append({
            "hours": req.hours_per_week,
            "subject_obj": req.subject,
            "label": f"c{req.class_group_id}",
            "var_keys": [
                (day, p, variables.x.get((req.class_group_id, req.subject_id, req.teacher_id, day, p)))
                for day in data.days
                for p in range(1, data.max_period_per_day.get(day, 0) + 1)
            ],
        })

    # ── Grouping tracks ──────────────────────────────────────────────
    # All tracks in a cluster are synced, so use one representative per cluster
    for cluster in data.clusters:
        if not cluster.tracks:
            continue
        # Use max hours among tracks (they're synced to same slots)
        rep_track = max(cluster.tracks, key=lambda t: t.hours_per_week)
        if rep_track.hours_per_week < 3:
            continue

        # Get subject object directly from cluster relationship
        subject_obj = cluster.subject
        if subject_obj is None:
            subject_obj = type("FakeSubject", (), {
                "name": cluster.name,
                "double_priority": None,
            })()

        entries_by_subject[cluster.subject_id].append({
            "hours": rep_track.hours_per_week,
            "subject_obj": subject_obj,
            "label": f"cluster{cluster.id}",
            "var_keys": [
                (day, p, variables.x_track.get((rep_track.id, day, p)))
                for day in data.days
                for p in range(1, data.max_period_per_day.get(day, 0) + 1)
            ],
        })

    # ── Build brain constraints per subject ───────────────────────────
    brain_id = -1

    for subject_id, entries in entries_by_subject.items():
        # Subject name
        subject_name = f"מקצוע {subject_id}"
        subject_obj = None
        for e in entries:
            so = e["subject_obj"]
            if so and hasattr(so, "name") and so.name:
                subject_name = so.name
                subject_obj = so
                break

        # Weight: manual priority overrides auto
        manual_priority = _get_subject_priority(subject_obj)
        max_hours = max(e["hours"] for e in entries)
        weight = manual_priority if manual_priority is not None else _double_weight(max_hours)

        if weight <= 0:
            continue

        has_any_penalty = False

        for entry in entries:
            target = _target_doubles(entry["hours"])
            if target <= 0:
                continue

            # Build consecutive-pair indicators
            # Group vars by day first
            vars_by_day: dict[str, dict[int, cp_model.IntVar]] = defaultdict(dict)
            for day, period, var in entry["var_keys"]:
                if var is not None:
                    vars_by_day[day][period] = var

            pair_vars: list[cp_model.IntVar] = []
            for day, period_vars in vars_by_day.items():
                sorted_periods = sorted(period_vars.keys())
                for i in range(len(sorted_periods) - 1):
                    p = sorted_periods[i]
                    p1 = sorted_periods[i + 1]
                    if p1 != p + 1:
                        continue  # Not consecutive
                    var_p = period_vars[p]
                    var_p1 = period_vars[p1]

                    pair = model.new_bool_var(
                        f"brain_pair_{entry['label']}_s{subject_id}_{day}_p{p}"
                    )
                    model.add(pair <= var_p)
                    model.add(pair <= var_p1)
                    model.add(pair >= var_p + var_p1 - 1)
                    pair_vars.append(pair)

            if not pair_vars:
                continue

            # Sum of consecutive pairs achieved
            total_doubles = model.new_int_var(
                0, len(pair_vars),
                f"brain_dbls_{entry['label']}_s{subject_id}",
            )
            model.add(total_doubles == sum(pair_vars))

            # Shortfall = max(0, target − actual_doubles)
            shortfall = model.new_int_var(
                0, target,
                f"brain_dbl_short_{entry['label']}_s{subject_id}",
            )
            model.add(shortfall >= target - total_doubles)

            variables.penalties.append((shortfall, weight, brain_id))
            has_any_penalty = True

        if has_any_penalty:
            variables.brain_info[brain_id] = {
                "name": f"שיעורים כפולים — {subject_name}",
                "weight": weight,
            }
            brain_id -= 1

    # Store next available brain_id for other rules
    _NEXT_BRAIN_ID_HOLDER.append(brain_id)


# Shared counter across brain rules
_NEXT_BRAIN_ID_HOLDER: list[int] = []


def _next_brain_id() -> int:
    """Get the next available brain constraint ID."""
    if _NEXT_BRAIN_ID_HOLDER:
        return _NEXT_BRAIN_ID_HOLDER[-1]
    return -100


def _update_brain_id(brain_id: int) -> None:
    """Update the shared brain ID counter after a brain function uses IDs."""
    _NEXT_BRAIN_ID_HOLDER.append(brain_id)


# ── Consecutive blocks (HARD or SOFT) ────────────────────────────────────

_CONSECUTIVE_SOFT_WEIGHT = 90  # High weight for soft consecutive preference


def _get_consecutive_settings(req, data) -> tuple[int, str] | None:
    """Get (count, mode) for a requirement.

    Priority: consecutive_count/mode > always_double > subject.always_double
    Returns None if no consecutive requirement.
    """
    count = getattr(req, "consecutive_count", None)
    mode = getattr(req, "consecutive_mode", None)
    if count and count >= 2 and mode in ("hard", "soft"):
        return (count, mode)
    # Fallback: always_double = count=2, hard
    req_double = getattr(req, "always_double", False)
    if req_double:
        return (2, "hard")
    subj_double = getattr(req.subject, "always_double", False) if req.subject else False
    if subj_double:
        return (2, "hard")
    return None


def _get_cluster_consecutive_settings(cluster, data) -> tuple[int, str] | None:
    """Get (count, mode) for a cluster.

    Priority: cluster fields > grouped requirement fields > subject always_double.
    """
    # Check cluster-level fields first
    cc = getattr(cluster, "consecutive_count", None)
    cm = getattr(cluster, "consecutive_mode", None)
    if cc and cc >= 2 and cm in ("hard", "soft"):
        return (cc, cm)
    # Check grouped requirements
    for req in data.requirements:
        if req.is_grouped and req.grouping_cluster_id == cluster.id:
            result = _get_consecutive_settings(req, data)
            if result:
                return result
    # Check subject-level always_double
    subject_obj = cluster.subject
    if subject_obj and getattr(subject_obj, "always_double", False):
        return (2, "hard")
    return None


def _apply_always_double(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Enforce consecutive block constraints (count=2 or 3, hard or soft).

    HARD mode: Since same_day_consecutive guarantees contiguity, we decompose
    each day's count as count*blocks + remainder and enforce remainder limits.

    SOFT mode: Penalize remainder (non-block lessons) with high weight.
    """
    brain_id = _next_brain_id() - 1

    def _add_block_constraints(
        label: str,
        hours: int,
        count: int,
        is_hard: bool,
        var_getter,
    ) -> bool:
        """Add constraints for consecutive blocks of size `count`."""
        nonlocal brain_id
        remainders: list[cp_model.IntVar] = []

        for day in data.days:
            max_p = data.max_period_per_day.get(day, 0)
            day_vars = []
            for p in range(1, max_p + 1):
                var = var_getter(day, p)
                if var is not None:
                    day_vars.append(var)
            if not day_vars:
                continue

            day_sum = sum(day_vars)
            blocks = model.new_int_var(0, len(day_vars) // count,
                                       f"consec_blocks_{label}_{day}")
            rem = model.new_int_var(0, count - 1, f"consec_rem_{label}_{day}")
            model.add(day_sum == count * blocks + rem)
            remainders.append(rem)

        if not remainders:
            return False

        # How many leftover hours are unavoidable?
        allowed_remainder = hours % count  # e.g., 5 hours / 2 = 1 leftover

        if is_hard:
            # Total remainder across all days must equal exactly the unavoidable leftover
            model.add(sum(remainders) <= allowed_remainder)
        else:
            # SOFT: penalize remainder beyond unavoidable
            max_rem = (count - 1) * len(remainders)
            excess = model.new_int_var(0, max(0, max_rem - allowed_remainder),
                                       f"consec_excess_{label}")
            model.add(excess >= sum(remainders) - allowed_remainder)
            model.add(excess >= 0)
            if max_rem > allowed_remainder:
                variables.penalties.append(
                    (excess, _CONSECUTIVE_SOFT_WEIGHT, brain_id)
                )

        return True

    has_any = False

    # ── Regular requirements ───────────────────────────────────────────
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        settings = _get_consecutive_settings(req, data)
        if not settings:
            continue
        count, mode = settings
        if req.hours_per_week < 2:
            continue

        def _get_req_var(day, p, _req=req):
            return variables.x.get(
                (_req.class_group_id, _req.subject_id, _req.teacher_id, day, p)
            )

        is_hard = mode == "hard"
        added = _add_block_constraints(
            f"r{req.id}", req.hours_per_week, count, is_hard, _get_req_var,
        )
        if added:
            subj_name = req.subject.name if req.subject else f"מקצוע {req.subject_id}"
            class_name = None
            for cg in data.class_groups:
                if cg.id == req.class_group_id:
                    class_name = cg.name
                    break
            mode_label = "חובה" if is_hard else "העדפה"
            variables.brain_info[brain_id] = {
                "name": f"{count} רצופות ({mode_label}) — {subj_name} ל{class_name or req.class_group_id}",
                "weight": 0 if is_hard else _CONSECUTIVE_SOFT_WEIGHT,
                "is_hard": is_hard,
            }
            brain_id -= 1
            has_any = True

    # ── Grouped subjects (clusters) ────────────────────────────────────
    for cluster in data.clusters:
        if not cluster.tracks:
            continue

        settings = _get_cluster_consecutive_settings(cluster, data)
        if not settings:
            continue
        count, mode = settings

        tracks_with_teacher = [t for t in cluster.tracks
                               if t.teacher_id is not None]
        if not tracks_with_teacher:
            continue
        rep_track = max(tracks_with_teacher, key=lambda t: t.hours_per_week)

        if rep_track.hours_per_week < 2:
            continue

        def _get_track_var(day, p, _tid=rep_track.id):
            return variables.x_track.get((_tid, day, p))

        is_hard = mode == "hard"
        added = _add_block_constraints(
            f"cl{cluster.id}_tr{rep_track.id}",
            rep_track.hours_per_week, count, is_hard, _get_track_var,
        )
        if added:
            subj_name = cluster.subject.name if cluster.subject else cluster.name
            mode_label = "חובה" if is_hard else "העדפה"
            variables.brain_info[brain_id] = {
                "name": f"{count} רצופות ({mode_label}) — {subj_name} ({cluster.name})",
                "weight": 0 if is_hard else _CONSECUTIVE_SOFT_WEIGHT,
                "is_hard": is_hard,
            }
            brain_id -= 1
            has_any = True

    if has_any:
        _update_brain_id(brain_id)


# ── Morning priority (SOFT) ─────────────────────────────────────────────

_MORNING_PRIORITY_BASE_WEIGHT = 80  # Base weight, scaled by priority value

def _apply_morning_priority(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Brain principle: subjects with morning_priority prefer earlier periods.

    Creates a soft penalty proportional to (period * priority), so subjects
    with higher priority are pushed to earlier slots. This creates a natural
    ranking: if subject A has priority 100 and subject B has priority 50,
    subject A will be placed earlier.
    """
    brain_id = _next_brain_id() - 1

    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue

        # Get priority: requirement override > subject default > skip
        priority = getattr(req, "morning_priority", None)
        if priority is None and req.subject:
            priority = getattr(req.subject, "morning_priority", None)
        if not priority or priority <= 0:
            continue

        # Weight scales with priority: priority=100 → weight=40, priority=50 → weight=20
        weight = max(1, (_MORNING_PRIORITY_BASE_WEIGHT * priority) // 100)

        # Penalty = sum of (period_number * x[var]) for each active lesson
        # Later periods → higher penalty → solver prefers earlier slots
        period_penalty_terms: list[tuple[cp_model.IntVar, int]] = []
        for day in data.days:
            max_p = data.max_period_per_day.get(day, 0)
            for p in range(1, max_p + 1):
                var = variables.x.get(
                    (req.class_group_id, req.subject_id, req.teacher_id, day, p)
                )
                if var is not None:
                    # period 1 → cost 0, period 2 → cost 1, ..., period 8 → cost 7
                    period_penalty_terms.append((var, p - 1))

        if not period_penalty_terms:
            continue

        # Total lateness = sum(var * period_cost)
        max_penalty = sum(cost for _, cost in period_penalty_terms)
        lateness = model.new_int_var(
            0, max_penalty,
            f"brain_morning_r{req.id}"
        )
        model.add(lateness == sum(var * cost for var, cost in period_penalty_terms))

        variables.penalties.append((lateness, weight, brain_id))

        subj_name = req.subject.name if req.subject else f"מקצוע {req.subject_id}"
        class_name = None
        for cg in data.class_groups:
            if cg.id == req.class_group_id:
                class_name = cg.name
                break
        label = f"{subj_name} ל{class_name or req.class_group_id}"
        variables.brain_info[brain_id] = {
            "name": f"העדפת בוקר — {label}",
            "weight": weight,
        }
        brain_id -= 1

    # ── Grouped subjects (clusters) ────────────────────────────────────
    for cluster in data.clusters:
        if not cluster.tracks:
            continue

        # Get subject's morning_priority directly from cluster relationship
        subject_obj = cluster.subject

        priority = getattr(subject_obj, "morning_priority", None) if subject_obj else None
        if not priority or priority <= 0:
            continue

        weight = max(1, (_MORNING_PRIORITY_BASE_WEIGHT * priority) // 100)

        # Use representative track (max hours, matching SYNC logic)
        tracks_with_teacher = [t for t in cluster.tracks if t.teacher_id is not None]
        if not tracks_with_teacher:
            continue
        rep_track = max(tracks_with_teacher, key=lambda t: t.hours_per_week)

        period_penalty_terms: list[tuple[cp_model.IntVar, int]] = []
        for day in data.days:
            max_p = data.max_period_per_day.get(day, 0)
            for p in range(1, max_p + 1):
                var = variables.x_track.get((rep_track.id, day, p))
                if var is not None:
                    period_penalty_terms.append((var, p - 1))

        if not period_penalty_terms:
            continue

        max_penalty = sum(cost for _, cost in period_penalty_terms)
        lateness = model.new_int_var(
            0, max_penalty,
            f"brain_morning_cluster{cluster.id}"
        )
        model.add(lateness == sum(var * cost for var, cost in period_penalty_terms))

        variables.penalties.append((lateness, weight, brain_id))

        subj_name = subject_obj.name if subject_obj else cluster.name
        variables.brain_info[brain_id] = {
            "name": f"העדפת בוקר — {subj_name} (הקבצה)",
            "weight": weight,
        }
        brain_id -= 1

    _update_brain_id(brain_id)


# ── Flexible meeting attendance ───────────────────────────────────────────

_FLEXIBLE_MEETING_WEIGHT = 50  # Moderate — prefer teachers attend, but don't force


def _apply_flexible_meeting_attendance(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Brain principle: non-mandatory meetings (e.g. מליאה) — prefer teacher attendance.

    For meetings with is_mandatory_attendance=False, the system constraint
    skips them in teacher no-overlap. This brain rule adds a SOFT penalty
    for each teacher who has a lesson/track at the same time as the meeting,
    encouraging (but not requiring) their attendance.
    """
    brain_id = _next_brain_id() - 1

    for meeting in data.meetings:
        if getattr(meeting, "is_mandatory_attendance", True):
            continue  # Mandatory meetings are handled by system constraint
        if not meeting.teachers:
            continue

        teacher_ids = {t.id for t in meeting.teachers}
        has_any_penalty = False

        for teacher_id in teacher_ids:
            for day, period in data.available_slots:
                mk = (meeting.id, day, period)
                meeting_var = variables.x_meeting.get(mk)
                if meeting_var is None:
                    continue

                # Collect all lesson/track vars for this teacher at this slot
                conflict_vars: list[cp_model.IntVar] = []

                for key, var in variables.x.items():
                    c_id, s_id, t_id, d, p = key
                    if t_id == teacher_id and d == day and p == period:
                        conflict_vars.append(var)

                for cluster in data.clusters:
                    for track in cluster.tracks:
                        if track.teacher_id == teacher_id:
                            tk = (track.id, day, period)
                            if tk in variables.x_track:
                                conflict_vars.append(variables.x_track[tk])

                if not conflict_vars:
                    continue

                # Penalize: if meeting is scheduled here AND teacher has a lesson
                # overlap = meeting_var + sum(conflict_vars) - 1 (if > 0, there's a conflict)
                for cv in conflict_vars:
                    overlap = model.new_bool_var(
                        f"brain_mtg_overlap_m{meeting.id}_t{teacher_id}_{day}_p{period}"
                    )
                    # overlap = 1 iff both meeting happens here AND teacher teaches here
                    model.add(overlap <= meeting_var)
                    model.add(overlap <= cv)
                    model.add(overlap >= meeting_var + cv - 1)
                    variables.penalties.append((overlap, _FLEXIBLE_MEETING_WEIGHT, brain_id))
                    has_any_penalty = True

        if has_any_penalty:
            variables.brain_info[brain_id] = {
                "name": f"נוכחות גמישה — {meeting.name}",
                "weight": _FLEXIBLE_MEETING_WEIGHT,
            }
            brain_id -= 1

    _update_brain_id(brain_id)


# ── Plenary preferred teacher attendance on teaching day ──────────────────

_PLENARY_PREFERRED_WEIGHT = 70  # High — strongly prefer preferred teachers present


def _apply_plenary_preferred_attendance(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Brain principle: plenary preferred teachers should teach on plenary day.

    For PLENARY meetings with is_mandatory_attendance=False, locked teachers
    are enforced by the system constraint. Non-locked (preferred) teachers
    should ideally teach on the same day as the plenary — the more present,
    the higher the score.
    """
    from app.models.meeting import MeetingType

    brain_id = _next_brain_id() - 1

    # Build teacher day vars (same structure as in model_builder)
    teacher_day_vars: dict[int, dict[str, list[cp_model.IntVar]]] = {}
    for key, var in variables.x.items():
        _c, _s, t_id, day, _p = key
        teacher_day_vars.setdefault(t_id, {}).setdefault(day, []).append(var)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in variables.x_track.items():
                    tk_id, day, _p = key
                    if tk_id == track.id:
                        teacher_day_vars.setdefault(track.teacher_id, {}).setdefault(day, []).append(var)

    for meeting in data.meetings:
        if meeting.meeting_type != MeetingType.PLENARY.value:
            continue
        if not meeting.teachers:
            continue

        locked_ids = set(getattr(meeting, "locked_teacher_ids", None) or [])
        # Only handle non-locked (preferred) teachers
        preferred_teachers = [t for t in meeting.teachers if t.id not in locked_ids]
        if not preferred_teachers:
            continue

        has_any_penalty = False

        for teacher in preferred_teachers:
            all_teacher_vars = teacher_day_vars.get(teacher.id, {})
            has_any_teaching = any(
                len(vars_list) > 0 for vars_list in all_teacher_vars.values()
            )
            if not has_any_teaching:
                continue  # Non-teaching staff — skip

            for day in data.days:
                # Collect meeting vars for this day
                day_meeting_vars: list[cp_model.IntVar] = []
                for key, var in variables.x_meeting.items():
                    m_id, d, _p = key
                    if m_id == meeting.id and d == day:
                        day_meeting_vars.append(var)

                if not day_meeting_vars:
                    continue

                lesson_vars = all_teacher_vars.get(day, [])
                if not lesson_vars:
                    # Teacher has no possible lessons on this day →
                    # if plenary is on this day, this teacher can't attend (penalty)
                    # meeting_on_day = 1 iff any meeting var on this day is 1
                    meeting_on_day = model.new_bool_var(
                        f"brain_plenary_m{meeting.id}_day_{day}_t{teacher.id}"
                    )
                    model.add_max_equality(meeting_on_day, day_meeting_vars)
                    variables.penalties.append(
                        (meeting_on_day, _PLENARY_PREFERRED_WEIGHT, brain_id)
                    )
                    has_any_penalty = True
                else:
                    # Teacher has possible lessons on this day.
                    # Penalize if plenary is here but teacher doesn't teach.
                    teacher_active = model.new_bool_var(
                        f"brain_plenary_t{teacher.id}_active_{day}_m{meeting.id}"
                    )
                    model.add_max_equality(teacher_active, lesson_vars)

                    # meeting_on_day
                    meeting_on_day = model.new_bool_var(
                        f"brain_plenary_m{meeting.id}_onday_{day}_t{teacher.id}"
                    )
                    model.add_max_equality(meeting_on_day, day_meeting_vars)

                    # penalty = meeting_on_day AND NOT teacher_active
                    penalty = model.new_bool_var(
                        f"brain_plenary_absent_t{teacher.id}_{day}_m{meeting.id}"
                    )
                    model.add(penalty <= meeting_on_day)
                    model.add(penalty <= teacher_active.negated())
                    model.add(penalty >= meeting_on_day + teacher_active.negated() - 1)
                    variables.penalties.append(
                        (penalty, _PLENARY_PREFERRED_WEIGHT, brain_id)
                    )
                    has_any_penalty = True

        if has_any_penalty:
            variables.brain_info[brain_id] = {
                "name": f"נוכחות מועדפת במליאה — {meeting.name}",
                "weight": _PLENARY_PREFERRED_WEIGHT,
            }
            brain_id -= 1

    _update_brain_id(brain_id)


# ── Preferred plenary teachers: avoid teaching during plenary timeslot ────

_PLENARY_NO_OVERLAP_PREFERRED_WEIGHT = 85  # High — strongly prefer attending plenary


def _apply_plenary_preferred_no_overlap(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Brain principle: preferred plenary teachers should NOT teach during plenary hours.

    Locked teachers have a HARD no-overlap constraint (in model_builder).
    Preferred (non-locked) teachers get this SOFT penalty: if the plenary is
    scheduled at a timeslot and a preferred teacher has a lesson there, penalize.
    This way the solver avoids scheduling their lessons during the plenary,
    but won't make the problem infeasible if it's the only option.
    """
    from app.models.meeting import MeetingType

    brain_id = _next_brain_id() - 1
    has_any_penalty = False

    for meeting in data.meetings:
        if meeting.meeting_type != MeetingType.PLENARY.value:
            continue
        if not meeting.teachers:
            continue

        locked_ids = set(getattr(meeting, "locked_teacher_ids", None) or [])
        # Preferred = in meeting but not locked
        preferred_teachers = [t for t in meeting.teachers if t.id not in locked_ids]
        if not preferred_teachers:
            continue

        for teacher in preferred_teachers:
            for day, period in data.available_slots:
                mk = (meeting.id, day, period)
                meeting_var = variables.x_meeting.get(mk)
                if meeting_var is None:
                    continue

                # Collect all lesson/track vars for this teacher at this slot
                lesson_vars: list[cp_model.IntVar] = []
                for key, var in variables.x.items():
                    c_id, s_id, t_id, d, p = key
                    if t_id == teacher.id and d == day and p == period:
                        lesson_vars.append(var)
                for cluster in data.clusters:
                    for track in cluster.tracks:
                        if track.teacher_id == teacher.id:
                            tk = (track.id, day, period)
                            if tk in variables.x_track:
                                lesson_vars.append(variables.x_track[tk])

                if not lesson_vars:
                    continue

                # teacher_teaches = 1 iff teacher has a lesson at this slot
                teacher_teaches = model.new_bool_var(
                    f"brain_plenary_overlap_t{teacher.id}_{day}_p{period}_m{meeting.id}"
                )
                model.add_max_equality(teacher_teaches, lesson_vars)

                # penalty = plenary_here AND teacher_teaches
                penalty = model.new_bool_var(
                    f"brain_plenary_conflict_t{teacher.id}_{day}_p{period}_m{meeting.id}"
                )
                model.add(penalty <= meeting_var)
                model.add(penalty <= teacher_teaches)
                model.add(penalty >= meeting_var + teacher_teaches - 1)
                variables.penalties.append(
                    (penalty, _PLENARY_NO_OVERLAP_PREFERRED_WEIGHT, brain_id)
                )
                has_any_penalty = True

    if has_any_penalty:
        variables.brain_info[brain_id] = {
            "name": "מורים מועדפים במליאה — הימנעות מלימוד בשעת מליאה",
            "weight": _PLENARY_NO_OVERLAP_PREFERRED_WEIGHT,
        }
        brain_id -= 1

    _update_brain_id(brain_id)


# ── Non-plenary teachers should teach during plenary hours ────────────────

# ── Homeroom daily class meeting ──────────────────────────────────────────

_HOMEROOM_DAILY_WEIGHT = 95  # Very high — top priority


def _apply_homeroom_daily_meeting(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Brain principle: homeroom teacher should teach their class every day.

    Per-class behavior:
    - homeroom_daily_required=True → HARD constraint (must teach every day at school)
    - homeroom_daily_required=False → SOFT constraint (preferred, weight 95)

    Excludes math/English הקבצות taught by other teachers (naturally excluded
    since we only look at lessons taught by the homeroom teacher herself).
    """
    if not data.homeroom_map:
        return

    # Build class_id -> class_name and class_id -> homeroom_daily_required
    class_name_map: dict[int, str] = {}
    class_required_map: dict[int, bool] = {}
    for cg in data.class_groups:
        class_name_map[cg.id] = cg.name
        class_required_map[cg.id] = getattr(cg, "homeroom_daily_required", False)

    # Build teacher_id -> set of days teacher has ANY presence (lessons, tracks, meetings)
    teacher_active_days: dict[int, dict[str, list[cp_model.IntVar]]] = {}
    for key, var in variables.x.items():
        _c, _s, t_id, day, _p = key
        teacher_active_days.setdefault(t_id, {}).setdefault(day, []).append(var)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in variables.x_track.items():
                    tk_id, day, _p = key
                    if tk_id == track.id:
                        teacher_active_days.setdefault(track.teacher_id, {}).setdefault(day, []).append(var)
    # Meetings count as presence — if teacher attends a meeting she's at school
    for key, var in variables.x_meeting.items():
        m_id, day, _p = key
        meeting = next((m for m in data.meetings if m.id == m_id), None)
        if meeting is None or not meeting.teachers:
            continue
        for teacher in meeting.teachers:
            if teacher.id in data.homeroom_map:
                teacher_active_days.setdefault(teacher.id, {}).setdefault(day, []).append(var)

    brain_id = _next_brain_id() - 1
    has_any_penalty = False

    # כינוס lessons don't count as "meeting the class"
    kinoos_subject_ids: set[int] = {
        s.id for s in data.all_subjects if s.name and "כינוס" in s.name
    }

    for teacher_id, class_id in data.homeroom_map.items():
        is_required = class_required_map.get(class_id, False)
        class_name = class_name_map.get(class_id, str(class_id))

        # Find lessons where this teacher teaches this class (excluding כינוס)
        relevant_keys: dict[str, list[cp_model.IntVar]] = {}
        for key, var in variables.x.items():
            c_id, s_id, t_id, day, _p = key
            if c_id == class_id and t_id == teacher_id and s_id not in kinoos_subject_ids:
                relevant_keys.setdefault(day, []).append(var)

        # Also check tracks that serve this class
        for cluster in data.clusters:
            for track in cluster.tracks:
                if track.teacher_id != teacher_id:
                    continue
                serves_class = False
                if track.source_class_id == class_id:
                    serves_class = True
                elif not track.source_class_id:
                    source_ids = [c.id for c in cluster.source_classes]
                    if class_id in source_ids:
                        serves_class = True
                if serves_class:
                    for key, var in variables.x_track.items():
                        tk_id, day, _p = key
                        if tk_id == track.id:
                            relevant_keys.setdefault(day, []).append(var)

        if not relevant_keys:
            continue

        for day in data.days:
            day_vars = relevant_keys.get(day, [])
            if not day_vars:
                continue

            teaches_class = model.new_bool_var(
                f"brain_homeroom_t{teacher_id}_c{class_id}_{day}"
            )
            model.add_max_equality(teaches_class, day_vars)

            if is_required:
                # HARD: if teacher is at school this day, she must teach her class
                all_teacher_day_vars = teacher_active_days.get(teacher_id, {}).get(day, [])
                if all_teacher_day_vars:
                    teacher_at_school = model.new_bool_var(
                        f"brain_homeroom_atschool_t{teacher_id}_{day}"
                    )
                    model.add_max_equality(teacher_at_school, all_teacher_day_vars)
                    # If at school → must teach homeroom class
                    model.add(teaches_class >= teacher_at_school)
            else:
                # SOFT: penalize missing
                penalty_idx = len(variables.penalties)
                variables.penalties.append(
                    (teaches_class.negated(), _HOMEROOM_DAILY_WEIGHT, brain_id)
                )
                variables.penalty_labels[penalty_idx] = class_name
                has_any_penalty = True

    if has_any_penalty:
        variables.brain_info[brain_id] = {
            "name": "מחנכת פוגשת כיתה כל יום",
            "weight": _HOMEROOM_DAILY_WEIGHT,
        }
        brain_id -= 1

    _update_brain_id(brain_id)


# ── Max consecutive meeting hours without frontal lesson ──────────────────


def _apply_max_consecutive_meetings(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """HARD: a teacher cannot have more than N consecutive meeting periods
    without at least one frontal lesson breaking the run.

    Configurable via school.max_consecutive_meetings (default 4, 0 = disabled).
    """
    max_consec = getattr(data.school, "max_consecutive_meetings", 4)
    if not max_consec or max_consec <= 0:
        return

    # Build teacher -> meeting_ids
    teacher_meeting_ids: dict[int, set[int]] = {}
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_meeting_ids.setdefault(t.id, set()).add(meeting.id)

    # Collect all teacher IDs that participate in meetings
    if not teacher_meeting_ids:
        return

    # Build teacher -> track_ids
    teacher_track_ids: dict[int, set[int]] = {}
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teacher_track_ids.setdefault(track.teacher_id, set()).add(track.id)

    for teacher_id, m_ids in teacher_meeting_ids.items():
        my_track_ids = teacher_track_ids.get(teacher_id, set())

        for day in data.days:
            # Get sorted periods available on this day
            day_periods = sorted(
                p for d, p in data.available_slots if d == day
            )
            if len(day_periods) <= max_consec:
                continue  # Not enough periods to violate

            # For each window of (max_consec + 1) consecutive periods,
            # at least one must have a frontal lesson (not just meetings).
            for i in range(len(day_periods) - max_consec):
                window = day_periods[i: i + max_consec + 1]

                # Check if all periods in window are truly consecutive
                if window[-1] - window[0] != max_consec:
                    continue  # Not consecutive periods

                # Collect frontal lesson vars for this teacher in this window
                frontal_vars: list[cp_model.IntVar] = []

                for p in window:
                    for key, var in variables.x.items():
                        _c, _s, t_id, d, period = key
                        if t_id == teacher_id and d == day and period == p:
                            frontal_vars.append(var)

                    for tk_id in my_track_ids:
                        tk = (tk_id, day, p)
                        if tk in variables.x_track:
                            frontal_vars.append(variables.x_track[tk])

                if not frontal_vars:
                    continue  # No possible frontal lessons in window

                # Collect meeting vars for this window
                meeting_vars: list[cp_model.IntVar] = []
                for p in window:
                    for m_id in m_ids:
                        mk = (m_id, day, p)
                        if mk in variables.x_meeting:
                            meeting_vars.append(variables.x_meeting[mk])

                if not meeting_vars:
                    continue

                # If all periods in window have meetings, at least one must
                # also have a frontal lesson.
                # Equivalent: sum(meetings) == len(window) → sum(frontal) >= 1
                # But since a teacher can only do one thing per slot, meetings
                # filling ALL slots means no frontal. So we just enforce:
                # sum(meetings in window) <= max_consec
                # (at most max_consec meeting slots in any window of max_consec+1)
                model.add(sum(meeting_vars) <= max_consec)


_NON_PLENARY_TEACH_WEIGHT = 80  # High — strongly prefer filling plenary slots


def _apply_non_plenary_teachers_teach_during_plenary(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """Brain principle: teachers NOT in the plenary should teach during plenary hours.

    When a teacher is not part of the plenary meeting at all, we prefer they
    have lessons during the plenary timeslot so those hours aren't wasted.
    """
    from app.models.meeting import MeetingType

    plenary_meetings = [
        m for m in data.meetings
        if m.meeting_type == MeetingType.PLENARY.value and m.teachers
    ]
    if not plenary_meetings:
        return

    brain_id = _next_brain_id() - 1

    # Collect all plenary teacher IDs
    plenary_teacher_ids: set[int] = set()
    for pm in plenary_meetings:
        plenary_teacher_ids.update(t.id for t in pm.teachers)

    # Collect all teaching teacher IDs
    teaching_teacher_ids: set[int] = set()
    for req in data.requirements:
        if req.teacher_id is not None and not req.is_grouped:
            teaching_teacher_ids.add(req.teacher_id)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teaching_teacher_ids.add(track.teacher_id)

    # Non-plenary teachers who have teaching assignments
    non_plenary = teaching_teacher_ids - plenary_teacher_ids
    if not non_plenary:
        return

    has_any_penalty = False

    for teacher_id in non_plenary:
        for pm in plenary_meetings:
            for day, period in data.available_slots:
                mk = (pm.id, day, period)
                meeting_var = variables.x_meeting.get(mk)
                if meeting_var is None:
                    continue

                # Collect all lesson/track vars for this teacher at this slot
                lesson_vars: list[cp_model.IntVar] = []
                for key, var in variables.x.items():
                    c_id, s_id, t_id, d, p = key
                    if t_id == teacher_id and d == day and p == period:
                        lesson_vars.append(var)
                for cluster in data.clusters:
                    for track in cluster.tracks:
                        if track.teacher_id == teacher_id:
                            tk = (track.id, day, period)
                            if tk in variables.x_track:
                                lesson_vars.append(variables.x_track[tk])

                if not lesson_vars:
                    continue

                # Penalize: if plenary is here AND teacher has NO lesson
                teacher_teaches = model.new_bool_var(
                    f"brain_nonplenary_t{teacher_id}_teaches_{day}_p{period}"
                )
                model.add_max_equality(teacher_teaches, lesson_vars)

                # penalty = plenary_here AND NOT teaches
                penalty = model.new_bool_var(
                    f"brain_nonplenary_idle_t{teacher_id}_{day}_p{period}"
                )
                model.add(penalty <= meeting_var)
                model.add(penalty <= teacher_teaches.negated())
                model.add(penalty >= meeting_var + teacher_teaches.negated() - 1)
                variables.penalties.append((penalty, _NON_PLENARY_TEACH_WEIGHT, brain_id))
                has_any_penalty = True

    if has_any_penalty:
        variables.brain_info[brain_id] = {
            "name": "מורים שלא במליאה — ילמדו בשעות המליאה",
            "weight": _NON_PLENARY_TEACH_WEIGHT,
        }
        brain_id -= 1

    _update_brain_id(brain_id)


# ── Oz LaTmura helpers ───────────────────────────────────────────────────


def _compute_teacher_frontal(data: SolverData) -> dict[int, int]:
    """Compute frontal (teaching) hours per teacher. Meetings are NOT frontal.

    Includes co-teachers: a co-teacher shares the same lesson hours
    as the primary teacher and should be counted for brain rules.
    """
    teacher_frontal: dict[int, int] = defaultdict(int)
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        teacher_frontal[req.teacher_id] += req.hours_per_week
        # Co-teachers teach the same hours as the primary teacher
        for co_tid in (req.co_teacher_ids or []):
            teacher_frontal[co_tid] += req.hours_per_week
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teacher_frontal[track.teacher_id] += track.hours_per_week
    return teacher_frontal


# ── Teacher gap minimization ──────────────────────────────────────────────

_TEACHER_GAP_WEIGHT = 60  # Strong preference — gaps waste teacher time


def _build_teacher_gap_indicators(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> dict[int, dict[str, list[cp_model.IntVar]]]:
    """Build gap indicator bool vars per teacher per day.

    Returns {teacher_id: {day: [gap_bool_var, ...]}}

    A gap is a period between first and last occupied slot where teacher
    has no lesson/track/meeting.
    """
    # Build co-teacher mapping
    co_teacher_map: dict[tuple[int, int, int], list[int]] = {}
    for req in data.requirements:
        if req.co_teacher_ids and req.teacher_id is not None and not req.is_grouped:
            co_teacher_map[(req.class_group_id, req.subject_id, req.teacher_id)] = (
                req.co_teacher_ids
            )

    # Build teacher -> list of (day, period, var) for all lessons + tracks + co-teaching
    teacher_vars: dict[int, list[tuple[str, int, cp_model.IntVar]]] = defaultdict(list)

    for key, var in variables.x.items():
        c_id, s_id, t_id, day, period = key
        teacher_vars[t_id].append((day, period, var))
        # Co-teachers share the same slot
        for co_tid in co_teacher_map.get((c_id, s_id, t_id), []):
            teacher_vars[co_tid].append((day, period, var))

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in variables.x_track.items():
                    tk_id, day, period = key
                    if tk_id == track.id:
                        teacher_vars[track.teacher_id].append((day, period, var))

    # Also include meeting vars
    for meeting in data.meetings:
        if not meeting.teachers:
            continue
        for teacher in meeting.teachers:
            for key, var in variables.x_meeting.items():
                m_id, day, period = key
                if m_id == meeting.id:
                    teacher_vars[teacher.id].append((day, period, var))

    result: dict[int, dict[str, list[cp_model.IntVar]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for t_id, all_vars in teacher_vars.items():
        # Group by day
        by_day: dict[str, dict[int, list[cp_model.IntVar]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for day, period, var in all_vars:
            by_day[day][period].append(var)

        for day, period_vars_map in by_day.items():
            sorted_periods = sorted(period_vars_map.keys())
            if len(sorted_periods) < 2:
                continue

            # active[p] = 1 iff teacher has any lesson at period p
            active_vars: dict[int, cp_model.IntVar] = {}
            for p in sorted_periods:
                vars_at_p = period_vars_map[p]
                if len(vars_at_p) == 1:
                    active_vars[p] = vars_at_p[0]
                else:
                    active = model.new_bool_var(f"brain_tgap_act_t{t_id}_{day}_p{p}")
                    model.add_max_equality(active, vars_at_p)
                    active_vars[p] = active

            # Detect gaps using cumulative OR (forward + backward pass)
            n = len(sorted_periods)

            # Forward pass: any_before[i] = OR(active[p_0]..active[p_{i-1}])
            any_before: list[cp_model.IntVar | None] = [None] * n
            for i in range(n):
                if i == 0:
                    any_before[i] = None
                elif i == 1:
                    any_before[i] = active_vars[sorted_periods[0]]
                else:
                    ab = model.new_bool_var(
                        f"brain_tgap_ab_t{t_id}_{day}_i{i}"
                    )
                    model.add_max_equality(
                        ab,
                        [any_before[i - 1], active_vars[sorted_periods[i - 1]]],
                    )
                    any_before[i] = ab

            # Backward pass: any_after[i] = OR(active[p_{i+1}]..active[p_{n-1}])
            any_after: list[cp_model.IntVar | None] = [None] * n
            for i in range(n - 1, -1, -1):
                if i == n - 1:
                    any_after[i] = None
                elif i == n - 2:
                    any_after[i] = active_vars[sorted_periods[n - 1]]
                else:
                    aa = model.new_bool_var(
                        f"brain_tgap_aa_t{t_id}_{day}_i{i}"
                    )
                    model.add_max_equality(
                        aa,
                        [any_after[i + 1], active_vars[sorted_periods[i + 1]]],
                    )
                    any_after[i] = aa

            # Gap at interior period p: before exists AND after exists AND p inactive
            for i in range(1, n - 1):
                p = sorted_periods[i]
                ab = any_before[i]
                aa = any_after[i]
                if ab is None or aa is None:
                    continue

                gap = model.new_bool_var(f"brain_tgap_t{t_id}_{day}_p{p}")
                model.add(gap <= ab)
                model.add(gap <= aa)
                model.add(gap <= 1 - active_vars[p])
                model.add(gap >= ab + aa - active_vars[p] - 1)

                result[t_id][day].append(gap)

    return result


def _apply_teacher_gap_minimization(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    gap_indicators: dict[int, dict[str, list[cp_model.IntVar]]],
) -> None:
    """Brain principle: minimize gaps (free periods between lessons) for teachers.

    Uses pre-built gap indicators to add SOFT penalties.
    """
    brain_id = _next_brain_id() - 1

    has_any_penalty = False

    for t_id, days_gaps in gap_indicators.items():
        for day, gap_vars in days_gaps.items():
            for gap in gap_vars:
                variables.penalties.append((gap, _TEACHER_GAP_WEIGHT, brain_id))
                has_any_penalty = True

    if has_any_penalty:
        variables.brain_info[brain_id] = {
            "name": "צמצום חלונות מורים",
            "weight": _TEACHER_GAP_WEIGHT,
        }
        _update_brain_id(brain_id)


# ── Oz LaTmura gap limit (HARD) ──────────────────────────────────────────


def _apply_oz_la_tmura(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    gap_indicators: dict[int, dict[str, list[cp_model.IntVar]]],
    teacher_frontal: dict[int, int],
) -> None:
    """HARD: enforce Oz LaTmura (עוז לתמורה) weekly gap limit per teacher.

    Based on frontal teaching hours F:
    - פרטני = round(0.12 * F) — placed post-solve, fills gaps
    - שהייה = round(0.4 * F) — meetings count toward this (implicit)
    - allowed_gaps (pure) = F // 8

    Gap indicators count ALL empty slots between first/last lesson.
    The effective limit allows for pratni hours that will fill some gaps
    post-solve: sum(gaps) <= allowed_gaps + pratni_count.
    """
    brain_id = _next_brain_id() - 1

    # Count meeting hours per teacher (meetings = שהייה)
    teacher_meeting_hours: dict[int, int] = defaultdict(int)
    for meeting in data.meetings:
        if not meeting.teachers:
            continue
        hours = getattr(meeting, "hours_per_week", 1)
        for teacher in meeting.teachers:
            teacher_meeting_hours[teacher.id] += hours

    has_any = False
    breakdown: list[dict] = []

    for t_id, frontal in teacher_frontal.items():
        if frontal <= 0:
            continue

        pure_gaps = frontal // 8
        individual = round(0.12 * frontal)
        staying = round(0.4 * frontal)
        # Effective limit: pure gaps + pratni (pratni fills gaps post-solve)
        allowed_gaps = pure_gaps + individual
        meeting_hours = teacher_meeting_hours.get(t_id, 0)

        # Collect all gap vars for this teacher across all days
        all_gap_vars: list[cp_model.IntVar] = []
        if t_id in gap_indicators:
            for day, gap_vars in gap_indicators[t_id].items():
                all_gap_vars.extend(gap_vars)

        if all_gap_vars:
            model.add(sum(all_gap_vars) <= allowed_gaps)

        # Find teacher name from requirements or tracks
        teacher_name = f"מורה {t_id}"
        for req in data.requirements:
            if req.teacher_id == t_id and hasattr(req, "teacher") and req.teacher:
                teacher_name = req.teacher.name
                break
        else:
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id == t_id and hasattr(track, "teacher") and track.teacher:
                        teacher_name = track.teacher.name
                        break

        breakdown.append({
            "teacher_id": t_id,
            "teacher_name": teacher_name,
            "frontal_hours": frontal,
            "individual_hours": individual,
            "staying_hours": staying,
            "meeting_hours_as_staying": meeting_hours,
            "allowed_gaps": allowed_gaps,
        })
        has_any = True

    if has_any:
        variables.brain_info[brain_id] = {
            "name": "כללי עוז לתמורה",
            "weight": 0,  # HARD constraint — no soft penalty weight
            "is_hard": True,
            "breakdown": breakdown,
        }
        _update_brain_id(brain_id)


# ── Max teaching days by rubrica (general) hours (HARD) ──────────────────

def _max_days_for_rubrica(rubrica: float) -> int | None:
    """Return max teaching days allowed for given rubrica (general) hours.

    Based on עוז לתמורה:
    - Below 20 rubrica hours → max 2 days
    - 20–27 rubrica hours → max 3 days
    - Above 27 rubrica hours → max 4 days
    """
    if rubrica > 27:
        return 4
    if rubrica >= 20:
        return 3
    if rubrica > 0:
        return 2
    return None  # rubrica not set


# Keep legacy helper for external callers (e.g. diagnosis)
_FRONTAL_TO_MAX_DAYS: list[tuple[int, int, int]] = [
    (1, 11, 2),
    (12, 16, 3),
    (17, 18, 4),
    (19, 999, 5),
]


def _max_days_for_frontal(frontal: int) -> int:
    """Legacy helper — kept for diagnosis code."""
    for low, high, max_days in _FRONTAL_TO_MAX_DAYS:
        if low <= frontal <= high:
            return max_days
    return 5


def _apply_max_days_by_frontal(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    teacher_frontal: dict[int, int],
) -> None:
    """HARD: limit teaching days based on עוז לתמורה table.

    Combined table (rubrica-first, frontal fallback):
    1. If teacher has rubrica hours defined:
       - rubrica < 20 → max 2 work days
       - rubrica 20–27 → max 3 work days
       - rubrica > 27 → max 4 work days
       - Override: 16+ frontal hours → allow at least 4 days
    2. Fallback (no rubrica defined):
       - < 12 frontal hours AND total estimated employment < 20 → max 2 days
    3. MIN_FREE_DAYS always prevails (caps max_days further)

    Counts days with teaching (lessons/tracks) AND mandatory meeting attendance.
    A teacher attending a mandatory plenary on Sunday counts Sunday as a work day.
    """
    LOW_FRONTAL_THRESHOLD = 12
    LOW_EMPLOYMENT_THRESHOLD = 20
    LOW_MAX_DAYS = 2

    brain_id = _next_brain_id() - 1

    # Build co-teacher mapping: primary teacher key → co-teacher IDs
    co_teacher_map: dict[tuple[int, int, int], list[int]] = {}
    for req in data.requirements:
        if req.co_teacher_ids and req.teacher_id is not None and not req.is_grouped:
            co_teacher_map[(req.class_group_id, req.subject_id, req.teacher_id)] = (
                req.co_teacher_ids
            )

    # Build teacher vars by day (lessons + tracks + co-teaching)
    teacher_day_vars: dict[int, dict[str, list[cp_model.IntVar]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for key, var in variables.x.items():
        c_id, s_id, t_id, day, _p = key
        teacher_day_vars[t_id][day].append(var)
        # Co-teachers occupy the same slot as primary teacher
        for co_tid in co_teacher_map.get((c_id, s_id, t_id), []):
            teacher_day_vars[co_tid][day].append(var)

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in variables.x_track.items():
                    tk_id, day, _p = key
                    if tk_id == track.id:
                        teacher_day_vars[track.teacher_id][day].append(var)

    # Include ALL meeting variables for ALL teachers.
    # Meetings = presence at school → count as work days for ALL limit types.
    # Previously only pinned mandatory meetings were included for automatic
    # limits, which caused infeasibility when model_builder required teachers
    # to teach on meeting days but the work-day limit didn't account for them.
    for key, var in variables.x_meeting.items():
        m_id, day, _p = key
        meeting = next((m for m in data.meetings if m.id == m_id), None)
        if meeting is None or not meeting.teachers:
            continue
        for teacher in meeting.teachers:
            teacher_day_vars[teacher.id][day].append(var)

    breakdown: list[dict] = []

    total_days = len(data.days)

    for t_id, frontal in teacher_frontal.items():
        if frontal <= 0:
            continue

        max_days: int | None = None
        source = ""
        rubrica = data.teacher_rubrica_map.get(t_id)

        # 0. Manual override — teacher has explicit max_work_days set
        manual = data.teacher_max_work_days.get(t_id)
        if manual is not None and manual > 0:
            max_days = manual
            source = "ידני"
        else:
            # 1. Try rubrica-based limit (rubrica = total employment hours)
            if rubrica is not None and rubrica > 0:
                max_days = _max_days_for_rubrica(rubrica)
                if max_days is not None:
                    source = f"rubrica={rubrica}"
                    # Override: 16+ frontal hours → allow 4 days regardless of rubrica
                    if frontal > 16 and max_days < 4:
                        max_days = 4

            # 2. Fallback (no rubrica): low frontal hours → 2 days
            if max_days is None and frontal < LOW_FRONTAL_THRESHOLD:
                max_days = LOW_MAX_DAYS
                source = f"frontal<{LOW_FRONTAL_THRESHOLD}"

        if max_days is None:
            continue  # No rule applies

        # 3. Free day always prevails: if teacher has MIN_FREE_DAYS, cap max_days
        min_free = data.min_free_days_map.get(t_id, 0)
        if min_free > 0:
            max_days = min(max_days, total_days - min_free)

        by_day = dict(teacher_day_vars.get(t_id, {}))
        # Meetings are already included in teacher_day_vars for ALL sources.

        day_active: list[cp_model.IntVar] = []
        for day, day_vars in by_day.items():
            if not day_vars:
                continue
            b = model.new_bool_var(f"brain_maxdays_t{t_id}_{day}")
            model.add(sum(day_vars) >= 1).only_enforce_if(b)
            model.add(sum(day_vars) == 0).only_enforce_if(b.negated())
            day_active.append(b)

        if day_active:
            model.add(sum(day_active) <= max_days)

        # Find teacher name
        teacher_name = f"מורה {t_id}"
        for req in data.requirements:
            if req.teacher_id == t_id and hasattr(req, "teacher") and req.teacher:
                teacher_name = req.teacher.name
                break
        else:
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id == t_id and hasattr(track, "teacher") and track.teacher:
                        teacher_name = track.teacher.name
                        break

        breakdown.append({
            "teacher_id": t_id,
            "teacher_name": teacher_name,
            "frontal_hours": frontal,
            "rubrica_hours": rubrica,
            "max_days": max_days,
            "source": source,
        })

    if breakdown:
        variables.brain_info[brain_id] = {
            "name": "ימי עבודה מקסימליים לפי עוז לתמורה",
            "weight": 0,
            "is_hard": True,
            "breakdown": breakdown,
        }
        _update_brain_id(brain_id)


# ── Max consecutive frontal hours per day (HARD) ────────────────────────

_MAX_CONSECUTIVE_FRONTAL = 6  # No more than 6 consecutive frontal teaching hours


def _apply_max_consecutive_frontal(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """HARD: a teacher cannot have more than 6 consecutive frontal hours in a day.

    Only frontal teaching (lessons + tracks) counts. Meetings, individual
    sessions (פרטני), and gaps all break the consecutive streak.

    Implementation: for every window of 7 consecutive periods on a given day,
    at most 6 can be frontal teaching for the same teacher.
    """
    brain_id = _next_brain_id() - 1
    window = _MAX_CONSECUTIVE_FRONTAL + 1  # 7 — if all 7 are frontal, that's a violation

    # Build teacher -> day -> {period: [frontal vars]} (lessons + tracks only)
    teacher_day_period: dict[int, dict[str, dict[int, list[cp_model.IntVar]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )

    for key, var in variables.x.items():
        _c, _s, t_id, day, period = key
        teacher_day_period[t_id][day][period].append(var)

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in variables.x_track.items():
                    tk_id, day, period = key
                    if tk_id == track.id:
                        teacher_day_period[track.teacher_id][day][period].append(var)

    has_any = False

    for t_id, days_map in teacher_day_period.items():
        for day, period_vars_map in days_map.items():
            sorted_periods = sorted(period_vars_map.keys())
            if len(sorted_periods) < window:
                continue

            # For each window of `window` consecutive periods
            for i in range(len(sorted_periods) - window + 1):
                win_periods = sorted_periods[i : i + window]
                # Only apply if periods are truly consecutive (no structural gaps)
                if win_periods[-1] - win_periods[0] != window - 1:
                    continue

                win_vars: list[cp_model.IntVar] = []
                for p in win_periods:
                    pvars = period_vars_map[p]
                    if len(pvars) == 1:
                        win_vars.append(pvars[0])
                    else:
                        # Teacher may have multiple lessons at same period (shouldn't happen
                        # due to no-overlap, but use max for safety)
                        active = model.new_bool_var(
                            f"brain_consfront_act_t{t_id}_{day}_p{p}"
                        )
                        model.add_max_equality(active, pvars)
                        win_vars.append(active)

                model.add(sum(win_vars) <= _MAX_CONSECUTIVE_FRONTAL)
                has_any = True

    if has_any:
        variables.brain_info[brain_id] = {
            "name": "מקסימום 6 שעות פרונטליות רצופות ליום",
            "weight": 0,
            "is_hard": True,
        }
        _update_brain_id(brain_id)


# ── Management team free day (HARD) ─────────────────────────────────────

def _apply_management_free_day(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """HARD: every management team member gets at least 1 free day per week.

    Management = is_management | is_principal | is_director | is_pedagogical_coordinator.
    A "work day" counts lessons, tracks, AND meetings.
    If the teacher already has a tighter limit (e.g., max_work_days=3 on a 5-day week),
    this constraint is redundant but harmless.
    """
    if not data.management_teacher_ids:
        return

    brain_id = _next_brain_id() - 1
    total_days = len(data.days)
    max_days = total_days - 1  # At least 1 free day

    # Build teacher -> day -> [vars] for lessons + tracks + meetings
    teacher_day_vars: dict[int, dict[str, list[cp_model.IntVar]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for key, var in variables.x.items():
        _c, _s, t_id, day, _p = key
        if t_id in data.management_teacher_ids:
            teacher_day_vars[t_id][day].append(var)

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id in data.management_teacher_ids:
                for key, var in variables.x_track.items():
                    tk_id, day, _p = key
                    if tk_id == track.id:
                        teacher_day_vars[track.teacher_id][day].append(var)

    # Include meetings — management attending a meeting counts as presence
    for key, var in variables.x_meeting.items():
        m_id, day, _p = key
        meeting = next((m for m in data.meetings if m.id == m_id), None)
        if meeting is None or not meeting.teachers:
            continue
        for teacher in meeting.teachers:
            if teacher.id in data.management_teacher_ids:
                teacher_day_vars[teacher.id][day].append(var)

    breakdown: list[dict] = []

    for t_id in data.management_teacher_ids:
        by_day = teacher_day_vars.get(t_id, {})
        if not by_day:
            continue

        day_active: list[cp_model.IntVar] = []
        for day, day_vars in by_day.items():
            if not day_vars:
                continue
            b = model.new_bool_var(f"brain_mgmt_freeday_t{t_id}_{day}")
            model.add(sum(day_vars) >= 1).only_enforce_if(b)
            model.add(sum(day_vars) == 0).only_enforce_if(b.negated())
            day_active.append(b)

        if day_active:
            model.add(sum(day_active) <= max_days)

        # Find teacher name
        teacher_name = f"מורה {t_id}"
        for req in data.requirements:
            if req.teacher_id == t_id and hasattr(req, "teacher") and req.teacher:
                teacher_name = req.teacher.name
                break
        else:
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id == t_id and hasattr(track, "teacher") and track.teacher:
                        teacher_name = track.teacher.name
                        break

        breakdown.append({
            "teacher_id": t_id,
            "teacher_name": teacher_name,
            "max_days": max_days,
        })

    if breakdown:
        variables.brain_info[brain_id] = {
            "name": "יום חופשי לצוות ניהול",
            "weight": 0,
            "is_hard": True,
            "breakdown": breakdown,
        }
        _update_brain_id(brain_id)


# ── Transport teachers: prefer early finish (SOFT) ──────────────────────

def _apply_transport_early_finish(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
) -> None:
    """SOFT: teachers with transport_priority should finish as early as possible.

    The transport_priority value (1-100) is used as the constraint weight.
    Penalizes lessons at later periods with increasing penalty:
    Period 5→2, period 6→4, period 7→6, period 8→8.
    """
    if not data.transport_priorities:
        return

    brain_id = _next_brain_id() - 1

    def _period_penalty(p: int) -> int:
        if p <= 4:
            return 0
        return (p - 4) * 2

    has_any = False

    for key, var in variables.x.items():
        _c, _s, t_id, _day, period = key
        weight = data.transport_priorities.get(t_id)
        if weight is None:
            continue
        pen = _period_penalty(period)
        if pen <= 0:
            continue
        weighted = model.new_int_var(
            0, pen, f"brain_transport_t{t_id}_{_day}_p{period}"
        )
        model.add(weighted == pen * var)
        variables.penalties.append((weighted, weight, brain_id))
        has_any = True

    for cluster in data.clusters:
        for track in cluster.tracks:
            weight = data.transport_priorities.get(track.teacher_id)
            if weight is None:
                continue
            for key, var in variables.x_track.items():
                tk_id, _day, period = key
                if tk_id != track.id:
                    continue
                pen = _period_penalty(period)
                if pen <= 0:
                    continue
                weighted = model.new_int_var(
                    0, pen, f"brain_transport_tk{tk_id}_{_day}_p{period}"
                )
                model.add(weighted == pen * var)
                variables.penalties.append((weighted, weight, brain_id))
                has_any = True

    if has_any:
        variables.brain_info[brain_id] = {
            "name": "עדיפות יום מוקדם למורים",
            "weight": 0,  # Per-teacher weight used directly
        }
        _update_brain_id(brain_id)
