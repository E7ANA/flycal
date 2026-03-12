import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.database import get_db, SessionLocal
from app.dependencies import get_current_user, require_super_admin
from app.solver.scenario_engine import (
    compare_solutions,
    run_scenario_change_type,
    run_scenario_change_weight,
    run_scenario_edit,
    run_scenario_toggle_constraint,
)

log = logging.getLogger("scenarios")

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"], dependencies=[Depends(require_super_admin)])


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


class EditAction(BaseModel):
    type: str  # "PIN_LESSON" | "BLOCK_TEACHER_SLOT" | "PIN_TEACHER_DAY_CONSECUTIVE"
    params: dict


class EditScenarioRequest(BaseModel):
    school_id: int
    baseline_solution_id: int
    edits: list[EditAction]
    scenario_name: str = "עריכת תרחיש"
    max_time: int | None = None
    deviation_weight: int = 10


class SmartEditRequest(BaseModel):
    school_id: int
    baseline_solution_id: int
    prompt: str  # Free-text description of the desired change
    max_time: int | None = None
    deviation_weight: int = 10


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


@router.post("/edit")
def scenario_edit(req: EditScenarioRequest, db: Session = Depends(get_db)):
    """Apply edits on an existing solution and re-solve with minimal changes."""
    edits_raw = [{"type": e.type, "params": e.params} for e in req.edits]
    result = run_scenario_edit(
        db, req.school_id, req.baseline_solution_id, edits_raw,
        req.scenario_name, req.max_time, req.deviation_weight,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/smart-edit")
def smart_edit(req: SmartEditRequest, db: Session = Depends(get_db)):
    """Parse a free-text edit request using Claude AI and run the scenario."""
    from app.services.ai_parser import parse_edit_request

    # Step 1: Parse free text into structured edits
    parsed = parse_edit_request(db, req.school_id, req.prompt)
    if "error" in parsed:
        raise HTTPException(status_code=400, detail=parsed["error"])

    edits = parsed.get("edits", [])
    if not edits:
        raise HTTPException(status_code=400, detail="לא זוהו שינויים בבקשה")

    description = parsed.get("description", req.prompt)

    # Step 2: Run the edit scenario
    result = run_scenario_edit(
        db, req.school_id, req.baseline_solution_id, edits,
        description, req.max_time, req.deviation_weight,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    # Add the parsed info to the response
    result["parsed_edits"] = edits
    result["ai_description"] = description
    return result


@router.post("/parse-edit")
def parse_edit_only(req: SmartEditRequest, db: Session = Depends(get_db)):
    """Parse a free-text edit request using Claude AI without running the solver.
    Useful for previewing what changes will be made."""
    from app.services.ai_parser import parse_edit_request

    parsed = parse_edit_request(db, req.school_id, req.prompt)
    if "error" in parsed:
        raise HTTPException(status_code=400, detail=parsed["error"])
    return parsed


@router.post("/smart-edit-stream")
async def smart_edit_stream(request: Request):
    """SSE streaming endpoint for smart edit — sends progress events as the pipeline runs."""

    body = await request.json()
    school_id = body.get("school_id")
    baseline_solution_id = body.get("baseline_solution_id")
    prompt = body.get("prompt", "")
    max_time = body.get("max_time")
    deviation_weight = body.get("deviation_weight", 10)
    conversation = body.get("conversation")

    def sse_event(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    def generate():
        db = SessionLocal()
        try:
            # Step 1: Parsing
            yield sse_event({"step": "parsing", "message": "מנתח את הבקשה שלך..."})

            # Step 2: AI thinking
            yield sse_event({"step": "ai_thinking", "message": "AI מעבד את הבקשה..."})

            from app.services.ai_parser import parse_edit_request

            parsed = parse_edit_request(db, school_id, prompt, conversation=conversation)

            if "error" in parsed:
                yield sse_event({"step": "error", "message": parsed["error"]})
                return

            token_usage = parsed.get("token_usage")

            # Check if AI needs clarification
            if "clarification" in parsed:
                yield sse_event({
                    "step": "clarification",
                    "message": parsed["clarification"],
                    "token_usage": token_usage,
                })
                return

            edits = parsed.get("edits", [])
            description = parsed.get("description", prompt)

            if not edits:
                yield sse_event({"step": "error", "message": "לא זוהו שינויים בבקשה"})
                return

            # Step 3: AI result
            yield sse_event({
                "step": "ai_result",
                "message": "AI סיים ניתוח",
                "edits": edits,
                "description": description,
                "token_usage": token_usage,
            })

            # Step 4: Building model
            yield sse_event({"step": "building_model", "message": "בונה מודל סולבר..."})

            # Step 5: Solving
            yield sse_event({"step": "solving", "message": "פותר...", "progress": 10})

            result = run_scenario_edit(
                db, school_id, baseline_solution_id, edits,
                description, max_time, deviation_weight,
            )

            if "error" in result:
                yield sse_event({"step": "error", "message": result["error"]})
                return

            yield sse_event({"step": "solving", "message": "פותר...", "progress": 100})

            # Step 6: Done
            result["parsed_edits"] = edits
            result["ai_description"] = description
            result["token_usage"] = token_usage

            yield sse_event({"step": "done", "result": result})

        except Exception as e:
            log.error(f"Smart edit stream error: {e}")
            yield sse_event({"step": "error", "message": f"שגיאה: {e}"})
        finally:
            db.close()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/compare")
def compare(req: CompareRequest, db: Session = Depends(get_db)):
    """Compare two solutions side-by-side."""
    result = compare_solutions(db, req.solution_id_a, req.solution_id_b)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
