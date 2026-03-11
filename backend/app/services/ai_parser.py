"""Parse free-text schedule edit requests into structured edit actions using Claude."""

from __future__ import annotations

import json
import logging

import anthropic
from sqlalchemy.orm import Session

from app.config import settings
from app.models.teacher import Teacher
from app.models.class_group import ClassGroup
from app.models.subject import Subject, SubjectRequirement
from app.models.meeting import Meeting
from app.models.timeslot import TimeSlot

log = logging.getLogger("ai_parser")

DAY_MAP = {
    "ראשון": "SUNDAY",
    "שני": "MONDAY",
    "שלישי": "TUESDAY",
    "רביעי": "WEDNESDAY",
    "חמישי": "THURSDAY",
    "שישי": "FRIDAY",
    "sunday": "SUNDAY",
    "monday": "MONDAY",
    "tuesday": "TUESDAY",
    "wednesday": "WEDNESDAY",
    "thursday": "THURSDAY",
    "friday": "FRIDAY",
}


def _build_school_context(db: Session, school_id: int) -> str:
    """Build a concise description of available entities for the LLM."""
    teachers = db.query(Teacher).filter(Teacher.school_id == school_id).all()
    classes = db.query(ClassGroup).filter(ClassGroup.school_id == school_id).all()
    subjects = db.query(Subject).filter(Subject.school_id == school_id).all()
    meetings = (
        db.query(Meeting)
        .filter(Meeting.school_id == school_id, Meeting.is_active == True)
        .all()
    )
    requirements = (
        db.query(SubjectRequirement)
        .filter(SubjectRequirement.school_id == school_id)
        .all()
    )

    lines = []
    lines.append("מורים:")
    for t in teachers:
        lines.append(f"  - id={t.id}, שם=\"{t.name}\"")

    lines.append("\nכיתות:")
    for c in classes:
        lines.append(f"  - id={c.id}, שם=\"{c.name}\"")

    lines.append("\nמקצועות:")
    for s in subjects:
        lines.append(f"  - id={s.id}, שם=\"{s.name}\"")

    lines.append("\nישיבות:")
    for m in meetings:
        teacher_names = ", ".join(t.name for t in m.teachers)
        lines.append(
            f"  - id={m.id}, שם=\"{m.name}\", שעות={m.hours_per_week}, מורים=[{teacher_names}]"
        )

    lines.append("\nשיבוצים (מורה → מקצוע → כיתה):")
    for r in requirements[:50]:  # Limit to avoid huge context
        if r.teacher_id and not r.is_grouped:
            t_name = next((t.name for t in teachers if t.id == r.teacher_id), f"#{r.teacher_id}")
            s_name = next((s.name for s in subjects if s.id == r.subject_id), f"#{r.subject_id}")
            c_name = next((c.name for c in classes if c.id == r.class_group_id), f"#{r.class_group_id}")
            lines.append(f"  - {t_name} מלמד/ת {s_name} ב{c_name} ({r.hours_per_week} ש\"ש)")

    lines.append("\nימים אפשריים: SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY")
    lines.append("שעות אפשריות: 1-10 (תלוי בבית הספר)")

    return "\n".join(lines)


SYSTEM_PROMPT = """\
אתה מנתח בקשות עריכה למערכת שעות בית ספר.
המשתמש מתאר שינוי שהוא רוצה לבצע במערכת קיימת — תפקידך לתרגם את הבקשה למבנה JSON מדויק.

סוגי שינויים אפשריים:

1. PIN_TEACHER_DAY_CONSECUTIVE — מורה חייב/ת ללמד N שעות רצופות ביום מסוים
   params: { "teacher_id": int, "day": str, "consecutive_count": int }

2. BLOCK_TEACHER_SLOT — חסום מורה ממשבצת מסוימת (לא ילמד שם)
   params: { "teacher_id": int, "day": str, "period": int }

3. PIN_LESSON — הצמד שיעור ספציפי (כיתה+מקצוע+מורה) למשבצת
   params: { "class_id": int, "subject_id": int, "teacher_id": int, "day": str, "period": int }

4. PIN_MEETING_DAY — קבע ישיבה ליום מסוים
   params: { "meeting_id": int, "day": str }

אם הבקשה לא ברורה, חסרים פרטים, או שאתה צריך הבהרה — החזר שאלת הבהרה:
{
  "clarification": "שאלה למשתמש בעברית"
}

אם הבקשה ברורה — החזר JSON בפורמט הבא (ללא markdown, ללא הסבר):
{
  "edits": [
    { "type": "...", "params": { ... } }
  ],
  "description": "תיאור קצר של השינוי בעברית"
}

או במקרה של שגיאה טכנית (לא ניתן למימוש):
{
  "error": "הסבר מה לא ברור"
}
"""


def parse_edit_request(
    db: Session,
    school_id: int,
    user_text: str,
    conversation: list[dict] | None = None,
) -> dict:
    """Use Claude to parse a free-text edit request into structured actions.

    Returns: {"edits": [...], "description": "...", "token_usage": {...}}
             or {"clarification": "...", "token_usage": {...}}
             or {"error": "..."}
    """
    if not settings.anthropic_api_key:
        return {"error": "מפתח API של Anthropic לא מוגדר (ANTHROPIC_API_KEY)"}

    context = _build_school_context(db, school_id)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Build messages list — support multi-turn clarification
    if conversation and len(conversation) > 0:
        messages = []
        for msg in conversation:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user" and not messages:
                # First user message gets the school context prepended
                content = f"נתוני בית הספר:\n{context}\n\n---\nבקשת השינוי:\n{content}"
            messages.append({"role": role, "content": content})
    else:
        messages = [
            {
                "role": "user",
                "content": f"נתוני בית הספר:\n{context}\n\n---\nבקשת השינוי:\n{user_text}",
            }
        ]

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=messages,
        )

        # Extract token usage
        token_usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }

        # Extract text from response
        text = response.content[0].text.strip()

        # Parse JSON (handle possible markdown fences)
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        result = json.loads(text)
        result["token_usage"] = token_usage
        log.info(f"AI parsed edit request: {result}")
        return result

    except json.JSONDecodeError as e:
        log.error(f"AI returned invalid JSON: {e}")
        return {"error": f"תשובת AI לא תקינה: {e}"}
    except anthropic.APIError as e:
        log.error(f"Anthropic API error: {e}")
        return {"error": f"שגיאת API: {e}"}
    except Exception as e:
        log.error(f"AI parse error: {e}")
        return {"error": f"שגיאה בניתוח: {e}"}
