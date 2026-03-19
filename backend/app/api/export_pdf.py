"""Export endpoint — PDF format using WeasyPrint.

Layout per page:
  - Class timetables (one per page, no meetings)
  - Teacher timetables (one per page, WITH meetings + full teacher details)
  - Meetings timetable (separate page at the end)

Design matches the web UI: light pastel backgrounds, colored right border (RTL start),
bold subject name, muted teacher name. Grouped/shared lessons merged with ' / '.
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


def _lighten(hex_color: str, factor: float = 0.18) -> str:
    """Return a very light tint of hex_color (factor=0 → white, 1 → original)."""
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


def _border_color(hex_color: str, factor: float = 0.75) -> str:
    """Slightly muted version of color for the border."""
    try:
        h = hex_color.lstrip("#")
        r = int(int(h[0:2], 16) * factor)
        g = int(int(h[2:4], 16) * factor)
        b = int(int(h[4:6], 16) * factor)
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return "#999999"


_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&display=swap');

@page {
    size: A4 landscape;
    margin: 10mm 10mm 10mm 10mm;
}
* { box-sizing: border-box; }
body {
    font-family: "Rubik", "Arial", "Helvetica", sans-serif;
    direction: rtl;
    font-size: 8.5pt;
    color: #1a1a1a;
    margin: 0;
    background: #ffffff;
}

/* ── Page container ── */
.page {
    page-break-after: always;
    page-break-inside: avoid;
    height: 187mm;
    overflow: hidden;
}
.page:last-child { page-break-after: auto; }

/* ── Page header ── */
.page-header {
    margin-bottom: 4pt;
}
h2 {
    font-size: 15pt;
    font-weight: 700;
    margin: 0 0 2pt 0;
    color: #1e293b;
    line-height: 1.2;
}
.class-header  { color: #1e40af; }
.teacher-header { color: #166534; }
.meetings-header { color: #6d28d9; }

.teacher-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6pt 14pt;
    font-size: 7.5pt;
    color: #475569;
    margin-bottom: 3pt;
    padding: 3pt 5pt;
    background: #f8fafc;
    border-radius: 3pt;
    border: 1px solid #e2e8f0;
}
.teacher-meta span { white-space: nowrap; }
.teacher-meta .label { color: #94a3b8; margin-left: 2pt; }

/* ── Timetable grid ── */
table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}
th {
    background: #f1f5f9;
    font-weight: 700;
    font-size: 8pt;
    color: #334155;
    padding: 4pt 3pt;
    border: 1px solid #cbd5e1;
    text-align: center;
}
th.period-col {
    width: 20pt;
    background: #e2e8f0;
    color: #475569;
}
td {
    border: 1px solid #e2e8f0;
    padding: 2pt;
    vertical-align: top;
    text-align: center;
}
td.period-cell {
    background: #f8fafc;
    font-weight: 700;
    font-size: 7.5pt;
    color: #64748b;
    text-align: center;
    vertical-align: middle;
    width: 20pt;
}
td.empty {
    background: #fafafa;
}

/* ── Lesson card inside a cell ── */
.lesson-card {
    border-radius: 3pt;
    padding: 2pt 4pt;
    margin-bottom: 2pt;
    text-align: right;
    border-right: 3px solid #3b82f6;
    line-height: 1.35;
    overflow: hidden;
}
.lesson-card .subj {
    font-weight: 700;
    font-size: 7.5pt;
    color: #0f172a;
    display: block;
    white-space: nowrap;
    overflow: hidden;
}
.lesson-card .grouped-label {
    font-size: 6.5pt;
    font-weight: 400;
    color: #64748b;
}
.lesson-card .people {
    font-size: 6.5pt;
    color: #475569;
    display: block;
    white-space: nowrap;
    overflow: hidden;
}

/* ── Meeting card ── */
.meeting-card {
    border-radius: 3pt;
    padding: 2pt 4pt;
    margin-bottom: 2pt;
    text-align: right;
    background: #ede9fe;
    border-right: 3px solid #7c3aed;
    line-height: 1.35;
    overflow: hidden;
}
.meeting-card .subj {
    font-weight: 700;
    font-size: 7.5pt;
    color: #4c1d95;
    display: block;
}
.meeting-card .people {
    font-size: 6.5pt;
    color: #5b21b6;
    display: block;
}
"""


