"""Export endpoint — PDF format using WeasyPrint.

Generates a multi-page PDF with:
  - Class timetables (one per page)
  - Teacher timetables (one per page)
Styled with RTL Hebrew, subject colors, and clean grid layout.
"""

from io import BytesIO
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.class_group import ClassGroup, Grade, GroupingCluster, Track
from app.models.meeting import Meeting
from app.models.school import School
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable import ScheduledLesson, ScheduledMeeting, Solution

router = APIRouter(prefix="/api", tags=["export-pdf"], dependencies=[Depends(get_current_user)])

DAY_LABELS = {
    "SUNDAY": "ראשון",
    "MONDAY": "שני",
    "TUESDAY": "שלישי",
    "WEDNESDAY": "רביעי",
    "THURSDAY": "חמישי",
    "FRIDAY": "שישי",
}
DAYS_ORDER = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]


def _lighten(hex_color: str, factor: float = 0.35) -> str:
    """Lighten a hex color for background use."""
    try:
        h = hex_color.lstrip("#")
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
        r = min(255, int(r * factor + 255 * (1 - factor)))
        g = min(255, int(g * factor + 255 * (1 - factor)))
        b = min(255, int(b * factor + 255 * (1 - factor)))
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return "#f0f0f0"


def _border_color(hex_color: str) -> str:
    """Slightly darker version of the subject color for left border."""
    try:
        h = hex_color.lstrip("#")
        r = int(int(h[0:2], 16) * 0.7)
        g = int(int(h[2:4], 16) * 0.7)
        b = int(int(h[4:6], 16) * 0.7)
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return "#999999"


_CSS = """
@page {
    size: A4 landscape;
    margin: 12mm 10mm;
}
* { box-sizing: border-box; }
body {
    font-family: "Rubik", "Arial", "Helvetica", sans-serif;
    direction: rtl;
    font-size: 9pt;
    color: #1a1a1a;
    margin: 0;
}
.page {
    page-break-after: always;
    page-break-inside: avoid;
}
.page:last-child { page-break-after: auto; }

h2 {
    font-size: 16pt;
    margin: 0 0 6pt 0;
    color: #1e293b;
}
.subtitle {
    font-size: 10pt;
    color: #64748b;
    margin: 0 0 8pt 0;
}

table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}
th, td {
    border: 1px solid #d1d5db;
    padding: 3pt 4pt;
    text-align: center;
    vertical-align: middle;
    overflow: hidden;
    word-wrap: break-word;
}
th {
    background: #f1f5f9;
    font-weight: 700;
    font-size: 9pt;
    color: #334155;
    padding: 4pt;
}
th.period-col {
    width: 28pt;
    background: #e2e8f0;
}
td.period-cell {
    background: #f8fafc;
    font-weight: 700;
    color: #64748b;
    width: 28pt;
}
td.empty {
    background: #fafafa;
    color: #d1d5db;
}
td.lesson {
    font-size: 8pt;
    line-height: 1.3;
    border-right: 3px solid #3b82f6;
}
td.lesson .subj {
    font-weight: 700;
    font-size: 8.5pt;
}
td.lesson .teacher, td.lesson .class-name {
    color: #475569;
    font-size: 7.5pt;
}
td.lesson .track {
    color: #92400e;
    font-size: 7pt;
}
td.meeting-cell {
    background: #f0e8fa;
    color: #7c3aed;
    font-weight: 700;
    font-size: 8pt;
}

/* Class header style */
.class-header { color: #1e40af; }
.teacher-header { color: #166534; }
"""


def _build_grid(
    lessons: list[ScheduledLesson],
) -> dict[tuple[str, int], list[ScheduledLesson]]:
    grid: dict[tuple[str, int], list[ScheduledLesson]] = {}
    for lesson in lessons:
        grid.setdefault((lesson.day, lesson.period), []).append(lesson)
    return grid


