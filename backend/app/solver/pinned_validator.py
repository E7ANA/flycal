"""Shared pinned-slot conflict detection utilities.

Used by both engine.py (pre-solve validation) and api/solver.py (overlap detection UI).
"""

from __future__ import annotations

from app.solver.model_builder import SolverData, _normalize_pair


# Type alias for pinned entries: (day, period, item_type, item_id, source_label)
PinnedEntry = tuple[str, int, str, int, str]


_DAY_HEBREW = {
    "SUNDAY": "יום ראשון",
    "MONDAY": "יום שני",
    "TUESDAY": "יום שלישי",
    "WEDNESDAY": "יום רביעי",
    "THURSDAY": "יום חמישי",
    "FRIDAY": "יום שישי",
}


def day_he(day: str) -> str:
    """Translate a day enum string to Hebrew."""
    return _DAY_HEBREW.get(day, day)


def build_teacher_name_map(data: SolverData) -> dict[int, str]:
    """Build a teacher_id -> teacher_name mapping from solver data."""
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
            if t.id not in teacher_name_map:
                teacher_name_map[t.id] = getattr(t, "name", f"#{t.id}")
    return teacher_name_map


def collect_pinned_from_requirements(
    data: SolverData,
) -> dict[int, list[PinnedEntry]]:
    """Collect pinned slots from non-grouped requirements.

    Returns: teacher_id -> list of (day, period, "requirement", req_id, source_label).
    """
    teacher_pinned: dict[int, list[PinnedEntry]] = {}

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

    return teacher_pinned


def collect_pinned_from_clusters(
    data: SolverData,
) -> dict[int, list[PinnedEntry]]:
    """Collect pinned slots from cluster tracks (with sync dedup).

    Returns: teacher_id -> list of (day, period, "track", track_id, source_label).
    """
    teacher_pinned: dict[int, list[PinnedEntry]] = {}

    # First pass: collect unique pinned slots per cluster
    cluster_pinned: dict[int, set[tuple[str, int]]] = {}
    for cluster in data.clusters:
        slots_set: set[tuple[str, int]] = set()
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
                    slots_set.add((day, period))
        if slots_set:
            cluster_pinned[cluster.id] = slots_set

    # Second pass: register each teacher ONCE per slot per cluster
    for cluster in data.clusters:
        inherited_slots = cluster_pinned.get(cluster.id, set())
        if not inherited_slots:
            continue

        seen: set[tuple[int, str, int]] = set()
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            source = f"רצועה '{track.name}' באשכול '{cluster.name}' (סנכרון)"
            for day, period in inherited_slots:
                key = (track.teacher_id, day, period)
                if key in seen:
                    continue
                seen.add(key)
                teacher_pinned.setdefault(track.teacher_id, []).append(
                    (day, period, "track", track.id, source)
                )

    return teacher_pinned


def collect_pinned_from_meetings_for_engine(
    data: SolverData,
) -> dict[int, list[PinnedEntry]]:
    """Collect pinned slots from meetings with engine-style filtering.

    Applies non-mandatory meeting logic: skips excused teachers, non-locked
    teachers, and locked teachers blocked at any of the meeting's pinned slots.

    Returns: teacher_id -> list of (day, period, "meeting", meeting_id, source_label).
    """
    teacher_pinned: dict[int, list[PinnedEntry]] = {}

    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        if not pinned:
            continue
        is_mandatory = getattr(meeting, "is_mandatory_attendance", True)
        locked_ids: set[int] = set(getattr(meeting, "locked_teacher_ids", None) or [])

        # For non-mandatory meetings, build set of pinned (day,period) to check blocks
        pinned_slot_set: set[tuple[str, int]] = set()
        if not is_mandatory:
            for slot in pinned:
                d = slot.get("day")
                p = slot.get("period")
                if d and p:
                    pinned_slot_set.add((d, p))

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
                    # Non-mandatory meeting: preferred teachers simply won't attend.
                    if not is_mandatory and t.id not in locked_ids:
                        continue
                    # Non-mandatory meeting: even locked teachers are excused if
                    # they're blocked at ANY of the meeting's pinned slots.
                    if not is_mandatory and t.id in locked_ids:
                        teacher_blocked = data.teacher_blocked_slots.get(t.id, set())
                        if teacher_blocked & pinned_slot_set:
                            continue
                    teacher_pinned.setdefault(t.id, []).append(
                        (day, period, "meeting", meeting.id, f"ישיבה '{meeting.name}'")
                    )

    return teacher_pinned


def collect_pinned_from_meetings_simple(
    data: SolverData,
) -> dict[int, list[PinnedEntry]]:
    """Collect pinned slots from meetings without filtering.

    Used by the overlap detection UI which shows all potential conflicts.

    Returns: teacher_id -> list of (day, period, "meeting", meeting_id, source_label).
    """
    teacher_pinned: dict[int, list[PinnedEntry]] = {}

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

    return teacher_pinned


def _merge_pinned_maps(
    *maps: dict[int, list[PinnedEntry]],
) -> dict[int, list[PinnedEntry]]:
    """Merge multiple teacher_pinned maps into one."""
    result: dict[int, list[PinnedEntry]] = {}
    for m in maps:
        for tid, entries in m.items():
            result.setdefault(tid, []).extend(entries)
    return result


def build_teacher_pinned_map(
    data: SolverData,
    *,
    engine_meeting_filter: bool = True,
) -> dict[int, list[PinnedEntry]]:
    """Build the full teacher -> pinned entries map.

    Args:
        data: Solver data loaded from the database.
        engine_meeting_filter: If True, apply engine-style meeting filtering
            (non-mandatory, excused, blocked). If False, include all meeting teachers.

    Returns: teacher_id -> list of (day, period, item_type, item_id, source_label).
    """
    req_pinned = collect_pinned_from_requirements(data)
    cluster_pinned = collect_pinned_from_clusters(data)

    if engine_meeting_filter:
        meeting_pinned = collect_pinned_from_meetings_for_engine(data)
    else:
        meeting_pinned = collect_pinned_from_meetings_simple(data)

    return _merge_pinned_maps(req_pinned, cluster_pinned, meeting_pinned)


def find_pinned_overlaps(
    teacher_pinned: dict[int, list[PinnedEntry]],
    data: SolverData,
    teacher_name_map: dict[int, str],
) -> list[str]:
    """Find pinned-slot conflicts and return Hebrew error messages.

    Checks:
    1. Teacher pinned at a blocked timeslot
    2. Teacher pinned in two places at the same timeslot (unless allowed overlap)

    Used by engine.py for pre-solve validation.
    """
    errors: list[str] = []

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
                    f"מורה {tname}: הצמדה ל{day_he(day)} שעה {period} "
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
                        f"מורה {tname}: התנגשות הצמדות ב{day_he(day)} שעה {period} — "
                        f"{sources_str}"
                    )

    return errors


def check_pinned_conflicts(
    data: SolverData, teacher_name_map: dict[int, str]
) -> list[str]:
    """Full pinned-conflict check for engine pre-solve validation.

    Builds the teacher_pinned map (with engine meeting filtering)
    and returns error messages for any conflicts found.
    """
    teacher_pinned = build_teacher_pinned_map(data, engine_meeting_filter=True)
    return find_pinned_overlaps(teacher_pinned, data, teacher_name_map)
