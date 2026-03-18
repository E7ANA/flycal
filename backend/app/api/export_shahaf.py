"""Export to Shahaf: upload original backup ZIP, get back updated with our timetable.

Uses shahaf_id stored on our entities (from Shahaf import) to map
our requirements directly to Shahaf StudyItem IDs. Falls back to
name-based matching if shahaf_id is not set.
"""

import uuid
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree.ElementTree import Element, SubElement, tostring, indent, fromstring

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.class_group import ClassGroup, Grade, GroupingCluster
from app.models.meeting import Meeting
from app.models.school import School
from app.models.subject import Subject, SubjectRequirement
from app.models.teacher import Teacher
from app.models.timetable import ScheduledLesson, ScheduledMeeting, Solution

SHAHAF_DAY_BITS = {"SUNDAY": 0, "MONDAY": 1, "TUESDAY": 2,
                   "WEDNESDAY": 3, "THURSDAY": 4, "FRIDAY": 5}
BLOCK_PAD_SIZE = 20  # Shahaf uses fixed-size block arrays

router = APIRouter(prefix="/api", tags=["export-shahaf"], dependencies=[Depends(get_current_user)])

DAY_TO_SHAHAF = {
    "SUNDAY": "0", "MONDAY": "1", "TUESDAY": "2",
    "WEDNESDAY": "3", "THURSDAY": "4", "FRIDAY": "5",
}


def _text(el: Element | None) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


def _build_timetable_xml(entries: list[dict]) -> bytes:
    root = Element("ArrayOfTimeTableItem")
    root.set("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance")
    root.set("xmlns:version", "http://www.shahaf-soft.com/2011/0/TimeTableData")
    root.set("xmlns:xsd", "http://www.w3.org/2001/XMLSchema")

    for entry in entries:
        tti = SubElement(root, "TimeTableItem")
        for tag, val in [
            ("Id", str(uuid.uuid4())),
            ("Day", str(entry["day"])),
            ("Locked", "false"),
            ("BrokenLink", "false"),
            ("Hour", str(entry["hour"])),
            ("ItemId", str(entry["item_id"])),
            ("RoomId", "0"),
            ("Flags", "0"),
            ("FM", "-1"),
        ]:
            el = SubElement(tti, tag)
            el.text = val

    indent(root, space="  ")
    return b'<?xml version="1.0"?>\n' + tostring(root, encoding="unicode").encode("utf-8")


