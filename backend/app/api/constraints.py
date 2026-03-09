from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.constraint import (
    Constraint,
    ConstraintCategory,
    ConstraintType,
    RuleType,
    TargetType,
)
from app.schemas.constraint import (
    ConstraintCreate,
    ConstraintRead,
    ConstraintTemplateRead,
    ConstraintToggle,
    ConstraintUpdate,
    ConstraintWeightUpdate,
)

router = APIRouter(prefix="/api/constraints", tags=["constraints"])

# ---------------------------------------------------------------------------
# Constraint Templates
# ---------------------------------------------------------------------------

TEMPLATES: list[dict] = [
    {
        "name": "מורה - חסימת יום",
        "rule_type": RuleType.BLOCK_DAY,
        "category": ConstraintCategory.TEACHER,
        "default_type": ConstraintType.HARD,
        "default_weight": 50,
        "default_params": {},
    },
    {
        "name": "מקצוע - העדפת בוקר",
        "rule_type": RuleType.PREFER_TIME_RANGE,
        "category": ConstraintCategory.SUBJECT,
        "default_type": ConstraintType.SOFT,
        "default_weight": 70,
        "default_params": {"day": "ALL", "from_period": 1, "to_period": 4},
    },
    {
        "name": "מקצוע - מקסימום ליום",
        "rule_type": RuleType.MAX_PER_DAY,
        "category": ConstraintCategory.SUBJECT,
        "default_type": ConstraintType.SOFT,
        "default_weight": 70,
        "default_params": {"max": 1},
    },
    {
        "name": "כיתה - ללא חלונות",
        "rule_type": RuleType.NO_GAPS,
        "category": ConstraintCategory.CLASS,
        "default_type": ConstraintType.SOFT,
        "default_weight": 85,
        "default_params": {},
    },
    {
        "name": "מורה - צמצום חלונות",
        "rule_type": RuleType.MAX_GAPS_PER_DAY,
        "category": ConstraintCategory.TEACHER,
        "default_type": ConstraintType.SOFT,
        "default_weight": 60,
        "default_params": {"max": 1},
    },
    {
        "name": "שעה כפולה",
        "rule_type": RuleType.REQUIRE_CONSECUTIVE_PERIODS,
        "category": ConstraintCategory.SUBJECT,
        "default_type": ConstraintType.HARD,
        "default_weight": 50,
        "default_params": {"consecutive_count": 2},
    },
    {
        "name": "יום קצר שישי",
        "rule_type": RuleType.CLASS_DAY_LENGTH_LIMIT,
        "category": ConstraintCategory.GLOBAL,
        "default_type": ConstraintType.HARD,
        "default_weight": 50,
        "default_params": {"max_periods": 5, "day": "FRIDAY"},
    },
    {
        "name": "שכבה - שעות פעילות",
        "rule_type": RuleType.GRADE_ACTIVITY_HOURS,
        "category": ConstraintCategory.GLOBAL,
        "default_type": ConstraintType.HARD,
        "default_weight": 50,
        "default_params": {
            "periods_per_day_map": {
                "SUNDAY": 8, "MONDAY": 8, "TUESDAY": 8,
                "WEDNESDAY": 8, "THURSDAY": 8, "FRIDAY": 5,
            }
        },
    },
    {
        "name": "שכבה - ימים קצרים גמישים",
        "rule_type": RuleType.SHORT_DAYS_FLEXIBLE,
        "category": ConstraintCategory.GLOBAL,
        "default_type": ConstraintType.HARD,
        "default_weight": 50,
        "default_params": {"num_short_days": 2, "max_period_short": 5},
    },
]


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