def _render_class_page(
    cg: ClassGroup,
    lessons: list[ScheduledLesson],
    subject_map: dict[int, Subject],
    teacher_map: dict[int, Teacher],
    track_map: dict[int, Track],
    days: list[str],
    max_period: int,
    meeting_grid: dict[tuple[str, int], list[str]] | None = None,
) -> str:
    grid = _build_grid(lessons)
    html = f'<div class="page">\n'
    html += f'<h2 class="class-header">{escape(cg.name)}</h2>\n'
    html += '<table>\n<thead><tr>'
    html += '<th class="period-col">שעה</th>'
    for day in days:
        html += f"<th>{DAY_LABELS.get(day, day)}</th>"
    html += "</tr></thead>\n<tbody>\n"

    for period in range(1, max_period + 1):
        html += f'<tr><td class="period-cell">{period}</td>'
        for day in days:
            slot = grid.get((day, period), [])
            mtg_names = (meeting_grid or {}).get((day, period), [])
            if slot:
                # Use first lesson's subject color
                subj = subject_map.get(slot[0].subject_id)
                color = (subj.color if subj and subj.color else "#3b82f6")
                bg = _lighten(color)
                border = _border_color(color)
                lines = []
                for lesson in slot:
                    s = subject_map.get(lesson.subject_id)
                    t = teacher_map.get(lesson.teacher_id)
                    tr = track_map.get(lesson.track_id) if lesson.track_id else None
                    sname = escape(s.name) if s else ""
                    tname = escape(t.name) if t else ""
                    line = f'<span class="subj">{sname}</span>'
                    if tr:
                        line += f'<br><span class="track">{escape(tr.name)}</span>'
                    line += f'<br><span class="teacher">{tname}</span>'
                    lines.append(line)
                cell_html = "<br>".join(lines)
                html += (
                    f'<td class="lesson" style="background:{bg};'
                    f'border-right:3px solid {border}">{cell_html}</td>'
                )
            elif mtg_names:
                html += f'<td class="meeting-cell">{escape(", ".join(mtg_names))}</td>'
            else:
                html += '<td class="empty"></td>'
        html += "</tr>\n"

    html += "</tbody></table>\n</div>\n"
    return html


def _render_teacher_page(
    teacher: Teacher,
    lessons: list[ScheduledLesson],
    subject_map: dict[int, Subject],
    class_map: dict[int, ClassGroup],
    track_map: dict[int, Track],
    days: list[str],
    max_period: int,
    meeting_grid: dict[tuple[str, int], str] | None = None,
) -> str:
    grid = _build_grid(lessons)
    total_lessons = len(lessons)
    unique_days = len({l.day for l in lessons})

    html = f'<div class="page">\n'
    html += f'<h2 class="teacher-header">{escape(teacher.name)}</h2>\n'
    html += f'<p class="subtitle">{total_lessons} שיעורים | {unique_days} ימי הוראה</p>\n'
    html += '<table>\n<thead><tr>'
    html += '<th class="period-col">שעה</th>'
    for day in days:
        html += f"<th>{DAY_LABELS.get(day, day)}</th>"
    html += "</tr></thead>\n<tbody>\n"

    for period in range(1, max_period + 1):
        html += f'<tr><td class="period-cell">{period}</td>'
        for day in days:
            slot = grid.get((day, period), [])
            mtg_name = (meeting_grid or {}).get((day, period))
            if slot:
                subj = subject_map.get(slot[0].subject_id)
                color = (subj.color if subj and subj.color else "#3b82f6")
                bg = _lighten(color)
                border = _border_color(color)
                lines = []
                for lesson in slot:
                    s = subject_map.get(lesson.subject_id)
                    cg = class_map.get(lesson.class_group_id) if lesson.class_group_id else None
                    tr = track_map.get(lesson.track_id) if lesson.track_id else None
                    sname = escape(s.name) if s else ""
                    cname = escape(cg.name) if cg else ""
                    line = f'<span class="subj">{sname}</span>'
                    if tr:
                        line += f'<br><span class="track">{escape(tr.name)}</span>'
                    line += f'<br><span class="class-name">{cname}</span>'
                    lines.append(line)
                cell_html = "<br>".join(lines)
                html += (
                    f'<td class="lesson" style="background:{bg};'
                    f'border-right:3px solid {border}">{cell_html}</td>'
                )
            elif mtg_name:
                html += f'<td class="meeting-cell">{escape(mtg_name)}</td>'
            else:
                html += '<td class="empty"></td>'
        html += "</tr>\n"

    html += "</tbody></table>\n</div>\n"
    return html


