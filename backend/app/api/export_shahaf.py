"""Export to Shahaf: build a Shahaf backup folder on disk.

Creates on disk at  backend/export/{school_name}/:
    folder.props                    — pointer to backup zip
    backup.{school_name}.index      — index with timestamp
    {timestamp}.zip                 — the actual Shahaf backup (27 XMLs)
"""

import base64
import os
import subprocess
import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree.ElementTree import Element, SubElement, tostring, indent, fromstring

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.class_group import ClassGroup, Grade, GroupingCluster, Track
from app.models.meeting import Meeting
from app.models.school import School
from app.models.subject import Subject, SubjectRequirement
from app.models.teacher import Teacher
from app.models.timetable import ScheduledLesson, ScheduledMeeting, Solution

# ── Export directory (backend/export/) ──
EXPORT_BASE = Path(__file__).resolve().parent.parent.parent / "export"

# ── Constants ──

SHAHAF_DAY_BITS = {"SUNDAY": 0, "MONDAY": 1, "TUESDAY": 2,
                   "WEDNESDAY": 3, "THURSDAY": 4, "FRIDAY": 5}
DAY_TO_SHAHAF = {"SUNDAY": "0", "MONDAY": "1", "TUESDAY": "2",
                 "WEDNESDAY": "3", "THURSDAY": "4", "FRIDAY": "5"}
XOR_KEY = [10, 20, 30, 40, 15, 25, 120, 150, 180, 45, 78, 98, 230, 120, 180, 70, 30, 10, 50, 10, 20]
NS = {
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xmlns:version": "http://www.shahaf-soft.com/2011/0/TimeTableData",
    "xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
}
BLOCK_PAD = 20
FROM_DATE = "2025-09-01"
TO_DATE = "2026-08-31"

router = APIRouter(prefix="/api", tags=["export-shahaf"], dependencies=[Depends(get_current_user)])


# ── Helpers ──

def _encrypt(text: str) -> str:
    raw = text.encode("utf-8")
    return "~!" + base64.b64encode(
        bytes([b ^ XOR_KEY[i % len(XOR_KEY)] for i, b in enumerate(raw)])
    ).decode()


def _mkroot(tag: str) -> Element:
    r = Element(tag)
    for k, v in NS.items():
        r.set(k, v)
    return r


def _to_xml(root: Element) -> bytes:
    indent(root, space="  ")
    return b'<?xml version="1.0"?>\n' + tostring(root, encoding="unicode").encode("utf-8")


def _sub(parent: Element, tag: str, value=None) -> Element:
    """Add sub-element. None/empty string → self-closing. 0 → <tag>0</tag>."""
    el = SubElement(parent, tag)
    if value is not None and str(value) != "":
        el.text = str(value)
    return el


def _empty_xml(root_tag: str) -> bytes:
    return _to_xml(_mkroot(root_tag))


# ── ID mapping — use our DB IDs × 100 to avoid collisions ──

def _tid(our_id: int) -> int: return our_id * 100
def _cid(our_id: int) -> int: return our_id * 100
def _sid(our_id: int) -> int: return our_id * 100


# ── Main export endpoint ──

