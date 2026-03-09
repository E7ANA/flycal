from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.solver.scenario_engine import (
    compare_solutions,
    run_scenario_change_type,
    run_scenario_change_weight,
    run_scenario_toggle_constraint,
)

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


class ToggleScenarioRequest(BaseModel):
    school_id: int
    constraint_id: int
    new_active: bool
    scenario_name: str = "תרחיש"
    max_time: int | None = None


class WeightScenarioRequest(BaseModel):
    school_id: int
    constraint_id: int
    new_weight: int
    scenario_name: str = "תרחיש"
    max_time: int | None = None


class TypeScenarioRequest(BaseModel):
    school_id: int
    constraint_id: int
    new_type: str
    scenario_name: str = "תרחיש"
    max_time: int | None = None


class CompareRequest(BaseModel):
    solution_id_a: int
    solution_id_b: int


@router.post("/toggle")
def scenario_toggle(req: ToggleScenarioRequest, db: Session = Depends(get_db)):
    """Toggle a constraint on/off and re-solve to see impact."""
    result = run_scenario_toggle_constraint(
        db, req.school_id, req.constraint_id, req.new_active,
        req.scenario_name, req.max_time,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/weight")
def scenario_weight(req: WeightScenarioRequest, db: Session = Depends(get_db)):
    """Change a soft constraint weight and re-solve."""
    result = run_scenario_change_weight(
        db, req.school_id, req.constraint_id, req.new_weight,
        req.scenario_name, req.max_time,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/type")
def scenario_type(req: TypeScenarioRequest, db: Session = Depends(get_db)):
    """Switch constraint HARD/SOFT and re-solve."""
    result = run_scenario_change_type(
        db, req.school_id, req.constraint_id, req.new_type,
        req.scenario_name, req.max_time,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/compare")
def compare(req: CompareRequest, db: Session = Depends(get_db)):
    """Compare two solutions side-by-side."""
    result = compare_solutions(db, req.solution_id_a, req.solution_id_b)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
