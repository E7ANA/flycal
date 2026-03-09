"""Post-solve violation detector.

Analyzes a solved timetable and produces human-readable violation descriptions
for any constraint that wasn't fully satisfied.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.models.constraint import Constraint, ConstraintType, RuleType
from app.solver.model_builder import SolverData

if TYPE_CHECKING:
    from app.solver.engine import SolutionSnapshot

# Day labels for display
_DAY_HEB = {
    "SUNDAY": "ראשון",
    "MONDAY": "שני",
    "TUESDAY": "שלישי",
    "WEDNESDAY": "רביעי",
    "THURSDAY": "חמישי",
    "FRIDAY": "שישי",
}


def detect_violations(
    snapshot: SolutionSnapshot,
    data: SolverData,
    db: Session,
    school_id: int,
) -> list[dict]:
    """Detect and describe violations in a solved timetable.

    Returns a list of {category, severity, message} dicts.
    """
    violations: list[dict] = []

    # Build lookup maps from DB
    from app.models.subject import Subject
    from app.models.teacher import Teacher

    subjects = db.query(Subject).filter(Subject.school_id == school_id).all()
    teachers = db.query(Teacher).filter(Teacher.school_id == school_id).all()
    subject_map = {s.id: s for s in subjects}
    class_map = {c.id: c for c in data.class_groups}
    teacher_map = {t.id: t for t in teachers}

    # Build per-class, per-subject, per-day lesson counts from snapshot
    # class_subject_day[(class_id, subject_id)][day] = list of periods
    class_subject_day: dict[tuple[int, int], dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(list)
    )
    # teacher_day[teacher_id][day] = list of periods
    teacher_day: dict[int, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(list)
    )

    # Regular lessons
    for (c_id, s_id, t_id, day, period), val in snapshot.x_values.items():
        if val == 1:
            class_subject_day[(c_id, s_id)][day].append(period)
            teacher_day[t_id][day].append(period)

    # Track lessons — map to cluster subject
    cluster_map = {c.id: c for c in data.clusters}
    track_to_cluster: dict[int, object] = {}
    for cluster in data.clusters:
        for track in cluster.tracks:
            track_to_cluster[track.id] = cluster

    # Track day periods for cluster-level analysis
    # cluster_day[cluster_id][day] = list of periods
    cluster_day: dict[int, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for (track_id, day, period), val in snapshot.x_track_values.items():
        if val == 1:
            cluster = track_to_cluster.get(track_id)
            if cluster:
                cluster_day[cluster.id][day].append(period)
                # Also count for class_subject_day per source class
                for sc in cluster.source_classes:
                    class_subject_day[(sc.id, cluster.subject_id)][day].append(period)
                # Teacher
                for t in cluster.tracks:
                    if t.id == track_id and t.teacher_id:
                        teacher_day[t.teacher_id][day].append(period)

    # Load active constraints
    constraints = (
        db.query(Constraint)
        .filter(Constraint.school_id == school_id, Constraint.is_active == True)
        .all()
    )

    for c in constraints:
        if c.rule_type == RuleType.MAX_PER_DAY:
            _check_max_per_day(c, data, class_subject_day, cluster_day, subject_map, class_map, violations)
        elif c.rule_type == RuleType.REQUIRE_CONSECUTIVE_PERIODS:
            _check_consecutive(c, data, class_subject_day, cluster_day, subject_map, class_map, violations)
        elif c.rule_type == RuleType.NO_GAPS:
            _check_no_gaps(c, data, teacher_day, class_map, teacher_map, violations)
        elif c.rule_type == RuleType.MAX_GAPS_PER_DAY:
            _check_max_gaps(c, data, teacher_day, class_map, teacher_map, violations)
        elif c.rule_type == RuleType.MAX_TEACHING_HOURS_PER_DAY:
            _check_max_teaching_hours(c, data, teacher_day, teacher_map, violations)
        elif c.rule_type == RuleType.MIN_DAYS_SPREAD:
            _check_min_days_spread(c, data, class_subject_day, subject_map, class_map, violations)

    # Brain violations: morning priority
    _check_morning_priority(data, snapshot, subject_map, class_map, violations)

    return violations


def _day_name(day: str) -> str:
    return _DAY_HEB.get(day, day)


def _count_gaps(periods: list[int]) -> int:
    if len(periods) <= 1:
        return 0
    sorted_p = sorted(periods)
    return sum(sorted_p[i + 1] - sorted_p[i] - 1 for i in range(len(sorted_p) - 1))


def _check_max_per_day(
    c: Constraint,
    data: SolverData,
    class_subject_day: dict,
    cluster_day: dict,
    subject_map: dict,
    class_map: dict,
    violations: list[dict],
) -> None:
    max_val = (c.parameters or {}).get("max", 1)
    target_id = c.target_id
    if not target_id:
        return
    severity = "חובה" if c.type == ConstraintType.HARD else "רך"
    subj = subject_map.get(target_id)
    subj_name = subj.name if subj else f"מקצוע {target_id}"

    # Regular classes
    for (c_id, s_id), day_periods in class_subject_day.items():
        if s_id != target_id:
            continue
        cls = class_map.get(c_id)
        cls_name = cls.name if cls else f"כיתה {c_id}"
        for day, periods in day_periods.items():
            unique_periods = set(periods)
            if len(unique_periods) > max_val:
                violations.append({
                    "category": "MAX_PER_DAY",
                    "severity": severity,
                    "message": f"{subj_name} ב{cls_name} — {len(unique_periods)} שעות ביום {_day_name(day)} (מקסימום {max_val})",
                    "constraint_id": c.id,
                })
                break  # One violation per class is enough


def _check_consecutive(
    c: Constraint,
    data: SolverData,
    class_subject_day: dict,
    cluster_day: dict,
    subject_map: dict,
    class_map: dict,
    violations: list[dict],
) -> None:
    count = (c.parameters or {}).get("consecutive_count", 2)
    target_id = c.target_id
    severity = "חובה" if c.type == ConstraintType.HARD else "רך"

    # Check cluster-level (groupings)
    if c.category and c.category.value == "GROUPING" and target_id:
        for cluster in data.clusters:
            if cluster.id != target_id:
                continue
            subj = subject_map.get(cluster.subject_id)
            subj_name = subj.name if subj else cluster.name
            for day, periods in cluster_day.get(cluster.id, {}).items():
                unique = sorted(set(periods))
                if len(unique) == 0:
                    continue
                if not _is_consecutive_blocks(unique, count):
                    violations.append({
                        "category": "CONSECUTIVE",
                        "severity": severity,
                        "message": f"{subj_name} — שעות לא רצופות (בלוק של {count}) ביום {_day_name(day)}: שעות {unique}",
                        "constraint_id": c.id,
                    })
        return

    # Regular subject-level
    if target_id:
        subj = subject_map.get(target_id)
        subj_name = subj.name if subj else f"מקצוע {target_id}"
        for (c_id, s_id), day_periods in class_subject_day.items():
            if s_id != target_id:
                continue
            cls = class_map.get(c_id)
            cls_name = cls.name if cls else f"כיתה {c_id}"
            for day, periods in day_periods.items():
                unique = sorted(set(periods))
                if len(unique) == 0:
                    continue
                if not _is_consecutive_blocks(unique, count):
                    violations.append({
                        "category": "CONSECUTIVE",
                        "severity": severity,
                        "message": f"{subj_name} ב{cls_name} — שעות לא רצופות (בלוק של {count}) ביום {_day_name(day)}: שעות {unique}",
                        "constraint_id": c.id,
                    })


def _is_consecutive_blocks(sorted_periods: list[int], block_size: int) -> bool:
    """Check if all periods can be grouped into blocks of block_size consecutive periods."""
    if len(sorted_periods) == 0:
        return True
    if len(sorted_periods) % block_size != 0:
        return False
    # Check each group
    for i in range(0, len(sorted_periods), block_size):
        block = sorted_periods[i:i + block_size]
        if block[-1] - block[0] != block_size - 1:
            return False
    return True


def _check_no_gaps(
    c: Constraint,
    data: SolverData,
    teacher_day: dict,
    class_map: dict,
    teacher_map: dict,
    violations: list[dict],
) -> None:
    severity = "רך"  # NO_GAPS is always soft
    if c.target_type and c.target_type.value == "TEACHER":
        target_id = c.target_id
        for t_id, days_data in teacher_day.items():
            if target_id and t_id != target_id:
                continue
            t = teacher_map.get(t_id)
            t_name = t.name if t else f"מורה {t_id}"
            for day, periods in days_data.items():
                gaps = _count_gaps(periods)
                if gaps > 0:
                    violations.append({
                        "category": "GAPS",
                        "severity": severity,
                        "message": f"{t_name} — {gaps} חלונות ביום {_day_name(day)}",
                        "constraint_id": c.id,
                    })


def _check_max_gaps(
    c: Constraint,
    data: SolverData,
    teacher_day: dict,
    class_map: dict,
    teacher_map: dict,
    violations: list[dict],
) -> None:
    max_gaps = (c.parameters or {}).get("max", 1)
    severity = "רך"
    target_id = c.target_id
    for t_id, days_data in teacher_day.items():
        if target_id and t_id != target_id:
            continue
        t = teacher_map.get(t_id)
        t_name = t.name if t else f"מורה {t_id}"
        for day, periods in days_data.items():
            gaps = _count_gaps(periods)
            if gaps > max_gaps:
                violations.append({
                    "category": "GAPS",
                    "severity": severity,
                    "message": f"{t_name} — {gaps} חלונות ביום {_day_name(day)} (מקסימום {max_gaps})",
                    "constraint_id": c.id,
                })


def _check_max_teaching_hours(
    c: Constraint,
    data: SolverData,
    teacher_day: dict,
    teacher_map: dict,
    violations: list[dict],
) -> None:
    max_hours = (c.parameters or {}).get("max", 8)
    severity = "חובה" if c.type == ConstraintType.HARD else "רך"
    target_id = c.target_id
    for t_id, days_data in teacher_day.items():
        if target_id and t_id != target_id:
            continue
        t = teacher_map.get(t_id)
        t_name = t.name if t else f"מורה {t_id}"
        for day, periods in days_data.items():
            count = len(set(periods))
            if count > max_hours:
                violations.append({
                    "category": "TEACHER_LOAD",
                    "severity": severity,
                    "message": f"{t_name} — {count} שעות ביום {_day_name(day)} (מקסימום {max_hours})",
                    "constraint_id": c.id,
                })


def _check_min_days_spread(
    c: Constraint,
    data: SolverData,
    class_subject_day: dict,
    subject_map: dict,
    class_map: dict,
    violations: list[dict],
) -> None:
    min_days = (c.parameters or {}).get("min_days", 2)
    target_id = c.target_id
    if not target_id:
        return
    severity = "חובה" if c.type == ConstraintType.HARD else "רך"
    subj = subject_map.get(target_id)
    subj_name = subj.name if subj else f"מקצוע {target_id}"

    for (c_id, s_id), day_periods in class_subject_day.items():
        if s_id != target_id:
            continue
        active_days = sum(1 for periods in day_periods.values() if len(periods) > 0)
        if active_days < min_days:
            cls = class_map.get(c_id)
            cls_name = cls.name if cls else f"כיתה {c_id}"
            violations.append({
                "category": "SPREAD",
                "severity": severity,
                "message": f"{subj_name} ב{cls_name} — מפוזר ב-{active_days} ימים (מינימום {min_days})",
                "constraint_id": c.id,
            })


def _check_morning_priority(
    data: SolverData,
    snapshot: SolutionSnapshot,
    subject_map: dict,
    class_map: dict,
    violations: list[dict],
) -> None:
    """Flag subjects with morning_priority that got mostly late periods."""
    # Collect subjects with morning priority
    priority_subjects: dict[int, int] = {}  # subject_id -> priority
    for s in subject_map.values():
        if getattr(s, "morning_priority", None) and s.morning_priority > 0:
            priority_subjects[s.id] = s.morning_priority

    if not priority_subjects:
        return

    # For each priority subject, compute average period
    # subject_periods[subject_id] = list of periods
    subject_periods: dict[int, list[int]] = defaultdict(list)

    for (c_id, s_id, t_id, day, period), val in snapshot.x_values.items():
        if val == 1 and s_id in priority_subjects:
            subject_periods[s_id].append(period)

    for (track_id, day, period), val in snapshot.x_track_values.items():
        if val == 1:
            for cluster in data.clusters:
                if cluster.subject_id in priority_subjects:
                    for track in cluster.tracks:
                        if track.id == track_id:
                            subject_periods[cluster.subject_id].append(period)

    for s_id, periods in subject_periods.items():
        if not periods:
            continue
        avg = sum(periods) / len(periods)
        priority = priority_subjects[s_id]
        subj = subject_map.get(s_id)
        subj_name = subj.name if subj else f"מקצוע {s_id}"
        # Flag if average period > 4 for high-priority subjects
        threshold = 4 if priority >= 70 else 5
        if avg > threshold:
            violations.append({
                "category": "MORNING",
                "severity": "רך",
                "message": f"{subj_name} (חשיבות בוקר {priority}) — ממוצע שעה {avg:.1f} (סף {threshold})",
                "constraint_id": None,
            })
