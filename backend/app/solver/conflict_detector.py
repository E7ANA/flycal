"""Detects impossible or conflicting constraint combinations before solving."""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.constraint import Constraint, ConstraintType, RuleType
from app.solver.model_builder import SolverData


@dataclass
class ConflictIssue:
    level: str  # "error" | "warning"
    message: str
    constraint_ids: list[int] = field(default_factory=list)


def detect_conflicts(
    data: SolverData, db: Session, school_id: int,
) -> list[ConflictIssue]:
    """Detect impossible constraint combinations."""
    constraints = (
        db.query(Constraint)
        .filter(Constraint.school_id == school_id, Constraint.is_active == True)
        .all()
    )

    issues: list[ConflictIssue] = []
    issues.extend(_check_teacher_blocked_all_days(data, constraints))
    issues.extend(_check_teacher_insufficient_slots(data, constraints))
    issues.extend(_check_class_blocked_all_days(data, constraints))
    issues.extend(_check_contradicting_time_rules(constraints))
    issues.extend(_check_cluster_teacher_conflicts(data, constraints))
    return issues


def _check_teacher_blocked_all_days(
    data: SolverData, constraints: list[Constraint],
) -> list[ConflictIssue]:
    """If a teacher has HARD BLOCK_DAY for all school days, it's impossible."""
    issues: list[ConflictIssue] = []

    # Group HARD BLOCK_DAY by teacher
    teacher_blocks: dict[int, list[Constraint]] = {}
    for c in constraints:
        if (c.rule_type == RuleType.BLOCK_DAY
                and c.type == ConstraintType.HARD
                and c.target_type == "TEACHER"
                and c.target_id is not None):
            teacher_blocks.setdefault(c.target_id, []).append(c)

    for teacher_id, blocks in teacher_blocks.items():
        blocked_days = {c.parameters.get("day") for c in blocks}
        available_days = set(data.days) - blocked_days
        if not available_days:
            # Check if this teacher actually has assignments
            has_assignments = any(
                r.teacher_id == teacher_id
                for r in data.requirements if not r.is_grouped
            ) or any(
                t.teacher_id == teacher_id
                for cl in data.clusters for t in cl.tracks
            )
            if has_assignments:
                issues.append(ConflictIssue(
                    level="error",
                    message=f"מורה #{teacher_id} חסום/ה בכל הימים אך יש לו/ה שיעורים מוקצים",
                    constraint_ids=[c.id for c in blocks],
                ))

    return issues


def _check_teacher_insufficient_slots(
    data: SolverData, constraints: list[Constraint],
) -> list[ConflictIssue]:
    """Check if teacher's available slots (after blocks) can fit their hours."""
    issues: list[ConflictIssue] = []

    # Calculate teacher hours
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

    # Add meeting hours
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_hours[t.id] = (
                teacher_hours.get(t.id, 0) + meeting.hours_per_week
            )

    # Calculate blocked slots per teacher (start with teacher-level blocked_slots)
    for teacher_id, hours in teacher_hours.items():
        blocked_slots: set[tuple[str, int]] = set()
        # Include teacher's own blocked slots
        if teacher_id in data.teacher_blocked_slots:
            blocked_slots.update(data.teacher_blocked_slots[teacher_id])
        related_ids: list[int] = []

        for c in constraints:
            if c.type != ConstraintType.HARD or c.target_id != teacher_id:
                continue
            if c.target_type != "TEACHER":
                continue

            if c.rule_type == RuleType.BLOCK_DAY:
                day = c.parameters.get("day")
                if day:
                    for d, p in data.available_slots:
                        if d == day:
                            blocked_slots.add((d, p))
                    related_ids.append(c.id)

            elif c.rule_type == RuleType.BLOCK_TIMESLOT:
                day = c.parameters.get("day")
                period = c.parameters.get("period")
                if day and period:
                    blocked_slots.add((day, period))
                    related_ids.append(c.id)

            elif c.rule_type == RuleType.BLOCK_TIME_RANGE:
                day_f = c.parameters.get("day", "ALL")
                from_p = c.parameters.get("from_period", 0)
                to_p = c.parameters.get("to_period", 0)
                for d, p in data.available_slots:
                    if (day_f == "ALL" or d == day_f) and from_p <= p <= to_p:
                        blocked_slots.add((d, p))
                related_ids.append(c.id)

        available = len(data.available_slots) - len(blocked_slots)
        if hours > available:
            issues.append(ConflictIssue(
                level="error",
                message=f"מורה #{teacher_id}: {hours} שעות נדרשות אך רק {available} משבצות פנויות אחרי חסימות",
                constraint_ids=related_ids,
            ))
        elif available > 0 and hours > available * 0.85:
            issues.append(ConflictIssue(
                level="warning",
                message=f"מורה #{teacher_id}: {hours}/{available} משבצות פנויות — מרווח צפוף",
                constraint_ids=related_ids,
            ))

    return issues


def _check_class_blocked_all_days(
    data: SolverData, constraints: list[Constraint],
) -> list[ConflictIssue]:
    """If a class is blocked on all days, it's impossible."""
    issues: list[ConflictIssue] = []

    class_blocks: dict[int, list[Constraint]] = {}
    for c in constraints:
        if (c.rule_type == RuleType.BLOCK_DAY
                and c.type == ConstraintType.HARD
                and c.target_type == "CLASS"
                and c.target_id is not None):
            class_blocks.setdefault(c.target_id, []).append(c)

    for class_id, blocks in class_blocks.items():
        blocked_days = {c.parameters.get("day") for c in blocks}
        available_days = set(data.days) - blocked_days
        if not available_days:
            has_requirements = any(
                r.class_group_id == class_id
                for r in data.requirements if not r.is_grouped
            )
            if has_requirements:
                issues.append(ConflictIssue(
                    level="error",
                    message=f"כיתה #{class_id} חסומה בכל הימים אך יש לה שיעורים",
                    constraint_ids=[c.id for c in blocks],
                ))

    return issues