def _build_grid(
    lessons: list[ScheduledLesson],
) -> dict[tuple[str, int], list[ScheduledLesson]]:
    grid: dict[tuple[str, int], list[ScheduledLesson]] = {}
    for lesson in lessons:
        grid.setdefault((lesson.day, lesson.period), []).append(lesson)
    return grid


def _lesson_card_html(
    slot: list[ScheduledLesson],
    subject_map: dict[int, Subject],
    teacher_map: dict[int, Teacher],
    class_map: dict[int, ClassGroup],
    track_map: dict[int, Track],
    show_class: bool = False,
) -> str:
    """Render a single lesson card div for one slot (may contain multiple grouped lessons)."""
    subj0 = subject_map.get(slot[0].subject_id)
    color = (subj0.color if subj0 and subj0.color else "#3b82f6")
    bg = _lighten(color, 0.15)
    border = _border_color(color, 0.65)

    is_grouped = any(l.track_id for l in slot)

    if len(slot) > 1:
        prefix = '<span class="grouped-label">הקבצה </span>' if is_grouped else ""
        subj_names = " / ".join(
            escape(subject_map[l.subject_id].name) if l.subject_id in subject_map else ""
            for l in slot
        )
        if show_class:
            people = " / ".join(
                escape(class_map[l.class_group_id].name)
                if l.class_group_id and l.class_group_id in class_map else ""
                for l in slot
            )
        else:
            people = " / ".join(
                escape(teacher_map[l.teacher_id].name) if l.teacher_id in teacher_map else ""
                for l in slot
            )
        subj_html = f'<span class="subj">{prefix}{escape(subj_names) if not prefix else subj_names}</span>'
    else:
        lesson = slot[0]
        s = subject_map.get(lesson.subject_id)
        sname = escape(s.name) if s else ""
        prefix = '<span class="grouped-label">הקבצה </span>' if is_grouped else ""
        subj_html = f'<span class="subj">{prefix}{sname}</span>'
        if show_class:
            cg = class_map.get(lesson.class_group_id) if lesson.class_group_id else None
            people = escape(cg.name) if cg else ""
        else:
            t = teacher_map.get(lesson.teacher_id)
            people = escape(t.name) if t else ""

    return (
        f'<div class="lesson-card" style="background:{bg};border-right-color:{border}">'
        f'{subj_html}'
        f'<span class="people">{people}</span>'
        f'</div>'
    )


def _meeting_card_html(meeting_name: str) -> str:
    return (
        f'<div class="meeting-card">'
        f'<span class="subj">{escape(meeting_name)}</span>'
        f'</div>'
    )


def _render_class_page(
    cg: ClassGroup,
    lessons: list[ScheduledLesson],
    subject_map: dict[int, Subject],
    teacher_map: dict[int, Teacher],
    class_map: dict[int, ClassGroup],
    track_map: dict[int, Track],
    days: list[str],
    max_period: int,
) -> str:
    """One page per class — no meetings."""
    grid = _build_grid(lessons)
    html = '<div class="page">\n<div class="page-header">'
    html += f'<h2 class="class-header">{escape(cg.name)}</h2>'
    html += '</div>\n'
    html += '<table>\n<thead><tr>'
    html += '<th class="period-col">שעה</th>'
    for day in days:
        html += f"<th>{DAY_LABELS.get(day, day)}</th>"
    html += "</tr></thead>\n<tbody>\n"

    for period in range(1, max_period + 1):
        html += f'<tr><td class="period-cell">{period}</td>'
        for day in days:
            slot = grid.get((day, period), [])
            if slot:
                html += f'<td>{_lesson_card_html(slot, subject_map, teacher_map, class_map, track_map, show_class=False)}</td>'
            else:
                html += '<td class="empty"></td>'
        html += "</tr>\n"

    html += "</tbody></table>\n</div>\n"
    return html


