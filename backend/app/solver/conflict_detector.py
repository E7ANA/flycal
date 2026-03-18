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

    # Build name maps
    teacher_names: dict[int, str] = {}
    class_names: dict[int, str] = {}
    for cg in data.class_groups:
        class_names[cg.id] = cg.name
    for req in data.requirements:
        if req.teacher_id and req.teacher:
            teacher_names[req.teacher_id] = req.teacher.name
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id and track.teacher:
                teacher_names[track.teacher_id] = track.teacher.name
    for meeting in getattr(data, "meetings", []):
        for t in meeting.teachers:
            teacher_names[t.id] = t.name

    def tname(tid: int) -> str:
        return teacher_names.get(tid, f"מורה #{tid}")

    def cname(cid: int) -> str:
        return class_names.get(cid, f"כיתה #{cid}")

    issues: list[ConflictIssue] = []
    issues.extend(_check_teacher_blocked_all_days(data, constraints, tname))
    issues.extend(_check_teacher_insufficient_slots(data, constraints, tname))
    issues.extend(_check_class_blocked_all_days(data, constraints, cname))
    issues.extend(_check_contradicting_time_rules(constraints))
    issues.extend(_check_cluster_teacher_conflicts(data, constraints, tname))
    return issues


def _check_teacher_blocked_all_days(
    data: SolverData, constraints: list[Constraint], tname,
) -> list[ConflictIssue]:
    """If a teacher has HARD BLOCK_DAY for all school days, it's impossible."""
    issues: list[ConflictIssue] = []

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
                    message=f"מורה {tname(teacher_id)} חסום/ה בכל הימים אך יש לו/ה שיעורים מוקצים",
                    constraint_ids=[c.id for c in blocks],
                ))

    return issues


def _check_teacher_insufficient_slots(
    data: SolverData, constraints: list[Constraint], tname,
) -> list[ConflictIssue]:
    """Check if teacher's available slots (after blocks) can fit their hours."""
    issues: list[ConflictIssue] = []

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

    for teacher_id, hours in teacher_hours.items():
        blocked_slots: set[tuple[str, int]] = set()
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

        available_set = set(data.available_slots)
        available = len(available_set - blocked_slots)
        if hours > available:
            issues.append(ConflictIssue(
                level="error",
                message=f"מורה {tname(teacher_id)}: {hours} שעות נדרשות אך רק {available} משבצות פנויות אחרי חסימות",
                constraint_ids=related_ids,
            ))
        elif available > 0 and hours > available * 0.85:
            issues.append(ConflictIssue(
                level="warning",
                message=f"מורה {tname(teacher_id)}: {hours}/{available} משבצות פנויות — מרווח צפוף",
                constraint_ids=related_ids,
            ))

    return issues


def _check_class_blocked_all_days(
    data: SolverData, constraints: list[Constraint], cname,
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
                    message=f"כיתה {cname(class_id)} חסומה בכל הימים אך יש לה שיעורים",
                    constraint_ids=[c.id for c in blocks],
                ))

    return issues


def _check_cluster_teacher_conflicts(
    data: SolverData, constraints: list[Constraint], tname,
) -> list[ConflictIssue]:
    """Check that grouped track teachers share enough available slots."""
    issues: list[ConflictIssue] = []
    available_set = set(data.available_slots)

    def get_teacher_blocked(teacher_id: int) -> tuple[set[tuple[str, int]], list[int]]:
        blocked: set[tuple[str, int]] = set()
        related_ids: list[int] = []

        if teacher_id in data.teacher_blocked_slots:
            blocked.update(data.teacher_blocked_slots[teacher_id])

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

    # Build source class names per cluster
    cluster_class_names: dict[int, list[str]] = {}
    class_name_map = {cg.id: cg.name for cg in data.class_groups}
    for cluster in data.clusters:
        cluster_class_names[cluster.id] = [
            class_name_map.get(sc.id, f"#{sc.id}") for sc in cluster.source_classes
        ]

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
            teacher_labels.append(tname(tid))

        # Class names for context
        cls_names = cluster_class_names.get(cluster.id, [])
        cls_str = f" [כיתות: {', '.join(cls_names)}]" if cls_names else ""

        common_count = len(common_slots)
        if hours_needed > common_count:
            issues.append(ConflictIssue(
                level="error",
                message=(
                    f"הקבצה '{cluster.name}'{cls_str}: נדרשות {hours_needed} שעות "
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
                    f"הקבצה '{cluster.name}'{cls_str}: {hours_needed}/{common_count} "
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
                if max_days + min_free > 6:
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
