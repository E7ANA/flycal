"""Pre-solve data validation — checks that the input data is complete and solvable."""

from dataclasses import dataclass, field

from app.solver.model_builder import SolverData


@dataclass
class ValidationIssue:
    level: str  # "error" | "warning"
    category: str  # "data" | "capacity" | "assignment"
    message: str
    details: dict = field(default_factory=dict)


def validate(data: SolverData) -> list[ValidationIssue]:
    """Run all data validation checks. Returns list of issues."""
    issues: list[ValidationIssue] = []
    issues.extend(_check_basic_data(data))
    issues.extend(_check_teacher_assignments(data))
    issues.extend(_check_capacity(data))
    issues.extend(_check_teacher_capacity(data))
    issues.extend(_check_meeting_data(data))
    issues.extend(_check_cluster_teacher_availability(data))
    issues.extend(_check_pinned_slots(data))
    return issues


def _check_basic_data(data: SolverData) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    if not data.class_groups:
        issues.append(ValidationIssue(
            level="error", category="data",
            message="אין כיתות מוגדרות",
        ))
    if not data.requirements:
        issues.append(ValidationIssue(
            level="error", category="data",
            message="אין דרישות מקצועות מוגדרות",
        ))
    if not data.available_slots:
        issues.append(ValidationIssue(
            level="error", category="data",
            message="אין משבצות זמן זמינות — יש לייצר timeslots",
        ))

    # Check for classes with no requirements
    classes_with_reqs = {r.class_group_id for r in data.requirements if not r.is_grouped}
    for cg in data.class_groups:
        if cg.id not in classes_with_reqs:
            issues.append(ValidationIssue(
                level="warning", category="data",
                message=f"לכיתה {cg.name} אין דרישות מקצועות",
                details={"class_id": cg.id},
            ))

    # Check for 0-hour requirements (skip grouped — their hours are on the tracks)
    for req in data.requirements:
        if req.hours_per_week <= 0 and not req.is_grouped:
            issues.append(ValidationIssue(
                level="error", category="data",
                message=f"דרישה עם 0 שעות: כיתה {req.class_group_id} מקצוע {req.subject_id}",
                details={"requirement_id": req.id},
            ))

    return issues


def _check_teacher_assignments(data: SolverData) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    for req in data.requirements:
        if not req.is_grouped and req.teacher_id is None:
            issues.append(ValidationIssue(
                level="error", category="assignment",
                message=f"לא הוקצה מורה: כיתה {req.class_group_id} מקצוע {req.subject_id}",
                details={"requirement_id": req.id},
            ))

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                issues.append(ValidationIssue(
                    level="error", category="assignment",
                    message=f"לא הוקצה מורה לרצועה '{track.name}' בהקבצה '{cluster.name}'",
                    details={"track_id": track.id, "cluster_id": cluster.id},
                ))

    return issues


def _check_capacity(data: SolverData) -> list[ValidationIssue]:
    """Check that total required hours fit in available timeslots."""
    issues: list[ValidationIssue] = []

    if not data.available_slots:
        return issues

    total_available = len(data.available_slots)

    # Build set of subject_ids covered by clusters per class
    cluster_subjects_per_class: dict[int, set[int]] = {}
    for cluster in data.clusters:
        for sc in cluster.source_classes:
            cluster_subjects_per_class.setdefault(sc.id, set()).add(cluster.subject_id)

    # Per-class check: total hours for a class must fit in available slots
    class_hours: dict[int, int] = {}
    for req in data.requirements:
        if req.is_grouped:
            continue
        if req.teacher_id is None:
            continue
        # Skip regular requirements whose subject is already covered by a cluster
        cluster_sids = cluster_subjects_per_class.get(req.class_group_id, set())
        if req.subject_id in cluster_sids:
            cg_name = next(
                (cg.name for cg in data.class_groups if cg.id == req.class_group_id),
                str(req.class_group_id),
            )
            subj_name = req.subject.name if req.subject else str(req.subject_id)
            issues.append(ValidationIssue(
                level="warning", category="data",
                message=(
                    f"כיתה {cg_name}: מקצוע '{subj_name}' מופיע גם כדרישה רגילה "
                    f"({req.hours_per_week}ש) וגם בהקבצה — ספירה כפולה"
                ),
                details={
                    "class_id": req.class_group_id,
                    "subject_id": req.subject_id,
                    "requirement_id": req.id,
                },
            ))
            continue  # Don't count duplicate hours
        class_hours[req.class_group_id] = (
            class_hours.get(req.class_group_id, 0) + req.hours_per_week
        )

    # Add grouped hours per source class
    for cluster in data.clusters:
        hours = max((t.hours_per_week for t in cluster.tracks if t.teacher_id), default=0)
        for sc in cluster.source_classes:
            class_hours[sc.id] = class_hours.get(sc.id, 0) + hours

    for cg in data.class_groups:
        hours = class_hours.get(cg.id, 0)
        if hours > total_available:
            issues.append(ValidationIssue(
                level="error", category="capacity",
                message=f"כיתה {cg.name}: {hours} שעות נדרשות אך רק {total_available} משבצות זמינות",
                details={"class_id": cg.id, "hours": hours, "available": total_available},
            ))
        elif hours > total_available * 0.9:
            issues.append(ValidationIssue(
                level="warning", category="capacity",
                message=f"כיתה {cg.name}: {hours}/{total_available} משבצות — עומס גבוה מאוד",
                details={"class_id": cg.id, "hours": hours, "available": total_available},
            ))

    return issues