def _build_teacher_meta_html(
    teacher: Teacher,
    class_map: dict[int, ClassGroup],
    total_lessons: int,
    unique_days: int,
) -> str:
    """Build the details bar below the teacher name."""
    parts: list[tuple[str, str]] = []

    # Subjects
    if teacher.subjects:
        parts.append(("מקצועות", ", ".join(escape(s.name) for s in teacher.subjects)))

    # Homeroom
    if teacher.homeroom_class_id and teacher.homeroom_class_id in class_map:
        parts.append(("מחנכ/ת", escape(class_map[teacher.homeroom_class_id].name)))

    # Roles
    roles = []
    if teacher.is_coordinator: roles.append("רכז/ת")
    if teacher.is_pedagogical_coordinator: roles.append("רכז/ת פדגוגי")
    if teacher.is_counselor: roles.append("יועץ/ת")
    if teacher.is_management: roles.append("הנהלה")
    if teacher.is_principal: roles.append("מנהל/ת")
    if teacher.is_director: roles.append("מנכ\"ל")
    if roles:
        parts.append(("תפקיד", " | ".join(roles)))

    # Hours
    if teacher.min_hours_per_week:
        parts.append(("שעות", f"{teacher.min_hours_per_week}–{teacher.max_hours_per_week}"))
    else:
        parts.append(("שעות מקס׳", str(teacher.max_hours_per_week)))

    if teacher.employment_percentage is not None:
        pct = int(round(teacher.employment_percentage * 100)) if teacher.employment_percentage <= 1 else int(round(teacher.employment_percentage))
        parts.append(("תעסוקה", f"{pct}%"))

    if teacher.rubrica_hours is not None:
        parts.append(("רובריקה", str(teacher.rubrica_hours)))

    if teacher.max_work_days is not None:
        parts.append(("ימי הוראה מקס׳", str(teacher.max_work_days)))

    parts.append(("שיעורים בפתרון", str(total_lessons)))
    parts.append(("ימי הוראה בפתרון", str(unique_days)))

    spans = "".join(
        f'<span><span class="label">{label}:</span> {val}</span>'
        for label, val in parts
    )
    return f'<div class="teacher-meta">{spans}</div>'


def _render_teacher_page(
    teacher: Teacher,
    lessons: list[ScheduledLesson],
    subject_map: dict[int, Subject],
    class_map: dict[int, ClassGroup],
    track_map: dict[int, Track],
    days: list[str],
    max_period: int,
    meeting_grid: dict[tuple[str, int], list[str]] | None = None,
) -> str:
    """One page per teacher — WITH meetings + full teacher details."""
    grid = _build_grid(lessons)
    total_lessons = len(lessons)
    unique_days = len({l.day for l in lessons})

    html = '<div class="page">\n<div class="page-header">'
    html += f'<h2 class="teacher-header">{escape(teacher.name)}</h2>'
    html += _build_teacher_meta_html(teacher, class_map, total_lessons, unique_days)
    html += '</div>\n'

    html += '<table>\n<thead><tr>'
    html += '<th class="period-col">שעה</th>'
    for day in days:
        html += f"<th>{DAY_LABELS.get(day, day)}</th>"
    html += "</tr></thead>\n<tbody>\n"

    for period in range(1, max_period + 1):
        html += f'<tr><td class="period-cell">{period}</td>'
        for day in days:
            slot = grid.get((day, period), [])
            mtg_entries = (meeting_grid or {}).get((day, period), [])
            if slot or mtg_entries:
                html += "<td>"
                if slot:
                    html += _lesson_card_html(slot, subject_map, {}, class_map, track_map, show_class=True)
                for mname in mtg_entries:
                    html += _meeting_card_html(mname)
                html += "</td>"
            else:
                html += '<td class="empty"></td>'
        html += "</tr>\n"

    html += "</tbody></table>\n</div>\n"
    return html