def _check_cluster_teacher_conflicts(
    data: SolverData, constraints: list[Constraint],
) -> list[ConflictIssue]:
    """Check that grouped track teachers share enough available slots.

    All tracks in a cluster must run simultaneously (SYNC_TRACKS), so the
    intersection of all track teachers' available slots (after blocked_slots
    AND constraint-based blocks) must be >= hours_per_week.
    """
    issues: list[ConflictIssue] = []
    available_set = set(data.available_slots)

    # Pre-compute each teacher's effective blocked slots (blocked_slots + constraints)
    def get_teacher_blocked(teacher_id: int) -> tuple[set[tuple[str, int]], list[int]]:
        blocked: set[tuple[str, int]] = set()
        related_ids: list[int] = []

        # Teacher's own blocked_slots
        if teacher_id in data.teacher_blocked_slots:
            blocked.update(data.teacher_blocked_slots[teacher_id])

        # Constraint-based blocks
        for c in constraints:
            if c.type != ConstraintType.HARD or c.target_id != teacher_id:
                continue
            if c.target_type != "TEACHER":
                continue

            if c.rule_type == RuleType.BLOCK_DAY:
                day = c.parameters.get("day")
                if day:
                    for d, p in available_set:
                        if d == day:
                            blocked.add((d, p))
                    related_ids.append(c.id)

            elif c.rule_type == RuleType.BLOCK_TIMESLOT:
                day = c.parameters.get("day")
                period = c.parameters.get("period")
                if day and period:
                    blocked.add((day, period))
                    related_ids.append(c.id)

            elif c.rule_type == RuleType.BLOCK_TIME_RANGE:
                day_f = c.parameters.get("day", "ALL")
                from_p = c.parameters.get("from_period", 0)
                to_p = c.parameters.get("to_period", 0)
                for d, p in available_set:
                    if (day_f == "ALL" or d == day_f) and from_p <= p <= to_p:
                        blocked.add((d, p))
                related_ids.append(c.id)

        return blocked, related_ids

    for cluster in data.clusters:
        tracks_with_teacher = [t for t in cluster.tracks if t.teacher_id is not None]
        if len(tracks_with_teacher) < 2:
            continue

        hours_needed = max(t.hours_per_week for t in tracks_with_teacher)
        common_slots = set(available_set)
        all_related_ids: list[int] = []
        teacher_labels: list[str] = []

        for track in tracks_with_teacher:
            tid = track.teacher_id
            blocked, related_ids = get_teacher_blocked(tid)
            teacher_free = available_set - blocked
            common_slots &= teacher_free
            all_related_ids.extend(related_ids)

            teacher_obj = track.teacher
            teacher_labels.append(
                teacher_obj.name if teacher_obj else f"#{tid}"
            )

        common_count = len(common_slots)
        if hours_needed > common_count:
            issues.append(ConflictIssue(
                level="error",
                message=(
                    f"הקבצה '{cluster.name}': נדרשות {hours_needed} שעות "
                    f"אך רק {common_count} משבצות משותפות למורים "
                    f"({', '.join(teacher_labels)}) — "
                    f"בדוק חסימות שחוסמות ימים/שעות שונים למורים שונים"
                ),
                constraint_ids=all_related_ids,
            ))
        elif common_count > 0 and hours_needed > common_count * 0.8:
            issues.append(ConflictIssue(
                level="warning",
                message=(
                    f"הקבצה '{cluster.name}': {hours_needed}/{common_count} "
                    f"משבצות משותפות למורים ({', '.join(teacher_labels)}) — מרווח צפוף"
                ),
                constraint_ids=all_related_ids,
            ))

    return issues


def _check_contradicting_time_rules(
    constraints: list[Constraint],
) -> list[ConflictIssue]:
    """Detect contradicting hard time constraints on the same target."""
    issues: list[ConflictIssue] = []

    # Check MAX_TEACHING_DAYS + MIN_FREE_DAYS contradiction
    for c1 in constraints:
        if c1.type != ConstraintType.HARD:
            continue
        for c2 in constraints:
            if c2.type != ConstraintType.HARD or c2.id <= c1.id:
                continue
            if c1.target_id != c2.target_id or c1.target_type != c2.target_type:
                continue

            # MAX_TEACHING_DAYS vs MIN_FREE_DAYS
            if (c1.rule_type == RuleType.MAX_TEACHING_DAYS
                    and c2.rule_type == RuleType.MIN_FREE_DAYS):
                max_days = c1.parameters.get("max_days", 99)
                min_free = c2.parameters.get("min_days", 0)
                if max_days + min_free > 6:  # max possible school days
                    issues.append(ConflictIssue(
                        level="error",
                        message=f"סתירה: מקסימום {max_days} ימי הוראה + מינימום {min_free} ימים חופשיים > 6 ימים",
                        constraint_ids=[c1.id, c2.id],
                    ))

            # Duplicate BLOCK_DAY same day
            if (c1.rule_type == RuleType.BLOCK_DAY
                    and c2.rule_type == RuleType.BLOCK_DAY):
                if c1.parameters.get("day") == c2.parameters.get("day"):
                    issues.append(ConflictIssue(
                        level="warning",
                        message=f"חסימת יום כפולה: {c1.parameters.get('day')}",
                        constraint_ids=[c1.id, c2.id],
                    ))

    return issues