_RULE_REQUIRED_PARAMS: dict[RuleType, list[str]] = {
    RuleType.BLOCK_TIMESLOT: ["day", "period"],
    RuleType.BLOCK_DAY: ["day"],
    RuleType.BLOCK_TIME_RANGE: ["from_period", "to_period"],
    RuleType.PREFER_TIME_RANGE: ["from_period", "to_period"],
    RuleType.PREFER_TIMESLOT: ["day", "period"],
    RuleType.MAX_PER_DAY: ["max"],
    RuleType.MIN_DAYS_SPREAD: ["min_days"],
    RuleType.REQUIRE_CONSECUTIVE_PERIODS: ["consecutive_count"],
    RuleType.NOT_SAME_DAY_AS: ["other_subject_id"],
    RuleType.MAX_TEACHING_HOURS_PER_DAY: ["max"],
    RuleType.MIN_TEACHING_HOURS_PER_DAY: ["min"],
    RuleType.MAX_TEACHING_DAYS: ["max_days"],
    RuleType.MIN_FREE_DAYS: ["min_days"],
    RuleType.BALANCED_DAILY_LOAD: ["max_difference"],
    RuleType.MAX_GAPS_PER_DAY: ["max"],
    RuleType.MAX_GAPS_PER_WEEK: ["max"],
    RuleType.SYNC_TRACKS: ["cluster_id"],
    RuleType.CLASS_DAY_LENGTH_LIMIT: ["max_periods"],
    RuleType.TEACHER_FIRST_LAST_PREFERENCE: ["prefer"],
    RuleType.GRADE_ACTIVITY_HOURS: ["periods_per_day_map"],
    RuleType.SHORT_DAYS_FLEXIBLE: ["num_short_days", "max_period_short"],
    RuleType.COMPACT_SCHOOL_DAY: ["min_periods"],
}

# Rules that can ONLY be SOFT (never HARD)
_SOFT_ONLY_RULES: set[RuleType] = {
    RuleType.PREFER_TIME_RANGE,
    RuleType.PREFER_TIMESLOT,
    RuleType.AVOID_LAST_PERIOD,
    RuleType.NO_CONSECUTIVE_DAYS,
    RuleType.SAME_DAY_GROUPING,
    RuleType.NOT_SAME_DAY_AS,
    RuleType.MIN_TEACHING_HOURS_PER_DAY,
    RuleType.BALANCED_DAILY_LOAD,
    RuleType.NO_GAPS,
    RuleType.MAX_GAPS_PER_DAY,
    RuleType.MAX_GAPS_PER_WEEK,
    RuleType.SYNC_TEACHER_CLASSES,
    RuleType.EARLY_FINISH,
    RuleType.MINIMIZE_TEACHER_DAYS,
    RuleType.TEACHER_FIRST_LAST_PREFERENCE,
}

# Rules that are ALWAYS HARD
_ALWAYS_HARD_RULES: set[RuleType] = {
    RuleType.SYNC_TRACKS,
    RuleType.GRADE_ACTIVITY_HOURS,
    RuleType.SHORT_DAYS_FLEXIBLE,
}


def _validate_constraint_data(
    rule_type: RuleType,
    constraint_type: ConstraintType,
    parameters: dict,
) -> list[str]:
    """Return list of validation error messages (empty = valid)."""
    errors: list[str] = []

    # Check type restrictions
    if rule_type in _SOFT_ONLY_RULES and constraint_type == ConstraintType.HARD:
        errors.append(f"כלל {rule_type.value} יכול להיות רק SOFT")
    if rule_type in _ALWAYS_HARD_RULES and constraint_type != ConstraintType.HARD:
        errors.append(f"כלל {rule_type.value} חייב להיות HARD")

    # Check required parameters
    required = _RULE_REQUIRED_PARAMS.get(rule_type, [])
    for param in required:
        if param not in parameters:
            errors.append(f"חסר פרמטר נדרש: {param}")

    return errors


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------


@router.post("", response_model=ConstraintRead, status_code=201)
def create_constraint(data: ConstraintCreate, db: Session = Depends(get_db)):
    errors = _validate_constraint_data(data.rule_type, data.type, data.parameters)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    constraint = Constraint(**data.model_dump())
    db.add(constraint)
    db.commit()
    db.refresh(constraint)
    return constraint


@router.get("", response_model=list[ConstraintRead])
def list_constraints(
    school_id: int | None = None,
    category: ConstraintCategory | None = None,
    rule_type: RuleType | None = None,
    is_active: bool | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Constraint)
    if school_id is not None:
        q = q.filter(Constraint.school_id == school_id)
    if category is not None:
        q = q.filter(Constraint.category == category)
    if rule_type is not None:
        q = q.filter(Constraint.rule_type == rule_type)
    if is_active is not None:
        q = q.filter(Constraint.is_active == is_active)
    return q.order_by(Constraint.created_at.desc()).all()


@router.get("/templates", response_model=list[ConstraintTemplateRead])
def list_templates():
    return [ConstraintTemplateRead(**t) for t in TEMPLATES]