def _check_teacher_capacity(data: SolverData) -> list[ValidationIssue]:
    """Check that teacher hours fit in available slots after blocked slots."""
    issues: list[ValidationIssue] = []

    if not data.available_slots:
        return issues

    available_set = set(data.available_slots)

    # Build teacher name lookup from requirements and tracks
    teacher_name_map: dict[int, str] = {}
    for req in data.requirements:
        if req.teacher_id and req.teacher:
            teacher_name_map[req.teacher_id] = req.teacher.name
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id and track.teacher:
                teacher_name_map[track.teacher_id] = track.teacher.name

    # Teacher total hours
    teacher_hours: dict[int, int] = {}

    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        teacher_hours[req.teacher_id] = (
            teacher_hours.get(req.teacher_id, 0) + req.hours_per_week
        )
        for co_tid in (req.co_teacher_ids or []):
            teacher_hours[co_tid] = (
                teacher_hours.get(co_tid, 0) + req.hours_per_week
            )

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teacher_hours[track.teacher_id] = (
                    teacher_hours.get(track.teacher_id, 0) + track.hours_per_week
                )

    # Add meeting hours to each teacher's total
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_hours[t.id] = (
                teacher_hours.get(t.id, 0) + meeting.hours_per_week
            )

    for tid, hours in teacher_hours.items():
        blocked = data.teacher_blocked_slots.get(tid, set())
        teacher_available = len(available_set - blocked)
        tname = teacher_name_map.get(tid, f"#{tid}")

        if hours > teacher_available:
            issues.append(ValidationIssue(
                level="error", category="capacity",
                message=(
                    f"מורה {tname}: {hours} שעות נדרשות "
                    f"אך רק {teacher_available} משבצות פנויות אחרי חסימות"
                ),
                details={
                    "teacher_id": tid,
                    "hours": hours,
                    "available": teacher_available,
                    "blocked": len(blocked),
                },
            ))
        elif teacher_available > 0 and hours > teacher_available * 0.85:
            issues.append(ValidationIssue(
                level="warning", category="capacity",
                message=(
                    f"מורה {tname}: {hours}/{teacher_available} משבצות — עומס גבוה"
                ),
                details={
                    "teacher_id": tid,
                    "hours": hours,
                    "available": teacher_available,
                    "blocked": len(blocked),
                },
            ))

    return issues