def _render_meetings_page(
    scheduled_meetings: list[ScheduledMeeting],
    meeting_map: dict[int, Meeting],
    days: list[str],
    max_period: int,
) -> str:
    """Separate meetings timetable page."""
    grid: dict[tuple[str, int], list[str]] = {}
    for sm in scheduled_meetings:
        meeting = meeting_map.get(sm.meeting_id)
        if not meeting:
            continue
        grid.setdefault((sm.day, sm.period), []).append(meeting.name)

    html = '<div class="page">\n<div class="page-header">'
    html += '<h2 class="meetings-header">מערכת ישיבות</h2>'
    html += '</div>\n'
    html += '<table>\n<thead><tr>'
    html += '<th class="period-col">שעה</th>'
    for day in days:
        html += f"<th>{DAY_LABELS.get(day, day)}</th>"
    html += "</tr></thead>\n<tbody>\n"

    for period in range(1, max_period + 1):
        html += f'<tr><td class="period-cell">{period}</td>'
        for day in days:
            entries = grid.get((day, period), [])
            if entries:
                html += "<td>"
                for mname in entries:
                    html += _meeting_card_html(mname)
                html += "</td>"
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
    teacher_map_obj = {t.id: t for t in teachers}

    classes = db.query(ClassGroup).filter(ClassGroup.school_id == school.id).all()
    class_map = {c.id: c for c in classes}

    grades = db.query(Grade).filter(Grade.school_id == school.id).all()
    grade_map = {g.id: g for g in grades}

    clusters = db.query(GroupingCluster).filter(GroupingCluster.school_id == school.id).all()
    track_map: dict[int, Track] = {}
    for cluster in clusters:
        for track in cluster.tracks:
            track_map[track.id] = track

    # Teacher name map for meetings
    teacher_name_map: dict[int, Teacher] = teacher_map_obj

    # Build teacher → meetings grid: (day, period) → [meeting_name]
    teacher_meeting_grid: dict[int, dict[tuple[str, int], list[str]]] = {}
    for sm in scheduled_meetings:
        meeting = meeting_map.get(sm.meeting_id)
        if not meeting:
            continue
        for t in (meeting.teachers or []):
            teacher_meeting_grid.setdefault(t.id, {}).setdefault((sm.day, sm.period), []).append(meeting.name)

    days = DAYS_ORDER[: school.days_per_week]
    max_period = school.periods_per_day

    html_parts: list[str] = []
    html_parts.append(f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<style>{_CSS}</style>
</head>
<body>
""")

    # ── Class timetables ──────────────────────────────────────────────────────
    sorted_classes = sorted(
        classes,
        key=lambda c: (
            grade_map[c.grade_id].level if c.grade_id in grade_map else 0,
            c.name,
        ),
    )
    for cg in sorted_classes:
        class_lessons = [l for l in lessons if l.class_group_id == cg.id]

        # Track lessons belonging to this class via clusters
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
        seen: set[str] = set()
        deduped: list[ScheduledLesson] = []
        for l in all_class_lessons:
            key = f"{l.day}_{l.period}_{l.track_id or ''}_{l.subject_id}_{l.teacher_id}"
            if key not in seen:
                seen.add(key)
                deduped.append(l)

        if deduped:
            html_parts.append(_render_class_page(
                cg, deduped, subject_map, teacher_name_map, class_map, track_map,
                days, max_period,
            ))

    # ── Teacher timetables (with meetings) ────────────────────────────────────
    for teacher in sorted(teachers, key=lambda t: t.name):
        teacher_lessons = [l for l in lessons if l.teacher_id == teacher.id]
        t_mtg_grid = teacher_meeting_grid.get(teacher.id)
        if teacher_lessons or t_mtg_grid:
            html_parts.append(_render_teacher_page(
                teacher, teacher_lessons, subject_map, class_map,
                track_map, days, max_period,
                meeting_grid=t_mtg_grid,
            ))

    # ── Meetings timetable (separate page) ────────────────────────────────────
    if scheduled_meetings:
        html_parts.append(_render_meetings_page(
            scheduled_meetings, meeting_map, days, max_period,
        ))

    html_parts.append("</body></html>")
    full_html = "\n".join(html_parts)

    pdf_bytes = HTML(string=full_html).write_pdf()
    buf = BytesIO(pdf_bytes)
    buf.seek(0)

    filename = f"timetable_solution_{solution_id}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
