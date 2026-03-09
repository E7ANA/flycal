"""Export endpoints for timetable solutions — Excel format."""

from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.class_group import ClassGroup
from app.models.meeting import Meeting, meeting_teachers
from app.models.school import School
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable import ScheduledLesson, ScheduledMeeting, Solution

router = APIRouter(prefix="/api", tags=["export"])

DAY_LABELS = {
    "SUNDAY": "ראשון",
    "MONDAY": "שני",
    "TUESDAY": "שלישי",
    "WEDNESDAY": "רביעי",
    "THURSDAY": "חמישי",
    "FRIDAY": "שישי",
}

DAYS_ORDER = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]


def _hex_to_rgb(hex_color: str) -> str:
    """Convert #RRGGBB to AARRGGBB for openpyxl."""
    h = hex_color.lstrip("#")
    if len(h) == 6:
        return f"FF{h}"
    return h


def _build_class_sheet(
    wb: Workbook,
    class_group: ClassGroup,
    lessons: list[ScheduledLesson],
    subject_map: dict[int, Subject],
    teacher_map: dict[int, Teacher],
    days: list[str],
    max_period: int,
) -> None:
    ws = wb.create_sheet(title=class_group.name[:31])

    # Header style
    header_font = Font(bold=True, size=11)
    header_fill = PatternFill("solid", fgColor="FFD9E1F2")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Write headers
    ws.cell(row=1, column=1, value="שעה").font = header_font
    ws.cell(row=1, column=1).fill = header_fill
    ws.cell(row=1, column=1).border = thin_border
    ws.column_dimensions["A"].width = 6

    for col_idx, day in enumerate(days, start=2):
        cell = ws.cell(row=1, column=col_idx, value=DAY_LABELS.get(day, day))
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = center_align
        ws.column_dimensions[chr(64 + col_idx)].width = 20

    # Build grid lookup
    grid: dict[tuple[str, int], ScheduledLesson] = {}
    for l in lessons:
        grid[(l.day, l.period)] = l

    # Fill periods
    for period in range(1, max_period + 1):
        row = period + 1
        cell = ws.cell(row=row, column=1, value=period)
        cell.font = Font(bold=True)
        cell.alignment = center_align
        cell.border = thin_border

        for col_idx, day in enumerate(days, start=2):
            cell = ws.cell(row=row, column=col_idx)
            cell.border = thin_border
            cell.alignment = center_align

            lesson = grid.get((day, period))
            if lesson:
                subj = subject_map.get(lesson.subject_id)
                teacher = teacher_map.get(lesson.teacher_id)
                subj_name = subj.name if subj else str(lesson.subject_id)
                teacher_name = teacher.name if teacher else ""
                cell.value = f"{subj_name}\n{teacher_name}"

                if subj and subj.color:
                    try:
                        fill_color = _hex_to_rgb(subj.color)
                        cell.fill = PatternFill("solid", fgColor=fill_color)
                    except Exception:
                        pass