def _check_cluster_teacher_availability(data: SolverData) -> list[ValidationIssue]:
    """Check that all teachers in a grouping cluster share enough available slots.

    Since SYNC_TRACKS forces all tracks to run simultaneously, the common
    available slots (intersection) of all track teachers must be >= hours_per_week.
    """
    issues: list[ValidationIssue] = []

    available_set = set(data.available_slots)

    for cluster in data.clusters:
        tracks_with_teacher = [t for t in cluster.tracks if t.teacher_id is not None]
        if len(tracks_with_teacher) < 2:
            continue

        hours_needed = max(t.hours_per_week for t in tracks_with_teacher)

        # Start with full available slots, then intersect with each teacher's free slots
        common_slots = set(available_set)
        teacher_names: list[str] = []

        for track in tracks_with_teacher:
            tid = track.teacher_id
            blocked = data.teacher_blocked_slots.get(tid, set())
            teacher_free = available_set - blocked
            common_slots &= teacher_free

            # Try to get teacher name
            teacher_obj = track.teacher
            teacher_names.append(
                teacher_obj.name if teacher_obj else f"#{tid}"
            )

        common_count = len(common_slots)
        if hours_needed > common_count:
            issues.append(ValidationIssue(
                level="error", category="capacity",
                message=(
                    f"הקבצה '{cluster.name}': נדרשות {hours_needed} שעות "
                    f"אך רק {common_count} משבצות משותפות לכל המורים "
                    f"({', '.join(teacher_names)})"
                ),
                details={
                    "cluster_id": cluster.id,
                    "hours_needed": hours_needed,
                    "common_slots": common_count,
                    "teacher_names": teacher_names,
                },
            ))
        elif common_count > 0 and hours_needed > common_count * 0.8:
            issues.append(ValidationIssue(
                level="warning", category="capacity",
                message=(
                    f"הקבצה '{cluster.name}': {hours_needed}/{common_count} "
                    f"משבצות משותפות — מרווח צפוף "
                    f"({', '.join(teacher_names)})"
                ),
                details={
                    "cluster_id": cluster.id,
                    "hours_needed": hours_needed,
                    "common_slots": common_count,
                    "teacher_names": teacher_names,
                },
            ))

    return issues


def _check_meeting_data(data: SolverData) -> list[ValidationIssue]:
    """Check that meetings have valid data."""
    issues: list[ValidationIssue] = []

    for meeting in data.meetings:
        if not meeting.teachers:
            issues.append(ValidationIssue(
                level="warning", category="data",
                message=f"ישיבה '{meeting.name}' ללא מורים משויכים — תידלג",
                details={"meeting_id": meeting.id},
            ))
        if meeting.hours_per_week <= 0:
            issues.append(ValidationIssue(
                level="error", category="data",
                message=f"ישיבה '{meeting.name}' עם 0 שעות",
                details={"meeting_id": meeting.id},
            ))

    return issues