@router.get("/solutions/{solution_id}/export/shahaf")
def export_shahaf(solution_id: int, db: Session = Depends(get_db)):
    solution = db.get(Solution, solution_id)
    if not solution:
        raise HTTPException(status_code=404, detail="פתרון לא נמצא")

    school = db.get(School, solution.school_id)
    if not school:
        raise HTTPException(status_code=404, detail="בית ספר לא נמצא")

    # Load template ZIP for Settings/GlobalSettings/HourClassRing
    template_zip = None
    if school.shahaf_backup:
        try:
            template_zip = ZipFile(BytesIO(school.shahaf_backup), "r")
        except Exception:
            pass

    # ── Load all data ──
    teachers = db.query(Teacher).filter(Teacher.school_id == school.id).all()
    classes = db.query(ClassGroup).filter(ClassGroup.school_id == school.id).all()
    grades = db.query(Grade).filter(Grade.school_id == school.id).all()
    subjects = db.query(Subject).filter(Subject.school_id == school.id).all()
    requirements = db.query(SubjectRequirement).filter(SubjectRequirement.school_id == school.id).all()
    clusters = db.query(GroupingCluster).filter(GroupingCluster.school_id == school.id).all()
    tracks = db.query(Track).join(GroupingCluster).filter(GroupingCluster.school_id == school.id).all()
    meetings = db.query(Meeting).filter(Meeting.school_id == school.id, Meeting.is_active == True).all()
    lessons = db.query(ScheduledLesson).filter(ScheduledLesson.solution_id == solution_id).all()
    sched_meetings = db.query(ScheduledMeeting).filter(ScheduledMeeting.solution_id == solution_id).all()

    grade_map = {g.id: g for g in grades}

    # ── Build ClassCollection ──
    class_root = _mkroot("ArrayOfClass")
    for i, c in enumerate(sorted(classes, key=lambda x: x.name)):
        el = SubElement(class_root, "Class")
        g = grade_map.get(c.grade_id)
        _sub(el, "Id", _cid(c.id)); _sub(el, "Name", c.name)
        _sub(el, "Layer", g.name if g else ""); _sub(el, "StudentNum", 0)
        _sub(el, "Mid"); _sub(el, "Type"); _sub(el, "UIOrder", i)

    # ── Build SubjectCollection ──
    subj_root = _mkroot("ArrayOfSubject")
    for i, s in enumerate(sorted(subjects, key=lambda x: x.name)):
        el = SubElement(subj_root, "Subject")
        _sub(el, "Id", _sid(s.id)); _sub(el, "Name", s.name); _sub(el, "Mid")
        _sub(el, "Super", s.name); _sub(el, "SuperId", 0)
        _sub(el, "Mandatory", "false"); _sub(el, "UIOrder", i)
    for j, m in enumerate(meetings):
        el = SubElement(subj_root, "Subject")
        _sub(el, "Id", _sid(m.id + 10000)); _sub(el, "Name", m.name); _sub(el, "Mid")
        _sub(el, "Super", "ישיבות"); _sub(el, "SuperId", 0)
        _sub(el, "Mandatory", "false"); _sub(el, "UIOrder", len(subjects) + j)

    # ── Build TeacherCollection ──
    teacher_root = _mkroot("ArrayOfTeacher")
    for i, t in enumerate(sorted(teachers, key=lambda x: x.name)):
        el = SubElement(teacher_root, "Teacher")
        parts = t.name.rsplit(" ", 1)
        fname = parts[1] if len(parts) > 1 else t.name
        lname = parts[0] if len(parts) > 1 else ""
        _sub(el, "Id", _tid(t.id)); _sub(el, "Flags", 0)
        _sub(el, "FName", _encrypt(fname)); _sub(el, "LName", _encrypt(lname))
        _sub(el, "TZ", _encrypt("")); _sub(el, "Phone"); _sub(el, "MobilePhone")
        _sub(el, "Address"); _sub(el, "Email"); _sub(el, "TargetHours", 0)
        _sub(el, "PO", 1); _sub(el, "Mid", _encrypt(""))
        hc = _cid(t.homeroom_class_id) if t.homeroom_class_id else -1
        _sub(el, "ClassManager", hc); _sub(el, "UIOrder", i)
        ext = SubElement(el, "TeacherExt")
        _sub(ext, "Level"); _sub(ext, "Start", "2025-09-01T00:00:00")
        _sub(ext, "Finish", "2026-08-31T00:00:00")
        for f in ["Rank", "Age", "Seniority", "Hoze", "Salary", "Diploma", "License"]:
            _sub(ext, f)
        _sub(ext, "BirthDate", "1900-01-01T00:00:00"); _sub(ext, "Tafkidim", 0)
        _sub(ext, "YC", "1900-01-01T00:00:00")
        for f in ["KV", "EX1", "EX2", "EPR", "TB", "TM", "TBLY", "TMLY", "TO"]:
            _sub(ext, f, 0)
        _sub(ext, "Zof", "false"); _sub(ext, "Zoz", "false")
        for f in ["Kvb", "Fsb", "Ssb", "Kvm", "Fsm", "Ssm"]:
            _sub(ext, f, 0)
        _sub(ext, "Gmul"); _sub(ext, "Ahuz")

    # ── Build StudyItemCollection ──
    study_root = _mkroot("ArrayOfStudyItem")
    si_counter = [1]  # mutable for closure

    def _add_study_item(hours, teacher_id, subject_id, class_ids, link_id=0):
        sid = si_counter[0]; si_counter[0] += 1
        el = SubElement(study_root, "StudyItem")
        _sub(el, "ID", sid); _sub(el, "uid", 0); _sub(el, "Hours", hours)
        _sub(el, "TeacherId", teacher_id); _sub(el, "SubjectId", subject_id)
        _sub(el, "RoomId", -1)
        cls = SubElement(el, "Classes")
        for cid in class_ids:
            _sub(cls, "int", cid)
        _sub(el, "lv"); _sub(el, "Comment"); _sub(el, "LinkId", link_id)
        _sub(el, "RowState", "Normal"); _sub(el, "From", FROM_DATE); _sub(el, "To", TO_DATE)
        _sub(el, "Blocks"); _sub(el, "BlocksActive", "false")
        _sub(el, "Flags", 1280); _sub(el, "UIOrder", sid)
        return sid

    # Regular requirements
    req_to_si: dict[int, int] = {}
    for req in requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        req_to_si[req.id] = _add_study_item(
            req.hours_per_week, _tid(req.teacher_id),
            _sid(req.subject_id), [_cid(req.class_group_id)],
        )

    # Grouped tracks
    track_to_si: dict[int, int] = {}
    for cluster in clusters:
        ctracks = [t for t in tracks if t.cluster_id == cluster.id and t.teacher_id]
        if not ctracks:
            continue
        first_si = None
        source_ids = {sc.id for sc in cluster.source_classes}
        class_id_list = [_cid(x) for x in sorted(source_ids)]
        for track in ctracks:
            sid = _add_study_item(
                track.hours_per_week, _tid(track.teacher_id),
                _sid(cluster.subject_id), class_id_list,
                link_id=first_si if first_si else si_counter[0],
            )
            if first_si is None:
                first_si = sid
            track_to_si[track.id] = sid

    # Meetings — one StudyItem per teacher
    meeting_teacher_si: dict[tuple[int, int], int] = {}
    for meeting in meetings:
        msid = _sid(meeting.id + 10000)
        first_si = None
        for teacher in meeting.teachers:
            sid = _add_study_item(
                meeting.hours_per_week, _tid(teacher.id), msid, [],
                link_id=first_si if first_si else si_counter[0],
            )
            if first_si is None:
                first_si = sid
            meeting_teacher_si[(meeting.id, teacher.id)] = sid

    # ── Build TimeTableCollection ──
    tt_root = _mkroot("ArrayOfTimeTableItem")
    tt_count = 0

    def _add_tt(day: str, hour: int, item_id: int):
        nonlocal tt_count
        el = SubElement(tt_root, "TimeTableItem")
        _sub(el, "Id", uuid.uuid4()); _sub(el, "Day", day)
        _sub(el, "Locked", "false"); _sub(el, "BrokenLink", "false")
        _sub(el, "Hour", hour); _sub(el, "ItemId", item_id)
        _sub(el, "RoomId", 0); _sub(el, "Flags", 0); _sub(el, "FM", -1)
        tt_count += 1

    # Regular lessons
    seen_reg: set[tuple] = set()
    for lesson in lessons:
        if lesson.track_id:
            continue
        key = (lesson.class_group_id, lesson.subject_id, lesson.teacher_id, lesson.day, lesson.period)
        if key in seen_reg:
            continue
        seen_reg.add(key)
        req_id = next(
            (r.id for r in requirements
             if not r.is_grouped and r.teacher_id == lesson.teacher_id
             and r.subject_id == lesson.subject_id
             and r.class_group_id == lesson.class_group_id),
            None,
        )
        si = req_to_si.get(req_id) if req_id else None
        if si:
            _add_tt(DAY_TO_SHAHAF.get(lesson.day, "0"), lesson.period, si)

    # Track lessons — dedup by (track_id, day, period)
    seen_trk: set[tuple] = set()
    for lesson in lessons:
        if not lesson.track_id:
            continue
        key = (lesson.track_id, lesson.day, lesson.period)
        if key in seen_trk:
            continue
        seen_trk.add(key)
        si = track_to_si.get(lesson.track_id)
        if si:
            _add_tt(DAY_TO_SHAHAF.get(lesson.day, "0"), lesson.period, si)

    # Meetings — one entry per teacher per timeslot
    meeting_map = {m.id: m for m in meetings}
    for sm in sched_meetings:
        meeting = meeting_map.get(sm.meeting_id)
        if not meeting:
            continue
        for teacher in meeting.teachers:
            si = meeting_teacher_si.get((meeting.id, teacher.id))
            if si:
                _add_tt(DAY_TO_SHAHAF.get(sm.day, "0"), sm.period, si)

    # ── Build TeacherBlockCollection ──
    tb_root = _mkroot("ArrayOfTeacherBlock")
    el = SubElement(tb_root, "TeacherBlock")
    _sub(el, "TeacherId", -1)
    b = SubElement(el, "Blocks")
    for _ in range(BLOCK_PAD):
        _sub(b, "int", 0)
    for t in teachers:
        masks = [0] * BLOCK_PAD
        if t.blocked_slots:
            for slot in t.blocked_slots:
                bit = SHAHAF_DAY_BITS.get(slot.get("day", ""))
                period = slot.get("period", 0)
                if bit is not None and 0 <= period < BLOCK_PAD:
                    masks[period] |= (1 << bit)
        el = SubElement(tb_root, "TeacherBlock")
        _sub(el, "TeacherId", _tid(t.id))
        b = SubElement(el, "Blocks")
        for m in masks:
            _sub(b, "int", m)

    # ── Build ClassBlockCollection ──
    cb_root = _mkroot("ArrayOfClassBlock")
    el = SubElement(cb_root, "ClassBlock")
    _sub(el, "ClassId", -1)
    b = SubElement(el, "Blocks")
    for _ in range(BLOCK_PAD):
        _sub(b, "int", 0)
    for c in classes:
        el = SubElement(cb_root, "ClassBlock")
        _sub(el, "ClassId", _cid(c.id))
        b = SubElement(el, "Blocks")
        for _ in range(BLOCK_PAD):
            _sub(b, "int", 0)

    # ── Fix template Settings/GlobalSettings ──
    def _fix_global_settings(xml_bytes: bytes) -> bytes:
        root = fromstring(xml_bytes)
        ed = root.find("Edition")
        if ed is not None:
            ed.text = "1"
        else:
            SubElement(root, "Edition").text = "1"
        indent(root, space="  ")
        return b'<?xml version="1.0"?>\n' + tostring(root, encoding="unicode").encode("utf-8")

    def _fix_settings(xml_bytes: bytes, profile_name: str) -> bytes:
        root = fromstring(xml_bytes)
        cp = root.find("CurrentProfile")
        if cp is not None:
            cp.text = profile_name
        indent(root, space="  ")
        return b'<?xml version="1.0"?>\n' + tostring(root, encoding="unicode").encode("utf-8")

    def _fix_hour_rings(xml_bytes: bytes) -> bytes:
        root = fromstring(xml_bytes)
        to_remove = [
            r for r in root.findall("HourClassRing")
            if (r.find("Day").text or "").strip() == "10"
            and (r.find("Name").text or "").strip() != "מהדורה 1"
        ]
        for r in to_remove:
            root.remove(r)
        indent(root, space="  ")
        return b'<?xml version="1.0"?>\n' + tostring(root, encoding="unicode").encode("utf-8")

    # ── Assemble generated XMLs ──
    generated: dict[str, bytes] = {
        "ClassCollection.xml": _to_xml(class_root),
        "SubjectCollection.xml": _to_xml(subj_root),
        "TeacherCollection.xml": _to_xml(teacher_root),
        "StudyItemCollection.xml": _to_xml(study_root),
        "TimeTableCollection.xml": _to_xml(tt_root),
        "TeacherBlockCollection.xml": _to_xml(tb_root),
        "ClassBlockCollection.xml": _to_xml(cb_root),
    }

    # Empty collections with correct root tags
    for name, tag in [
        ("RoomCollection.xml", "ArrayOfRoom"),
        ("StudyItemExtCollection.xml", "ArrayOfStudyItemExt"),
        ("TimeTableExtCollection.xml", "ArrayOfTimeTableExt"),
        ("RuleCollection.xml", "ArrayOfRule"),
        ("Holidays.xml", "ArrayOfHoliday"),
        ("BlockCommentCollection.xml", "ArrayOfBlockComment"),
        ("ManbasDataItemCollection.xml", "ArrayOfManbasDataItem"),
        ("TeacherRewardCollection.xml", "ArrayOfTeacherReward"),
        ("ChangesCollection.xml", "ArrayOfChangeItem"),
        ("StudyMessageCollection.xml", "ArrayOfStudyMessage"),
        ("TeacherDutyPlaceCollection.xml", "ArrayOfTeacherDutyPlace"),
        ("TeacherDutyCollection.xml", "ArrayOfTeacherDutyItem"),
        ("PaymentOrganizationCollection.xml", "ArrayOfPaymentOrganization"),
        ("RoomBlockCollection.xml", "ArrayOfRoomBlock"),
        ("TeacherChangeReasonCollection.xml", "ArrayOfString"),
    ]:
        generated[name] = _empty_xml(tag)

    # ClassActivityCollection has special namespace
    car = Element("ArrayOfString")
    car.set("xmlns", "urn:classactivitycollection")
    for k, v in NS.items():
        car.set(k, v)
    generated["ClassActivityCollection.xml"] = _to_xml(car)

    # ── Build inner backup ZIP ──
    inner_buf = BytesIO()
    with ZipFile(inner_buf, "w", ZIP_DEFLATED) as inner_zip:
        if template_zip:
            for name in template_zip.namelist():
                if name in generated:
                    inner_zip.writestr(name, generated[name])
                elif name == "GlobalSettings.xml":
                    inner_zip.writestr(name, _fix_global_settings(template_zip.read(name)))
                elif name == "Settings.xml":
                    inner_zip.writestr(name, _fix_settings(template_zip.read(name), school.name))
                elif name == "HourClassRingCollection.xml":
                    inner_zip.writestr(name, _fix_hour_rings(template_zip.read(name)))
                else:
                    inner_zip.writestr(name, template_zip.read(name))
        else:
            # No template — write only generated files
            for name, data in generated.items():
                inner_zip.writestr(name, data)

    if template_zip:
        template_zip.close()

    inner_buf.seek(0)
    inner_bytes = inner_buf.getvalue()

    # ── Write Shahaf folder to disk ──
    now = datetime.now()
    timestamp = now.strftime("%Y%m%d-%H%M%S")
    date_str = now.strftime("%d.%m.%Y")
    time_str = now.strftime("%H:%M")
    inner_filename = f"{timestamp}.zip"

    export_dir = EXPORT_BASE / school.name
    export_dir.mkdir(parents=True, exist_ok=True)

    # folder.props
    (export_dir / "folder.props").write_text(inner_filename, encoding="utf-8")

    # backup.{name}.index
    index_filename = f"backup.{school.name}.index"
    index_content = f"{date_str}~{time_str}~פתרון {solution_id}~{inner_filename}"
    (export_dir / index_filename).write_text(index_content, encoding="utf-8")

    # {timestamp}.zip
    (export_dir / inner_filename).write_bytes(inner_bytes)

    # Open folder in Finder (macOS) — fire-and-forget
    folder_path = str(export_dir)
    try:
        subprocess.Popen(["open", folder_path])
    except Exception:
        pass

    return {
        "path": folder_path,
        "matched": tt_count,
        "study_items": si_counter[0] - 1,
        "zip_file": inner_filename,
    }