def _build_teacher_sheet(
    wb: Workbook,
    teacher: Teacher,
    lessons: list[ScheduledLesson],
    subject_map: dict[int, Subject],
    class_map: dict[int, ClassGroup],
    days: list[str],
    max_period: int,
    teacher_meetings: list[tuple[ScheduledMeeting, Meeting]] | None = None,
) -> None:
    ws = wb.create_sheet(title=f"מורה - {teacher.name}"[:31])

    header_font = Font(bold=True, size=11)
    header_fill = PatternFill("solid", fgColor="FFE2EFDA")
    meeting_fill = PatternFill("solid", fgColor="FFE8DEF8")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)

    ws.cell(row=1, column=1, value="שעה").font = header_font
    ws.cell(row=1, column=1).fill = header_fill
    ws.cell(row=1, column=1).border = thin_border
    ws.column_dimensions["A"].width = 6

    for col_idx, day in enumerate(days, start=2):
        cell = ws.cell(row=1, column=col_idx, value=DAY_LABELS.get(day, day))
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = center_align
        ws.column_dimensions[chr(64 + col_idx)].width = 20

    grid: dict[tuple[str, int], ScheduledLesson] = {}
    for l in lessons:
        grid[(l.day, l.period)] = l

    # Build meeting grid for this teacher
    meeting_grid: dict[tuple[str, int], str] = {}
    if teacher_meetings:
        for sm, meeting in teacher_meetings:
            meeting_grid[(sm.day, sm.period)] = meeting.name

    for period in range(1, max_period + 1):
        row = period + 1
        cell = ws.cell(row=row, column=1, value=period)
        cell.font = Font(bold=True)
        cell.alignment = center_align
        cell.border = thin_border

        for col_idx, day in enumerate(days, start=2):
            cell = ws.cell(row=row, column=col_idx)
            cell.border = thin_border
            cell.alignment = center_align

            lesson = grid.get((day, period))
            meeting_name = meeting_grid.get((day, period))

            if lesson:
                subj = subject_map.get(lesson.subject_id)
                cg = class_map.get(lesson.class_group_id) if lesson.class_group_id else None
                subj_name = subj.name if subj else str(lesson.subject_id)
                class_name = cg.name if cg else ""
                cell.value = f"{subj_name}\n{class_name}"
            elif meeting_name:
                cell.value = meeting_name
                cell.fill = meeting_fill


@router.get("/solutions/{solution_id}/export/excel")
def export_excel(solution_id: int, db: Session = Depends(get_db)):
    """Export a solution as an Excel file with per-class and per-teacher sheets."""
    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")

    school = db.get(School, solution.school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית ספר לא נמצא")

    lessons = (
        db.query(ScheduledLesson)
        .filter(ScheduledLesson.solution_id == solution_id)
        .all()
    )

    # Load scheduled meetings
    scheduled_meetings = (
        db.query(ScheduledMeeting)
        .filter(ScheduledMeeting.solution_id == solution_id)
        .all()
    )

    # Load meeting definitions
    all_meetings = (
        db.query(Meeting).filter(Meeting.school_id == school.id).all()
    )
    meeting_map = {m.id: m for m in all_meetings}

    # Build teacher -> [(ScheduledMeeting, Meeting)] lookup
    teacher_meeting_lookup: dict[int, list[tuple[ScheduledMeeting, Meeting]]] = {}
    for sm in scheduled_meetings:
        meeting = meeting_map.get(sm.meeting_id)
        if not meeting:
            continue
        for t in meeting.teachers:
            teacher_meeting_lookup.setdefault(t.id, []).append((sm, meeting))

    # Load lookup data
    subjects = db.query(Subject).filter(Subject.school_id == school.id).all()
    subject_map = {s.id: s for s in subjects}

    teachers = db.query(Teacher).filter(Teacher.school_id == school.id).all()
    teacher_map = {t.id: t for t in teachers}

    classes = db.query(ClassGroup).filter(ClassGroup.school_id == school.id).all()
    class_map = {c.id: c for c in classes}

    days = DAYS_ORDER[: school.days_per_week]
    max_period = school.periods_per_day

    wb = Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    # Per-class sheets
    for cg in classes:
        class_lessons = [l for l in lessons if l.class_group_id == cg.id]
        if class_lessons:
            _build_class_sheet(wb, cg, class_lessons, subject_map, teacher_map, days, max_period)

    # Per-teacher sheets
    for teacher in teachers:
        teacher_lessons = [l for l in lessons if l.teacher_id == teacher.id]
        t_meetings = teacher_meeting_lookup.get(teacher.id)
        if teacher_lessons or t_meetings:
            _build_teacher_sheet(
                wb, teacher, teacher_lessons, subject_map, class_map,
                days, max_period, teacher_meetings=t_meetings,
            )

    # Write to buffer
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"timetable_solution_{solution_id}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
