from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from app.models.constraint import (
    ConstraintCategory,
    ConstraintType,
    RuleType,
    TargetType,
)


class ConstraintCreate(BaseModel):
    school_id: int
    name: str
    description: str | None = None
    category: ConstraintCategory
    type: ConstraintType
    weight: int = 50
    rule_type: RuleType
    parameters: dict[str, Any] = {}
    target_type: TargetType
    target_id: int | None = None
    is_active: bool = True
    notes: str | None = None

    @field_validator("weight")
    @classmethod
    def weight_range(cls, v: int) -> int:
        if not 1 <= v <= 100:
            raise ValueError("weight חייב להיות בין 1 ל-100")
        return v


class ConstraintUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: ConstraintCategory | None = None
    type: ConstraintType | None = None
    weight: int | None = None
    rule_type: RuleType | None = None
    parameters: dict[str, Any] | None = None
    target_type: TargetType | None = None
    target_id: int | None = None
    is_active: bool | None = None
    notes: str | None = None

    @field_validator("weight")
    @classmethod
    def weight_range(cls, v: int | None) -> int | None:
        if v is not None and not 1 <= v <= 100:
            raise ValueError("weight חייב להיות בין 1 ל-100")
        return v


class ConstraintRead(BaseModel):
    id: int
    school_id: int
    name: str
    description: str | None
    category: ConstraintCategory
    type: ConstraintType
    weight: int
    rule_type: RuleType
    parameters: dict[str, Any]
    target_type: TargetType
    target_id: int | None
    is_active: bool
    created_at: datetime
    notes: str | None

    model_config = {"from_attributes": True}


class ConstraintToggle(BaseModel):
    is_active: bool


class ConstraintWeightUpdate(BaseModel):
    weight: int

    @field_validator("weight")
    @classmethod
    def weight_range(cls, v: int) -> int:
        if not 1 <= v <= 100:
            raise ValueError("weight חייב להיות בין 1 ל-100")
        return v


class ConstraintTemplateRead(BaseModel):
    name: str
    rule_type: RuleType
    category: ConstraintCategory
    default_type: ConstraintType
    default_weight: int = 50
    default_params: dict[str, Any] = {}