@router.get("/solutions/{solution_id}/export/shahaf")
def export_shahaf(
    solution_id: int,
    db: Session = Depends(get_db),
):
    """Export solution to Shahaf: uses stored backup ZIP, replaces TimeTableCollection."""
    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")

    school = db.get(School, solution.school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית ספר לא נמצא")

    if not school.shahaf_backup:
        raise HTTPException(status_code=400, detail="לא נמצא גיבוי שחף — יש לייבא קודם מדף ייבוא משחף")

    try:
        src_zip = ZipFile(BytesIO(school.shahaf_backup), "r")
    except Exception:
        raise HTTPException(status_code=400, detail="גיבוי שחף שמור לא תקין")

    # Parse Shahaf StudyItems for fallback matching
    shahaf_study_items: dict[str, dict] = {}
    try:
        study_xml = fromstring(src_zip.read("StudyItemCollection.xml"))
        for si in study_xml.findall("StudyItem"):
            sid = _text(si.find("ID"))
            class_ids = []
            classes_el = si.find("Classes")
            if classes_el is not None:
                class_ids = [_text(i) for i in classes_el.findall("int")]
            shahaf_study_items[sid] = {
                "id": sid,
                "teacher_id": _text(si.find("TeacherId")),
                "subject_id": _text(si.find("SubjectId")),
                "class_ids": class_ids,
                "hours": _text(si.find("Hours")),
                "link_id": _text(si.find("LinkId")),
            }
    except Exception:
        pass

    # Also parse class/subject names for fallback
    shahaf_class_by_name: dict[str, str] = {}
    shahaf_subj_by_name: dict[str, str] = {}
    try:
        class_xml = fromstring(src_zip.read("ClassCollection.xml"))
        for c in class_xml.findall("Class"):
            shahaf_class_by_name[_text(c.find("Name"))] = _text(c.find("Id"))
    except Exception:
        pass
    try:
        subj_xml = fromstring(src_zip.read("SubjectCollection.xml"))
        for s in subj_xml.findall("Subject"):
            name = _text(s.find("Name"))
            if name and name not in shahaf_subj_by_name:
                shahaf_subj_by_name[name] = _text(s.find("Id"))
    except Exception:
        pass

    # Load our data
    lessons = db.query(ScheduledLesson).filter(
        ScheduledLesson.solution_id == solution_id
    ).all()
    scheduled_meetings = db.query(ScheduledMeeting).filter(
        ScheduledMeeting.solution_id == solution_id
    ).all()
    requirements = db.query(SubjectRequirement).filter(
        SubjectRequirement.school_id == school.id
    ).all()
    classes = db.query(ClassGroup).filter(ClassGroup.school_id == school.id).all()
    subjects = db.query(Subject).filter(Subject.school_id == school.id).all()
    clusters = db.query(GroupingCluster).filter(
        GroupingCluster.school_id == school.id
    ).all()
    meetings = db.query(Meeting).filter(
        Meeting.school_id == school.id, Meeting.is_active == True
    ).all()

    # Build mapping: our requirement → shahaf StudyItem ID
    # Strategy 1: Direct shahaf_id on SubjectRequirement
    req_to_shahaf: dict[int, str] = {}
    for req in requirements:
        if req.shahaf_id:
            req_to_shahaf[req.id] = req.shahaf_id

    # Strategy 2: Fallback — match by shahaf_ids on class+subject+teacher
    our_class_shahaf = {c.id: c.shahaf_id for c in classes if c.shahaf_id}
    our_subj_shahaf = {s.id: s.shahaf_id for s in subjects if s.shahaf_id}

    # Index shahaf study items by (subject_id, class_id_set)
    shahaf_si_index: dict[tuple, str] = {}
    for si in shahaf_study_items.values():
        for cid in si["class_ids"]:
            shahaf_si_index[(si["subject_id"], cid)] = si["id"]

    for req in requirements:
        if req.id in req_to_shahaf:
            continue
        if req.is_grouped or req.teacher_id is None:
            continue
        s_subj = our_subj_shahaf.get(req.subject_id)
        s_class = our_class_shahaf.get(req.class_group_id)
        if s_subj and s_class:
            si_id = shahaf_si_index.get((s_subj, s_class))
            if si_id:
                req_to_shahaf[req.id] = si_id

    # Strategy 3: Name-based fallback for classes/subjects without shahaf_id
    for req in requirements:
        if req.id in req_to_shahaf:
            continue
        if req.is_grouped or req.teacher_id is None:
            continue
        class_obj = next((c for c in classes if c.id == req.class_group_id), None)
        subj_obj = next((s for s in subjects if s.id == req.subject_id), None)
        if class_obj and subj_obj:
            s_class = shahaf_class_by_name.get(class_obj.name)
            s_subj = shahaf_subj_by_name.get(subj_obj.name)
            if s_class and s_subj:
                si_id = shahaf_si_index.get((s_subj, s_class))
                if si_id:
                    req_to_shahaf[req.id] = si_id

    # Map tracks to shahaf StudyItems
    track_to_shahaf: dict[int, str] = {}
    for cluster in clusters:
        s_subj = our_subj_shahaf.get(cluster.subject_id)
        if not s_subj:
            subj_obj = next((s for s in subjects if s.id == cluster.subject_id), None)
            if subj_obj:
                s_subj = shahaf_subj_by_name.get(subj_obj.name)
        if not s_subj:
            continue
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            if track.source_class_id:
                s_class = our_class_shahaf.get(track.source_class_id)
                if not s_class:
                    class_obj = next((c for c in classes if c.id == track.source_class_id), None)
                    if class_obj:
                        s_class = shahaf_class_by_name.get(class_obj.name)
                if s_class:
                    # Find linked study item
                    for si in shahaf_study_items.values():
                        if si["subject_id"] == s_subj and s_class in si["class_ids"] and si["link_id"] != "0":
                            track_to_shahaf[track.id] = si["id"]
                            break

    # Build req lookup: (class_id, subject_id, teacher_id) → req_id
    req_lookup: dict[tuple, int] = {}
    for req in requirements:
        if not req.is_grouped and req.teacher_id:
            req_lookup[(req.class_group_id, req.subject_id, req.teacher_id)] = req.id

    # Build TimeTableItems
    timetable_entries: list[dict] = []
    unmatched = 0
    seen = set()

    for lesson in lessons:
        key = (lesson.class_group_id, lesson.subject_id, lesson.teacher_id, lesson.day, lesson.period)
        if key in seen:
            continue
        seen.add(key)

        shahaf_si_id = None
        if lesson.track_id and lesson.track_id in track_to_shahaf:
            shahaf_si_id = track_to_shahaf[lesson.track_id]
        else:
            req_key = (lesson.class_group_id, lesson.subject_id, lesson.teacher_id)
            req_id = req_lookup.get(req_key)
            if req_id:
                shahaf_si_id = req_to_shahaf.get(req_id)

        if shahaf_si_id:
            timetable_entries.append({
                "item_id": shahaf_si_id,
                "day": DAY_TO_SHAHAF.get(lesson.day, "0"),
                "hour": lesson.period,
            })
        else:
            unmatched += 1

    # Meetings
    meeting_map = {m.id: m for m in meetings}
    for sm in scheduled_meetings:
        meeting = meeting_map.get(sm.meeting_id)
        if not meeting:
            continue
        s_subj = shahaf_subj_by_name.get(meeting.name)
        if s_subj:
            for si in shahaf_study_items.values():
                if si["subject_id"] == s_subj:
                    timetable_entries.append({
                        "item_id": si["id"],
                        "day": DAY_TO_SHAHAF.get(sm.day, "0"),
                        "hour": sm.period,
                    })
                    break

    # Build updated TeacherBlockCollection from our teacher blocked_slots
    teachers = db.query(Teacher).filter(Teacher.school_id == school.id).all()

    # Parse existing TeacherBlockCollection to preserve entries we don't manage
    existing_blocks: dict[str, list[int]] = {}
    try:
        tb_xml = fromstring(src_zip.read("TeacherBlockCollection.xml"))
        for tb in tb_xml.findall("TeacherBlock"):
            tid = _text(tb.find("TeacherId"))
            blocks = [int(_text(b) or "0") for b in tb.findall(".//Blocks/int")]
            existing_blocks[tid] = blocks
    except Exception:
        pass

    # Map our teacher IDs to shahaf teacher IDs
    our_to_shahaf_teacher: dict[int, str] = {}
    for t in teachers:
        if t.shahaf_id:
            our_to_shahaf_teacher[t.id] = t.shahaf_id

    # Update blocks for our teachers
    for t in teachers:
        shahaf_tid = t.shahaf_id
        if not shahaf_tid:
            continue

        # Build new block masks from our blocked_slots
        masks = [0] * BLOCK_PAD_SIZE
        if t.blocked_slots:
            for slot in t.blocked_slots:
                day = slot.get("day", "")
                period = slot.get("period", 0)
                bit = SHAHAF_DAY_BITS.get(day)
                if bit is not None and 0 <= period < BLOCK_PAD_SIZE:
                    masks[period] |= (1 << bit)

        existing_blocks[shahaf_tid] = masks

    # Rebuild TeacherBlockCollection XML
    tb_root = Element("ArrayOfTeacherBlock")
    tb_root.set("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance")
    tb_root.set("xmlns:version", "http://www.shahaf-soft.com/2011/0/TimeTableData")
    tb_root.set("xmlns:xsd", "http://www.w3.org/2001/XMLSchema")

    for tid in sorted(existing_blocks.keys(), key=lambda x: int(x) if x.lstrip('-').isdigit() else 0):
        tb_el = SubElement(tb_root, "TeacherBlock")
        tid_el = SubElement(tb_el, "TeacherId")
        tid_el.text = tid
        blocks_el = SubElement(tb_el, "Blocks")
        for mask in existing_blocks[tid]:
            int_el = SubElement(blocks_el, "int")
            int_el.text = str(mask)

    indent(tb_root, space="  ")
    new_teacher_blocks = b'<?xml version="1.0"?>\n' + tostring(tb_root, encoding="unicode").encode("utf-8")

    # Build new ZIP — replace TimeTableCollection + TeacherBlockCollection
    replaced_files = {"TimeTableCollection.xml", "TeacherBlockCollection.xml"}
    new_timetable = _build_timetable_xml(timetable_entries)
    out_buf = BytesIO()
    with ZipFile(out_buf, "w", ZIP_DEFLATED) as out_zip:
        for name in src_zip.namelist():
            if name == "TimeTableCollection.xml":
                out_zip.writestr(name, new_timetable)
            elif name == "TeacherBlockCollection.xml":
                out_zip.writestr(name, new_teacher_blocks)
            else:
                out_zip.writestr(name, src_zip.read(name))

    src_zip.close()
    out_buf.seek(0)

    filename = f"shahaf_updated_solution_{solution_id}.zip"
    return StreamingResponse(
        out_buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Shahaf-Matched": str(len(timetable_entries)),
            "X-Shahaf-Unmatched": str(unmatched),
        },
    )