def _check_pinned_slots(data: SolverData) -> list[ValidationIssue]:
    """Validate pinned lesson slots for conflicts and feasibility."""
    issues: list[ValidationIssue] = []

    available_set = set(data.available_slots)

    # Track occupied slots per teacher and per class for conflict detection
    teacher_pins: dict[int, list[tuple[str, int, int]]] = {}  # teacher_id -> [(day, period, req_id)]
    class_pins: dict[int, list[tuple[str, int, int]]] = {}    # class_id -> [(day, period, req_id)]

    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        pinned = getattr(req, "pinned_slots", None)
        if not pinned:
            continue

        # Check pin count vs hours
        if len(pinned) > req.hours_per_week:
            issues.append(ValidationIssue(
                level="error", category="data",
                message=(
                    f"דרישה #{req.id}: {len(pinned)} נעילות "
                    f"אך רק {req.hours_per_week} שעות שבועיות"
                ),
                details={"requirement_id": req.id},
            ))

        for pin in pinned:
            day = pin.get("day")
            period = pin.get("period")
            if day is None or period is None:
                continue

            # Check pin is in available slots
            if (day, period) not in available_set:
                issues.append(ValidationIssue(
                    level="error", category="data",
                    message=(
                        f"דרישה #{req.id}: נעילה ב-{day} שעה {period} "
                        f"— משבצת לא זמינה"
                    ),
                    details={"requirement_id": req.id, "day": day, "period": period},
                ))

            # Check teacher blocked slots conflict
            blocked = data.teacher_blocked_slots.get(req.teacher_id, set())
            if (day, period) in blocked:
                issues.append(ValidationIssue(
                    level="error", category="data",
                    message=(
                        f"דרישה #{req.id}: נעילה ב-{day} שעה {period} "
                        f"— המורה חסום בשעה זו"
                    ),
                    details={"requirement_id": req.id, "teacher_id": req.teacher_id},
                ))

            # Check co-teacher blocked slots conflict
            for co_tid in (req.co_teacher_ids or []):
                co_blocked = data.teacher_blocked_slots.get(co_tid, set())
                if (day, period) in co_blocked:
                    issues.append(ValidationIssue(
                        level="error", category="data",
                        message=(
                            f"דרישה #{req.id}: נעילה ב-{day} שעה {period} "
                            f"— מורה משותף #{co_tid} חסום בשעה זו"
                        ),
                        details={"requirement_id": req.id, "teacher_id": co_tid},
                    ))

            # Collect for cross-conflict detection
            teacher_pins.setdefault(req.teacher_id, []).append((day, period, req.id))
            for co_tid in (req.co_teacher_ids or []):
                teacher_pins.setdefault(co_tid, []).append((day, period, req.id))
            class_pins.setdefault(req.class_group_id, []).append((day, period, req.id))

    # Also collect pinned track slots per teacher
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            pinned = getattr(track, "pinned_slots", None)
            if not pinned:
                continue
            for pin in pinned:
                day = pin.get("day")
                period = pin.get("period")
                if day is None or period is None:
                    continue
                teacher_pins.setdefault(track.teacher_id, []).append(
                    (day, period, -track.id)  # negative to distinguish from req ids
                )

    # Build pinned meeting slots per teacher
    meeting_pinned_slots: dict[int, list[tuple[str, int, str]]] = {}  # teacher_id -> [(day, period, meeting_name)]
    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        if not pinned:
            continue
        if not getattr(meeting, "is_mandatory_attendance", True):
            continue
        for pin in pinned:
            day = pin.get("day")
            period = pin.get("period")
            if day is None or period is None:
                continue
            for t in meeting.teachers:
                meeting_pinned_slots.setdefault(t.id, []).append(
                    (day, period, meeting.name)
                )

    # Detect teacher pin conflicts (same teacher pinned to same slot by different reqs)
    for tid, pins in teacher_pins.items():
        slot_reqs: dict[tuple[str, int], list[int]] = {}
        for day, period, req_id in pins:
            slot_reqs.setdefault((day, period), []).append(req_id)
        for (day, period), req_ids in slot_reqs.items():
            if len(req_ids) > 1:
                labels = []
                for rid in req_ids:
                    labels.append(f"טראק #{-rid}" if rid < 0 else f"דרישה #{rid}")
                issues.append(ValidationIssue(
                    level="error", category="data",
                    message=(
                        f"מורה #{tid}: נעילות מתנגשות ב-{day} שעה {period} "
                        f"({', '.join(labels)})"
                    ),
                    details={"teacher_id": tid, "requirement_ids": req_ids},
                ))

    # Detect pinned lesson/track vs pinned meeting conflicts
    for tid, pins in teacher_pins.items():
        meeting_slots = meeting_pinned_slots.get(tid)
        if not meeting_slots:
            continue
        meeting_slot_set: dict[tuple[str, int], str] = {}
        for day, period, mname in meeting_slots:
            meeting_slot_set[(day, period)] = mname
        for day, period, req_id in pins:
            if (day, period) in meeting_slot_set:
                mname = meeting_slot_set[(day, period)]
                label = f"טראק #{-req_id}" if req_id < 0 else f"דרישה #{req_id}"
                issues.append(ValidationIssue(
                    level="error", category="data",
                    message=(
                        f"מורה #{tid}: {label} נעול/ה ב-{day} שעה {period} "
                        f"— מתנגש עם ישיבת \"{mname}\" הנעולה באותה שעה"
                    ),
                    details={
                        "teacher_id": tid,
                        "requirement_id": req_id,
                        "meeting_name": mname,
                        "day": day,
                        "period": period,
                    },
                ))

    # Detect class pin conflicts
    for cid, pins in class_pins.items():
        slot_reqs: dict[tuple[str, int], list[int]] = {}
        for day, period, req_id in pins:
            slot_reqs.setdefault((day, period), []).append(req_id)
        for (day, period), req_ids in slot_reqs.items():
            if len(req_ids) > 1:
                issues.append(ValidationIssue(
                    level="error", category="data",
                    message=(
                        f"כיתה #{cid}: נעילות מתנגשות ב-{day} שעה {period} "
                        f"(דרישות {req_ids})"
                    ),
                    details={"class_id": cid, "requirement_ids": req_ids},
                ))

    return issues
