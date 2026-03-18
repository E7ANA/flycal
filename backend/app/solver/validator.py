"""Pre-solve data validation — checks that the input data is complete and solvable."""

from dataclasses import dataclass, field

from app.solver.model_builder import SolverData


DAY_LABELS = {
    "SUNDAY": "ראשון",
    "MONDAY": "שני",
    "TUESDAY": "שלישי",
    "WEDNESDAY": "רביעי",
    "THURSDAY": "חמישי",
    "FRIDAY": "שישי",
}


def _day(d: str) -> str:
    return DAY_LABELS.get(d, d)


@dataclass
class ValidationIssue:
    level: str  # "error" | "warning"
    category: str  # "data" | "capacity" | "assignment"
    message: str
    details: dict = field(default_factory=dict)


class _Names:
    """Name lookup maps built once from SolverData."""

    def __init__(self, data: SolverData):
        self.teacher: dict[int, str] = {}
        self.class_group: dict[int, str] = {}
        self.subject: dict[int, str] = {}
        self.req_label: dict[int, str] = {}  # requirement id -> "מקצוע (כיתה)"

        for cg in data.class_groups:
            self.class_group[cg.id] = cg.name

        for req in data.requirements:
            if req.teacher and req.teacher_id:
                self.teacher[req.teacher_id] = req.teacher.name
            if req.subject:
                self.subject[req.subject_id] = req.subject.name
            subj_name = req.subject.name if req.subject else f"מקצוע #{req.subject_id}"
            cls_name = self.class_group.get(req.class_group_id, f"כיתה #{req.class_group_id}")
            self.req_label[req.id] = f"{subj_name} ({cls_name})"

        for cluster in data.clusters:
            for track in cluster.tracks:
                if track.teacher_id and track.teacher:
                    self.teacher[track.teacher_id] = track.teacher.name

        for meeting in getattr(data, "meetings", []):
            for t in meeting.teachers:
                self.teacher[t.id] = t.name

    def t(self, tid: int) -> str:
        return self.teacher.get(tid, f"מורה #{tid}")

    def c(self, cid: int) -> str:
        return self.class_group.get(cid, f"כיתה #{cid}")

    def s(self, sid: int) -> str:
        return self.subject.get(sid, f"מקצוע #{sid}")

    def r(self, rid: int) -> str:
        if rid < 0:
            return f"טראק #{-rid}"
        return self.req_label.get(rid, f"דרישה #{rid}")


def validate(data: SolverData) -> list[ValidationIssue]:
    """Run all data validation checks. Returns list of issues."""
    n = _Names(data)
    issues: list[ValidationIssue] = []
    issues.extend(_check_basic_data(data, n))
    issues.extend(_check_teacher_assignments(data, n))
    issues.extend(_check_capacity(data, n))
    issues.extend(_check_teacher_capacity(data, n))
    issues.extend(_check_meeting_data(data, n))
    issues.extend(_check_cluster_teacher_availability(data, n))
    issues.extend(_check_pinned_slots(data, n))
    return issues


def _check_basic_data(data: SolverData, n: _Names) -> list[ValidationIssue]:
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
                message=f"דרישה עם 0 שעות: {n.s(req.subject_id)} בכיתה {n.c(req.class_group_id)}",
                details={"requirement_id": req.id},
            ))

    return issues