@router.post("/from-template/{template_index}", response_model=ConstraintRead, status_code=201)
def create_from_template(
    template_index: int,
    school_id: int,
    target_type: TargetType,
    target_id: int | None = None,
    db: Session = Depends(get_db),
):
    if template_index < 0 or template_index >= len(TEMPLATES):
        raise HTTPException(status_code=404, detail="תבנית לא נמצאה")

    tmpl = TEMPLATES[template_index]
    constraint = Constraint(
        school_id=school_id,
        name=tmpl["name"],
        category=tmpl["category"],
        type=tmpl["default_type"],
        weight=tmpl["default_weight"],
        rule_type=tmpl["rule_type"],
        parameters=dict(tmpl["default_params"]),
        target_type=target_type,
        target_id=target_id,
        is_active=True,
    )
    db.add(constraint)
    db.commit()
    db.refresh(constraint)
    return constraint


@router.get("/validate")
def validate_constraints(school_id: int, db: Session = Depends(get_db)):
    """Pre-solve validation: check for conflicting or invalid constraints."""
    constraints = (
        db.query(Constraint)
        .filter(Constraint.school_id == school_id, Constraint.is_active == True)
        .all()
    )

    issues: list[dict] = []

    for c in constraints:
        # Validate each active constraint's data
        errors = _validate_constraint_data(
            RuleType(c.rule_type), ConstraintType(c.type), c.parameters
        )
        for err in errors:
            issues.append({
                "constraint_id": c.id,
                "constraint_name": c.name,
                "level": "error",
                "message": err,
            })

        # SOFT constraint with no weight warning
        if c.type == ConstraintType.SOFT and c.weight == 0:
            issues.append({
                "constraint_id": c.id,
                "constraint_name": c.name,
                "level": "warning",
                "message": "אילוץ רך עם משקל 0 — לא ישפיע על הפתרון",
            })

    # Detect duplicate BLOCK_DAY on same target+day
    block_days: dict[tuple, list[int]] = {}
    for c in constraints:
        if c.rule_type == RuleType.BLOCK_DAY:
            key = (c.target_type, c.target_id, c.parameters.get("day"))
            block_days.setdefault(key, []).append(c.id)
    for key, ids in block_days.items():
        if len(ids) > 1:
            issues.append({
                "constraint_ids": ids,
                "level": "warning",
                "message": f"חסימת יום כפולה: {key[2]} עבור {key[0]}#{key[1]}",
            })

    return {
        "total_active": len(constraints),
        "hard_count": sum(1 for c in constraints if c.type == ConstraintType.HARD),
        "soft_count": sum(1 for c in constraints if c.type == ConstraintType.SOFT),
        "issues": issues,
        "valid": all(i["level"] != "error" for i in issues),
    }


@router.get("/{constraint_id}", response_model=ConstraintRead)
def get_constraint(constraint_id: int, db: Session = Depends(get_db)):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="אילוץ לא נמצא")
    return constraint


@router.put("/{constraint_id}", response_model=ConstraintRead)
def update_constraint(
    constraint_id: int, data: ConstraintUpdate, db: Session = Depends(get_db)
):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="אילוץ לא נמצא")

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(constraint, key, value)

    # Re-validate after update
    errors = _validate_constraint_data(
        RuleType(constraint.rule_type),
        ConstraintType(constraint.type),
        constraint.parameters,
    )
    if errors:
        db.rollback()
        raise HTTPException(status_code=400, detail="; ".join(errors))

    db.commit()
    db.refresh(constraint)
    return constraint


@router.delete("/{constraint_id}", status_code=204)
def delete_constraint(constraint_id: int, db: Session = Depends(get_db)):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="אילוץ לא נמצא")
    db.delete(constraint)
    db.commit()


@router.patch("/{constraint_id}/toggle", response_model=ConstraintRead)
def toggle_constraint(
    constraint_id: int, body: ConstraintToggle, db: Session = Depends(get_db)
):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="אילוץ לא נמצא")
    constraint.is_active = body.is_active
    db.commit()
    db.refresh(constraint)
    return constraint


@router.patch("/{constraint_id}/weight", response_model=ConstraintRead)
def update_weight(
    constraint_id: int, body: ConstraintWeightUpdate, db: Session = Depends(get_db)
):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="אילוץ לא נמצא")
    if constraint.type != ConstraintType.SOFT:
        raise HTTPException(
            status_code=400, detail="ניתן לשנות משקל רק לאילוצים רכים"
        )
    constraint.weight = body.weight
    db.commit()
    db.refresh(constraint)
    return constraint