@router.get("/solutions/{solution_id}/export/pdf")
def export_pdf(solution_id: int, db: Session = Depends(get_db)):
    """Export a solution as a styled PDF document."""
    from weasyprint import HTML

    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")

    school = db.get(School, solution.school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית ספר לא נמצא")

    # Load all data (same as Excel export)
    lessons = (
        db.query(ScheduledLesson)
        .filter(ScheduledLesson.solution_id == solution_id)
        .all()
    )
    scheduled_meetings = (
        db.query(ScheduledMeeting)
        .filter(ScheduledMeeting.solution_id == solution_id)
        .all()
    )
    all_meetings = db.query(Meeting).filter(Meeting.school_id == school.id).all()
    meeting_map = {m.id: m for m in all_meetings}

    subjects = db.query(Subject).filter(Subject.school_id == school.id).all()
    subject_map = {s.id: s for s in subjects}

    teachers = db.query(Teacher).filter(Teacher.school_id == school.id).all()
    teacher_map = {t.id: t for t in teachers}

    classes = db.query(ClassGroup).filter(ClassGroup.school_id == school.id).all()
    class_map = {c.id: c for c in classes}

    grades = db.query(Grade).filter(Grade.school_id == school.id).all()
    grade_map = {g.id: g for g in grades}

    clusters = db.query(GroupingCluster).filter(GroupingCluster.school_id == school.id).all()
    track_map: dict[int, Track] = {}
    for cluster in clusters:
        for track in cluster.tracks:
            track_map[track.id] = track

    # Build teacher -> meetings lookup
    teacher_meeting_grid: dict[int, dict[tuple[str, int], str]] = {}
    for sm in scheduled_meetings:
        meeting = meeting_map.get(sm.meeting_id)
        if not meeting:
            continue
        for t in meeting.teachers:
            teacher_meeting_grid.setdefault(t.id, {})[(sm.day, sm.period)] = meeting.name

    # Class meeting grid (for showing meetings on class pages)
    # Meetings visible to all classes
    class_meeting_grid: dict[tuple[str, int], list[str]] = {}
    for sm in scheduled_meetings:
        meeting = meeting_map.get(sm.meeting_id)
        if meeting:
            class_meeting_grid.setdefault((sm.day, sm.period), []).append(meeting.name)

    days = DAYS_ORDER[: school.days_per_week]
    max_period = school.periods_per_day

    # Build HTML document
    html_parts: list[str] = []
    html_parts.append(f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<style>{_CSS}</style>
</head>
<body>
""")

    # Class timetables
    sorted_classes = sorted(
        classes,
        key=lambda c: (
            grade_map[c.grade_id].level if c.grade_id in grade_map else 0,
            c.name,
        ),
    )
    for cg in sorted_classes:
        class_lessons = [l for l in lessons if l.class_group_id == cg.id]
        # Also include track lessons that belong to this class
        track_lessons_for_class: list[ScheduledLesson] = []
        for cluster in clusters:
            source_ids = {sc.id for sc in cluster.source_classes}
            if cg.id not in source_ids:
                continue
            for track in cluster.tracks:
                if track.teacher_id is None:
                    continue
                for l in lessons:
                    if l.track_id == track.id:
                        track_lessons_for_class.append(l)

        all_class_lessons = class_lessons + track_lessons_for_class
        # Deduplicate by (day, period, track_id/subject_id)
        seen: set[str] = set()
        deduped: list[ScheduledLesson] = []
        for l in all_class_lessons:
            key = f"{l.day}_{l.period}_{l.track_id or ''}_{l.subject_id}_{l.teacher_id}"
            if key not in seen:
                seen.add(key)
                deduped.append(l)

        if deduped:
            html_parts.append(_render_class_page(
                cg, deduped, subject_map, teacher_map, track_map,
                days, max_period, meeting_grid=class_meeting_grid,
            ))

    # Teacher timetables
    sorted_teachers = sorted(teachers, key=lambda t: t.name)
    for teacher in sorted_teachers:
        teacher_lessons = [l for l in lessons if l.teacher_id == teacher.id]
        t_mtg_grid = teacher_meeting_grid.get(teacher.id)
        if teacher_lessons or t_mtg_grid:
            html_parts.append(_render_teacher_page(
                teacher, teacher_lessons, subject_map, class_map,
                track_map, days, max_period, meeting_grid=t_mtg_grid,
            ))

    html_parts.append("</body></html>")
    full_html = "\n".join(html_parts)

    # Convert to PDF
    pdf_bytes = HTML(string=full_html).write_pdf()

    buf = BytesIO(pdf_bytes)
    buf.seek(0)

    filename = f"timetable_solution_{solution_id}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