def _check_teacher_assignments(data: SolverData, n: _Names) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    for req in data.requirements:
        if not req.is_grouped and req.teacher_id is None:
            issues.append(ValidationIssue(
                level="error", category="assignment",
                message=f"לא הוקצה מורה: {n.s(req.subject_id)} בכיתה {n.c(req.class_group_id)}",
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


def _check_capacity(data: SolverData, n: _Names) -> list[ValidationIssue]:
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
            issues.append(ValidationIssue(
                level="warning", category="data",
                message=(
                    f"כיתה {n.c(req.class_group_id)}: מקצוע '{n.s(req.subject_id)}' מופיע גם כדרישה רגילה "
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

        # Check against grade-specific available slots if GRADE_ACTIVITY_HOURS exists
        grade_map = data.grade_periods_map.get(cg.grade_id) if hasattr(cg, "grade_id") else None
        if grade_map:
            grade_available = sum(grade_map.values())
        else:
            grade_available = total_available

        if hours > grade_available:
            if grade_map:
                day_detail = ", ".join(
                    f"{_day(d)}: {p} שעות" for d, p in grade_map.items()
                )
                issues.append(ValidationIssue(
                    level="error", category="capacity",
                    message=(
                        f"כיתה {cg.name}: {hours} שעות נדרשות אך רק {grade_available} "
                        f"משבצות זמינות לפי שעות פעילות השכבה ({day_detail})"
                    ),
                    details={"class_id": cg.id, "hours": hours, "available": grade_available},
                ))
            else:
                issues.append(ValidationIssue(
                    level="error", category="capacity",
                    message=f"כיתה {cg.name}: {hours} שעות נדרשות אך רק {grade_available} משבצות זמינות",
                    details={"class_id": cg.id, "hours": hours, "available": grade_available},
                ))
        elif hours > grade_available * 0.9:
            issues.append(ValidationIssue(
                level="warning", category="capacity",
                message=f"כיתה {cg.name}: {hours}/{grade_available} משבצות — עומס גבוה מאוד",
                details={"class_id": cg.id, "hours": hours, "available": grade_available},
            ))

    return issues


def _check_teacher_capacity(data: SolverData, n: _Names) -> list[ValidationIssue]:
    """Check that teacher hours fit in available slots after blocked slots."""
    issues: list[ValidationIssue] = []

    if not data.available_slots:
        return issues

    available_set = set(data.available_slots)

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

    for tid, hours in teacher_hours.items():
        blocked = data.teacher_blocked_slots.get(tid, set())
        teacher_available = len(available_set - blocked)

        if hours > teacher_available:
            issues.append(ValidationIssue(
                level="error", category="capacity",
                message=(
                    f"מורה {n.t(tid)}: {hours} שעות נדרשות "
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
                    f"מורה {n.t(tid)}: {hours}/{teacher_available} משבצות — עומס גבוה"
                ),
                details={
                    "teacher_id": tid,
                    "hours": hours,
                    "available": teacher_available,
                    "blocked": len(blocked),
                },
            ))

    return issues


def _check_cluster_teacher_availability(data: SolverData, n: _Names) -> list[ValidationIssue]:
    """Check that all teachers in a grouping cluster share enough available slots."""
    issues: list[ValidationIssue] = []

    available_set = set(data.available_slots)

    for cluster in data.clusters:
        tracks_with_teacher = [t for t in cluster.tracks if t.teacher_id is not None]
        if len(tracks_with_teacher) < 2:
            continue

        hours_needed = max(t.hours_per_week for t in tracks_with_teacher)

        common_slots = set(available_set)
        teacher_names: list[str] = []

        for track in tracks_with_teacher:
            tid = track.teacher_id
            blocked = data.teacher_blocked_slots.get(tid, set())
            teacher_free = available_set - blocked
            common_slots &= teacher_free
            teacher_names.append(n.t(tid))

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


def _check_meeting_data(data: SolverData, n: _Names) -> list[ValidationIssue]:
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


def _check_pinned_slots(data: SolverData, n: _Names) -> list[ValidationIssue]:
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

        req_label = n.r(req.id)

        # Check pin count vs hours
        if len(pinned) > req.hours_per_week:
            issues.append(ValidationIssue(
                level="error", category="data",
                message=(
                    f"{req_label}: {len(pinned)} נעילות "
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
                        f"{req_label}: נעילה ביום {_day(day)} שעה {period} "
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
                        f"{req_label}: נעילה ביום {_day(day)} שעה {period} "
                        f"— מורה {n.t(req.teacher_id)} חסום/ה בשעה זו"
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
                            f"{req_label}: נעילה ביום {_day(day)} שעה {period} "
                            f"— מורה משותף {n.t(co_tid)} חסום/ה בשעה זו"
                        ),
                        details={"requirement_id": req.id, "teacher_id": co_tid},
                    ))

            # Collect for cross-conflict detection
            teacher_pins.setdefault(req.teacher_id, []).append((day, period, req.id))
            for co_tid in (req.co_teacher_ids or []):
                teacher_pins.setdefault(co_tid, []).append((day, period, req.id))
            class_pins.setdefault(req.class_group_id, []).append((day, period, req.id, None))

    # Also collect pinned track slots per teacher AND per class (for class overlap detection)
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
                # Track pins apply to ALL source classes in the cluster (grouping_sync)
                # Use cluster_id in the entry so we can filter same-cluster overlaps later
                for sc in cluster.source_classes:
                    class_pins.setdefault(sc.id, []).append(
                        (day, period, -track.id, cluster.id)
                    )

    # Build pinned meeting slots per teacher
    meeting_pinned_slots: dict[int, list[tuple[str, int, str]]] = {}
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
                labels = [n.r(rid) for rid in req_ids]
                issues.append(ValidationIssue(
                    level="error", category="data",
                    message=(
                        f"מורה {n.t(tid)}: נעילות מתנגשות ביום {_day(day)} שעה {period} "
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
                label = n.r(req_id)
                issues.append(ValidationIssue(
                    level="error", category="data",
                    message=(
                        f"מורה {n.t(tid)}: {label} נעול/ה ביום {_day(day)} שעה {period} "
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

    # Detect class pin conflicts (ignore same-cluster overlaps — they're synced by design)
    for cid, pins in class_pins.items():
        slot_entries: dict[tuple[str, int], list[tuple[int, int | None]]] = {}
        for day, period, req_id, cluster_id in pins:
            slot_entries.setdefault((day, period), []).append((req_id, cluster_id))
        for (day, period), entries in slot_entries.items():
            # Group by cluster_id: entries from the same cluster don't conflict
            unique_sources: list[int] = []
            seen_clusters: set[int] = set()
            for req_id, cluster_id in entries:
                if cluster_id is not None:
                    if cluster_id in seen_clusters:
                        continue  # same cluster — not a conflict
                    seen_clusters.add(cluster_id)
                unique_sources.append(req_id)
            if len(unique_sources) > 1:
                labels = [n.r(rid) for rid in unique_sources]
                issues.append(ValidationIssue(
                    level="warning", category="overlap",
                    message=(
                        f"כיתה {n.c(cid)}: חפיפת נעילות ביום {_day(day)} שעה {period} "
                        f"({', '.join(labels)}) — בדוק חפיפות ואשר אם תקין"
                    ),
                    details={"class_id": cid, "requirement_ids": unique_sources},
                ))

    return issues
