"""Import from Shahaf backup ZIP.

Upload a Shahaf backup → parse teachers, classes, subjects, study items
→ return preview → user filters what to keep → import into our DB with shahaf_id mapping.
"""

from collections import defaultdict
from io import BytesIO
from zipfile import ZipFile
from xml.etree.ElementTree import fromstring, Element

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user

router = APIRouter(
    prefix="/api/import-shahaf",
    tags=["import-shahaf"],
    dependencies=[Depends(get_current_user)],
)


def _text(el: Element | None) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


# Keywords that indicate non-frontal (meetings/admin) study items
_MEETING_KEYWORDS = {
    "ישיבת", "ישיבה", "מליאה", "פרטני", "שהייה", "שהיה",
    "תורנות", "הכנה", "ריכוז", "ניהול", "ייעוץ", "חניכה",
}


def _is_meeting_subject(subj_name: str) -> bool:
    name_lower = subj_name.strip()
    return any(kw in name_lower for kw in _MEETING_KEYWORDS)


# Shahaf name encryption: XOR with a fixed repeating key, then base64
_SHAHAF_XOR_KEY = bytes([10, 20, 30, 40, 15, 25, 120, 150, 180, 45, 78, 98, 230, 120, 180, 70, 30, 10, 50, 10, 20])


def _decrypt_shahaf(encoded: str) -> str:
    """Decrypt a Shahaf ~!-prefixed encoded string."""
    if not encoded or not encoded.startswith("~!"):
        return encoded or ""
    try:
        import base64
        data = base64.b64decode(encoded[2:])
        key = _SHAHAF_XOR_KEY
        result = bytes(data[i] ^ key[i % len(key)] for i in range(len(data)))
        return result.decode("utf-8")
    except Exception:
        return encoded


# ── Preview: parse ZIP and return structured data ────────────────────────

@router.post("/preview")
async def preview_shahaf_backup(
    backup: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Parse Shahaf backup and return all entities for user to filter."""
    content = await backup.read()
    try:
        zf = ZipFile(BytesIO(content), "r")
    except Exception:
        raise HTTPException(status_code=400, detail="קובץ ZIP לא תקין")

    # Parse classes first (needed for teacher context)
    classes = []
    class_names: dict[str, str] = {}
    class_to_layer: dict[str, str] = {}
    try:
        root = fromstring(zf.read("ClassCollection.xml"))
        for c in root.findall("Class"):
            cid = _text(c.find("Id"))
            cname = _text(c.find("Name"))
            layer = _text(c.find("Layer"))
            class_names[cid] = cname
            class_to_layer[cid] = layer
            classes.append({
                "shahaf_id": cid,
                "name": cname,
                "layer": layer,
                "students": int(_text(c.find("StudentNum")) or 0),
                "selected": True,
            })
    except Exception:
        pass

    # Parse subjects first (needed for teacher context)
    subjects = []
    subject_names: dict[str, str] = {}
    try:
        root = fromstring(zf.read("SubjectCollection.xml"))
        for s in root.findall("Subject"):
            sid = _text(s.find("Id"))
            sname = _text(s.find("Name"))
            subject_names[sid] = sname
            subjects.append({
                "shahaf_id": sid,
                "name": sname,
                "super": _text(s.find("Super")),
                "total_hours": 0,  # filled below
                "layer_hours": {},  # filled below
                "selected": True,
            })
    except Exception:
        pass

    # Parse study items (needed for teacher hours breakdown)
    study_items_raw = []
    try:
        root = fromstring(zf.read("StudyItemCollection.xml"))
        for si in root.findall("StudyItem"):
            sid = _text(si.find("ID"))
            teacher_id = _text(si.find("TeacherId"))
            subject_id = _text(si.find("SubjectId"))
            hours_val = _text(si.find("Hours"))
            link_id = _text(si.find("LinkId"))
            ci = []
            classes_el = si.find("Classes")
            if classes_el is not None:
                ci = [_text(i) for i in classes_el.findall("int")]
            study_items_raw.append({
                "shahaf_id": sid,
                "teacher_shahaf_id": teacher_id,
                "subject_shahaf_id": subject_id,
                "class_shahaf_ids": ci,
                "hours": int(hours_val) if hours_val else 0,
                "link_id": link_id,
            })
    except Exception:
        pass

    # Compute per-teacher and per-subject stats from study items
    teacher_total_hours: dict[str, int] = defaultdict(int)
    teacher_frontal_hours: dict[str, int] = defaultdict(int)
    teacher_meeting_hours: dict[str, int] = defaultdict(int)
    teacher_subject_set: dict[str, set] = defaultdict(set)
    teacher_class_set: dict[str, set] = defaultdict(set)

    # Per-subject: total hours and hours per layer
    subject_total_hours: dict[str, int] = defaultdict(int)
    subject_layer_hours: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for si in study_items_raw:
        tid = si["teacher_shahaf_id"]
        hours = si["hours"]
        subj_id = si["subject_shahaf_id"]
        subj_name = subject_names.get(subj_id, "")
        teacher_total_hours[tid] += hours
        teacher_subject_set[tid].add(subj_name)
        for cid in si["class_shahaf_ids"]:
            teacher_class_set[tid].add(class_names.get(cid, cid))
            layer = class_to_layer.get(cid, "")
            if layer:
                subject_layer_hours[subj_id][layer] += hours

        subject_total_hours[subj_id] += hours

        if _is_meeting_subject(subj_name):
            teacher_meeting_hours[tid] += hours
        else:
            teacher_frontal_hours[tid] += hours

    # Detect roles from study items and teacher fields
    def _detect_roles(tid: str, class_mgr: str | None, tafkidim: int, subj_set: set) -> list[str]:
        roles = []
        if class_mgr:
            cm_name = class_names.get(class_mgr, "")
            roles.append(f"מחנכת {cm_name}" if cm_name else "מחנכת")
        subj_str = " ".join(subj_set)
        if "הנהלה" in subj_str or "ניהול" in subj_str:
            roles.append("הנהלה")
        if "רכז" in subj_str:
            roles.append("רכזת")
        if "יועצ" in subj_str or "ייעוץ" in subj_str:
            roles.append("יועצת")
        if tafkidim & 2:
            if "רכזת" not in roles:
                roles.append("רכזת")
        return roles

    # Parse teachers
    teachers = []
    try:
        root = fromstring(zf.read("TeacherCollection.xml"))
        for t in root.findall("Teacher"):
            tid = _text(t.find("Id"))
            fname_raw = _text(t.find("FName"))
            lname_raw = _text(t.find("LName"))
            fname = _decrypt_shahaf(fname_raw) if fname_raw.startswith("~!") else fname_raw
            lname = _decrypt_shahaf(lname_raw) if lname_raw.startswith("~!") else lname_raw
            # Shahaf stores first/last separately — combine as "last first" (Hebrew convention)
            name = f"{lname} {fname}".strip() if lname and fname else (lname or fname)
            target_hours = _text(t.find("TargetHours"))
            class_mgr = _text(t.find("ClassManager"))

            # Parse Tafkidim from TeacherExt
            tafkidim = 0
            ext_wrapper = t.find("TeacherExt")
            if ext_wrapper is not None:
                ext = ext_wrapper.find("TeacherExt")
                if ext is not None:
                    taf = _text(ext.find("Tafkidim"))
                    tafkidim = int(taf) if taf else 0

            roles = _detect_roles(
                tid, class_mgr if class_mgr else None,
                tafkidim, teacher_subject_set.get(tid, set())
            )

            teachers.append({
                "shahaf_id": tid,
                "name": name,
                "encrypted": False,
                "target_hours": int(target_hours) if target_hours else None,
                "total_hours": teacher_total_hours.get(tid, 0),
                "frontal_hours": teacher_frontal_hours.get(tid, 0),
                "meeting_hours": teacher_meeting_hours.get(tid, 0),
                "homeroom_class_id": class_mgr if class_mgr else None,
                "homeroom_class_name": class_names.get(class_mgr, "") if class_mgr else None,
                "roles": roles,
                "classes": sorted(teacher_class_set.get(tid, set())),
                "subjects": sorted(teacher_subject_set.get(tid, set())),
                "selected": True,
            })
    except Exception:
        pass

    # Enrich subjects with hours data
    # Get sorted layer names from classes
    all_layers = sorted({c["layer"] for c in classes if c.get("layer")})
    for s in subjects:
        sid = s["shahaf_id"]
        s["total_hours"] = subject_total_hours.get(sid, 0)
        s["layer_hours"] = {layer: subject_layer_hours.get(sid, {}).get(layer, 0) for layer in all_layers}

    # Classes and subjects already parsed above

    # Classify study items into: lesson / grouped / shared / meeting / plenary
    PLENARY_KEYWORDS = {"מליאה"}

    # Build link_id -> classes, layers, teachers to detect groupings
    link_layers: dict[str, set[str]] = defaultdict(set)
    link_classes: dict[str, set[str]] = defaultdict(set)
    link_teachers: dict[str, set[str]] = defaultdict(set)
    for si in study_items_raw:
        lid = si.get("link_id", "0")
        if lid and lid != "0":
            link_teachers[lid].add(si["teacher_shahaf_id"])
            for cid in si["class_shahaf_ids"]:
                link_classes[lid].add(cid)
                layer = class_to_layer.get(cid, "")
                if layer:
                    link_layers[lid].add(layer)

    def _classify_study_item(subj_name: str, link_id: str, class_ids: list[str] | None = None) -> str:
        name = subj_name.strip()
        if any(kw in name for kw in PLENARY_KEYWORDS):
            return "plenary"
        if _is_meeting_subject(name):
            return "meeting"
        if link_id and link_id != "0":
            num_classes = len(link_classes.get(link_id, set()))
            num_teachers = len(link_teachers.get(link_id, set()))
            # Grouping if 2+ classes OR 2+ teachers (levels within same class)
            if num_classes >= 2 or num_teachers >= 2:
                layers = link_layers.get(link_id, set())
                if len(layers) > 1:
                    return "shared"  # שיעור משותף — חוצה שכבות
                return "grouped"    # הקבצה — באותה שכבה
        # No link_id but 2+ classes → shared lesson
        if class_ids and len(class_ids) >= 2:
            return "shared"
        return "lesson"

    # Build study items for display from already-parsed raw data
    teacher_names_map = {t["shahaf_id"]: t["name"] for t in teachers}
    study_items = []
    for si in study_items_raw:
        class_names_list = [class_names.get(cid, cid) for cid in si["class_shahaf_ids"]]
        subj_name = subject_names.get(si["subject_shahaf_id"], si["subject_shahaf_id"])
        teacher_name = teacher_names_map.get(si["teacher_shahaf_id"], si["teacher_shahaf_id"])
        link_id = si["link_id"]
        # Determine layer from class ids
        item_layers = sorted({class_to_layer.get(cid, "") for cid in si["class_shahaf_ids"]} - {""})
        # Auto-deselect non-teaching items (but keep real meetings selected)
        category = _classify_study_item(subj_name, link_id, si["class_shahaf_ids"])
        is_real_meeting = category in ("meeting", "plenary")
        auto_deselect = (
            si["subject_shahaf_id"] == "-1"
            or "פרטני" in subj_name
            or "שהייה" in subj_name
            or "שהיה" in subj_name
            or (not si["class_shahaf_ids"] and not is_real_meeting)
        )

        study_items.append({
            "shahaf_id": si["shahaf_id"],
            "teacher_shahaf_id": si["teacher_shahaf_id"],
            "teacher_name": teacher_name,
            "subject_shahaf_id": si["subject_shahaf_id"],
            "subject_name": subj_name,
            "class_shahaf_ids": si["class_shahaf_ids"],
            "class_names": class_names_list,
            "hours": si["hours"],
            "link_id": link_id,
            "is_grouped": link_id != "0" and link_id != "",
            "category": _classify_study_item(subj_name, link_id, si["class_shahaf_ids"]),
            "layers": item_layers,
            "link_class_count": len(link_classes.get(link_id, set())) if link_id and link_id != "0" else 0,
            "selected": not auto_deselect,
        })

    # Parse teacher blocks (availability)
    teacher_blocks = {}
    try:
        root = fromstring(zf.read("TeacherBlockCollection.xml"))
        day_names = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
        for tb in root.findall("TeacherBlock"):
            tid = _text(tb.find("TeacherId"))
            if tid in ("-1", "0"):
                continue
            blocks_el = tb.find("Blocks")
            if blocks_el is None:
                continue
            blocked_slots = []
            for period_idx, int_el in enumerate(blocks_el.findall("int")):
                mask = int(_text(int_el) or "0")
                if mask == 0:
                    continue
                period = period_idx  # 0-based in Shahaf blocks
                for bit, day_name in enumerate(day_names):
                    if mask & (1 << bit):
                        blocked_slots.append({"day": day_name, "period": period})
            if blocked_slots:
                teacher_blocks[tid] = blocked_slots
    except Exception:
        pass

    zf.close()

    # Enrich teachers with blocked days summary
    DAY_LABELS_HE = {"SUNDAY": "ראשון", "MONDAY": "שני", "TUESDAY": "שלישי",
                     "WEDNESDAY": "רביעי", "THURSDAY": "חמישי", "FRIDAY": "שישי"}
    for t in teachers:
        slots = teacher_blocks.get(t["shahaf_id"], [])
        if slots:
            # Find fully blocked days (all periods blocked)
            from collections import Counter as _Counter
            day_counts = _Counter(s["day"] for s in slots)
            blocked_days = [DAY_LABELS_HE.get(d, d) for d, cnt in day_counts.items() if cnt >= 8]
            t["blocked_days"] = blocked_days
            t["blocked_slots_count"] = len(slots)
        else:
            t["blocked_days"] = []
            t["blocked_slots_count"] = 0

    import base64 as _b64
    backup_b64 = _b64.b64encode(content).decode("ascii")

    return {
        "teachers": teachers,
        "classes": classes,
        "subjects": subjects,
        "study_items": study_items,
        "teacher_blocks": teacher_blocks,
        "layers": all_layers,
        "backup_data": backup_b64,
    }


# ── Import: create entities from filtered preview data ───────────────────

class ImportRequest(BaseModel):
    school_id: int | None = None     # if set, add to existing school
    school_name: str | None = None   # name for new school (ignored if school_id set)
    teachers: list[dict]     # filtered list from preview
    classes: list[dict]      # filtered list with layer info
    subjects: list[dict]     # filtered list
    study_items: list[dict]  # filtered list
    teacher_blocks: dict[str, list[dict]] = {}  # shahaf_teacher_id → blocked_slots
    backup_data: str | None = None  # base64 encoded original ZIP


@router.post("/import")
def import_shahaf_data(data: ImportRequest, db: Session = Depends(get_db)):
    """Import filtered Shahaf data. Creates new school or adds to existing."""
    import traceback
    try:
        return _do_import(data, db)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _do_import(data: ImportRequest, db: Session):
    from datetime import datetime
    from app.models.school import School
    from app.models.teacher import Teacher
    from app.models.class_group import ClassGroup, Grade
    from app.models.subject import Subject, SubjectRequirement

    if data.school_id:
        # Add to existing school
        school = db.get(School, data.school_id)
        if not school:
            raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
        school_id = school.id
        school_name = school.name
        # Update backup if provided
        if data.backup_data:
            import base64 as _b64
            school.shahaf_backup = _b64.b64decode(data.backup_data)
    else:
        # Create new school
        now = datetime.now().strftime("%d/%m/%Y %H:%M")
        school_name = data.school_name or f"ייבוא {now}"
        school = School(name=school_name)
        if data.backup_data:
            import base64 as _b64
            school.shahaf_backup = _b64.b64decode(data.backup_data)
        db.add(school)
        db.flush()
        school_id = school.id

    stats = {"teachers": 0, "classes": 0, "subjects": 0, "requirements": 0, "clusters": 0, "meetings": 0, "skipped": 0, "school_id": school_id, "school_name": school_name}

    # 1. Import grades (derive from class layers)
    layers = sorted({c["layer"] for c in data.classes if c.get("layer")})
    grade_map: dict[str, int] = {}  # layer_name → grade_id
    for i, layer in enumerate(layers):
        existing = db.query(Grade).filter(
            Grade.school_id == school_id, Grade.name == layer
        ).first()
        if existing:
            grade_map[layer] = existing.id
        else:
            grade = Grade(school_id=school_id, name=layer, level=7 + i)
            db.add(grade)
            db.flush()
            grade_map[layer] = grade.id

    # 2. Import classes
    shahaf_class_to_our: dict[str, int] = {}  # shahaf_id → our class_id
    for c in data.classes:
        layer = c.get("layer", "")
        grade_id = grade_map.get(layer)
        if not grade_id:
            continue
        existing = db.query(ClassGroup).filter(
            ClassGroup.school_id == school_id,
            ClassGroup.shahaf_id == c["shahaf_id"],
        ).first()
        if existing:
            shahaf_class_to_our[c["shahaf_id"]] = existing.id
        else:
            cg = ClassGroup(
                school_id=school_id,
                name=c["name"],
                grade_id=grade_id,
                num_students=c.get("students", 0),
                shahaf_id=c["shahaf_id"],
            )
            db.add(cg)
            db.flush()
            shahaf_class_to_our[c["shahaf_id"]] = cg.id
            stats["classes"] += 1

    # 3. Import subjects (with random colors, similar names get same color)
    import hashlib, re as _re

    _SUBJECT_COLORS = [
        "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
        "#EC4899", "#06B6D4", "#F97316", "#14B8A6", "#6366F1",
        "#D946EF", "#0EA5E9", "#84CC16", "#E11D48", "#7C3AED",
        "#2DD4BF", "#FB923C", "#A855F7", "#22D3EE", "#F43F5E",
    ]

    def _base_subject_name(name: str) -> str:
        """Extract base name: 'אנגלית 3 יח"ל' → 'אנגלית'"""
        clean = _re.sub(r'[\d\s]+יח["\']?ל?$', '', name).strip()
        clean = _re.sub(r'\s*\d+\s*$', '', clean).strip()
        return clean or name

    # Map base names to consistent colors
    base_color_map: dict[str, str] = {}

    shahaf_subj_to_our: dict[str, int] = {}
    for s in data.subjects:
        # Skip meeting/admin subjects — they are imported as Meetings
        if _is_meeting_subject(s["name"]):
            continue

        # Assign color based on base name
        base = _base_subject_name(s["name"])
        if base not in base_color_map:
            idx = int(hashlib.md5(base.encode()).hexdigest(), 16) % len(_SUBJECT_COLORS)
            base_color_map[base] = _SUBJECT_COLORS[idx]
        color = base_color_map[base]

        existing = db.query(Subject).filter(
            Subject.school_id == school_id,
            Subject.shahaf_id == s["shahaf_id"],
        ).first()
        if existing:
            # Update color for existing subjects too
            if existing.color == "#3B82F6":  # still default color
                existing.color = color
            shahaf_subj_to_our[s["shahaf_id"]] = existing.id
        else:

            subj = Subject(
                school_id=school_id,
                name=s["name"],
                shahaf_id=s["shahaf_id"],
                color=color,
            )
            db.add(subj)
            db.flush()
            shahaf_subj_to_our[s["shahaf_id"]] = subj.id
            stats["subjects"] += 1

    # 4. Import teachers
    shahaf_teacher_to_our: dict[str, int] = {}
    for t in data.teachers:
        existing = db.query(Teacher).filter(
            Teacher.school_id == school_id,
            Teacher.shahaf_id == t["shahaf_id"],
        ).first()
        # Use name — if encrypted, use shahaf_id as fallback
        name = t["name"]
        if name.startswith("~!") or not name:
            name = f"מורה {t['shahaf_id']}"

        blocked_slots = data.teacher_blocks.get(t["shahaf_id"], [])

        # Detect roles from preview data
        roles = t.get("roles", [])
        roles_str = " ".join(roles)

        if existing:
            # Update existing teacher with all fields
            existing.name = name
            existing.max_hours_per_week = t.get("frontal_hours") or t.get("total_hours") or 0
            existing.rubrica_hours = t.get("target_hours") or t.get("total_hours") or None
            existing.blocked_slots = blocked_slots if blocked_slots else None
            existing.is_coordinator = "רכזת" in roles_str or "רכז" in roles_str
            existing.is_management = "הנהלה" in roles_str
            existing.is_counselor = "יועצת" in roles_str or "יועץ" in roles_str
            shahaf_teacher_to_our[t["shahaf_id"]] = existing.id
        else:
            teacher = Teacher(
                school_id=school_id,
                name=name,
                max_hours_per_week=t.get("frontal_hours") or t.get("total_hours") or 0,
                rubrica_hours=t.get("target_hours") or t.get("total_hours") or None,
                shahaf_id=t["shahaf_id"],
                blocked_slots=blocked_slots if blocked_slots else None,
                is_coordinator="רכזת" in roles_str or "רכז" in roles_str,
                is_management="הנהלה" in roles_str,
                is_counselor="יועצת" in roles_str or "יועץ" in roles_str,
            )
            db.add(teacher)
            db.flush()
            shahaf_teacher_to_our[t["shahaf_id"]] = teacher.id
            stats["teachers"] += 1

    # Update homeroom assignments
    for t in data.teachers:
        if t.get("homeroom_class_id"):
            our_tid = shahaf_teacher_to_our.get(t["shahaf_id"])
            our_cid = shahaf_class_to_our.get(t["homeroom_class_id"])
            if our_tid and our_cid:
                teacher = db.get(Teacher, our_tid)
                if teacher:
                    teacher.homeroom_class_id = our_cid

    # 4b. Link teacher-subject qualifications
    from app.models.teacher import teacher_subjects
    # Build subject name → our_id map
    subject_name_to_id: dict[str, int] = {}
    for s in data.subjects:
        our_sid = shahaf_subj_to_our.get(s["shahaf_id"])
        if our_sid:
            subject_name_to_id[s["name"]] = our_sid

    for t in data.teachers:
        our_tid = shahaf_teacher_to_our.get(t["shahaf_id"])
        if not our_tid:
            continue
        for subj_name in t.get("subjects", []):
            our_sid = subject_name_to_id.get(subj_name)
            if not our_sid:
                continue
            # Check if association already exists
            exists = db.execute(
                teacher_subjects.select().where(
                    teacher_subjects.c.teacher_id == our_tid,
                    teacher_subjects.c.subject_id == our_sid,
                )
            ).first()
            if not exists:
                db.execute(
                    teacher_subjects.insert().values(
                        teacher_id=our_tid, subject_id=our_sid
                    )
                )

    # 5. Import study items — separate meetings from lessons
    from app.models.class_group import GroupingCluster, Track, cluster_source_classes
    from app.models.meeting import Meeting, meeting_teachers

    # 5a. Import meetings (category=meeting/plenary) into Meeting table
    meeting_items: list[dict] = []
    lesson_items: list[dict] = []
    for si in data.study_items:
        cat = si.get("category", "lesson")
        if cat in ("meeting", "plenary"):
            meeting_items.append(si)
        else:
            lesson_items.append(si)

    # Group meeting items by subject name → one Meeting per unique name
    meeting_by_name: dict[str, dict] = {}
    meeting_teacher_map: dict[str, set[int]] = defaultdict(set)
    meeting_hours_map: dict[str, int] = {}
    for si in meeting_items:
        name = si.get("subject_name", "ישיבה")
        our_teacher_id = shahaf_teacher_to_our.get(si["teacher_shahaf_id"])
        if our_teacher_id:
            meeting_teacher_map[name].add(our_teacher_id)
        hours = si.get("hours", 1)
        # Keep the max hours for this meeting type
        meeting_hours_map[name] = max(meeting_hours_map.get(name, 0), hours)
        if name not in meeting_by_name:
            cat = si.get("category", "meeting")
            meeting_by_name[name] = {
                "name": name,
                "category": cat,
            }

    stats["meetings"] = 0
    for name, info in meeting_by_name.items():
        cat = info["category"]
        # Determine meeting type
        if cat == "plenary":
            mtype = "PLENARY"
        elif "מחנכ" in name:
            mtype = "HOMEROOM"
        elif "רכז" in name:
            mtype = "COORDINATORS"
        elif "הנהלה" in name or "ניהול" in name:
            mtype = "MANAGEMENT"
        else:
            mtype = "CUSTOM"

        # Teachers from study items for this meeting
        study_item_teacher_ids = list(meeting_teacher_map.get(name, set()))

        if mtype == "PLENARY":
            # Plenary: all imported teachers participate
            # Teachers from study items = mandatory (locked)
            # All others = preferred (not locked)
            all_teacher_ids = list(shahaf_teacher_to_our.values())
            meeting = Meeting(
                school_id=school_id,
                name=name,
                meeting_type=mtype,
                hours_per_week=meeting_hours_map.get(name, 1),
                is_active=True,
                is_mandatory_attendance=False,  # plenary uses per-teacher model
                locked_teacher_ids=study_item_teacher_ids,  # only study-item teachers are mandatory
            )
            db.add(meeting)
            db.flush()
            for tid in all_teacher_ids:
                db.execute(
                    meeting_teachers.insert().values(
                        meeting_id=meeting.id, teacher_id=tid
                    )
                )
        else:
            meeting = Meeting(
                school_id=school_id,
                name=name,
                meeting_type=mtype,
                hours_per_week=meeting_hours_map.get(name, 1),
                is_active=True,
                is_mandatory_attendance=True,
            )
            db.add(meeting)
            db.flush()
            for tid in study_item_teacher_ids:
                db.execute(
                    meeting_teachers.insert().values(
                        meeting_id=meeting.id, teacher_id=tid
                    )
                )

        stats["meetings"] += 1

    # 5b. Import lesson study items — separate grouped (LinkId) from standalone
    link_groups: dict[str, list[dict]] = defaultdict(list)
    standalone_items: list[dict] = []

    for si in lesson_items:
        link_id = si.get("link_id", "0")
        if link_id and link_id != "0":
            link_groups[link_id].append(si)
        else:
            standalone_items.append(si)

    # 5c. Import standalone requirements (no grouping)
    # Separate multi-class items (shared lessons) from single-class items
    standalone_single: list[dict] = []
    standalone_shared: list[dict] = []
    for si in standalone_items:
        class_ids = si.get("class_shahaf_ids", [])
        if len(class_ids) >= 2:
            standalone_shared.append(si)
        else:
            standalone_single.append(si)

    # 5c-i. Single-class standalone requirements
    for si in standalone_single:
        our_teacher_id = shahaf_teacher_to_our.get(si["teacher_shahaf_id"])
        our_subject_id = shahaf_subj_to_our.get(si["subject_shahaf_id"])
        if not our_teacher_id or not our_subject_id:
            stats["skipped"] += 1
            continue

        class_ids = si.get("class_shahaf_ids", [])
        if not class_ids:
            stats["skipped"] += 1
            continue

        for class_shahaf_id in class_ids:
            our_class_id = shahaf_class_to_our.get(class_shahaf_id)
            if not our_class_id:
                stats["skipped"] += 1
                continue

            existing = db.query(SubjectRequirement).filter(
                SubjectRequirement.school_id == school_id,
                SubjectRequirement.shahaf_id == si["shahaf_id"],
                SubjectRequirement.class_group_id == our_class_id,
            ).first()
            if existing:
                continue

            # Check for same (class, subject, teacher) — merge hours instead of creating duplicate
            same_key = db.query(SubjectRequirement).filter(
                SubjectRequirement.school_id == school_id,
                SubjectRequirement.class_group_id == our_class_id,
                SubjectRequirement.subject_id == our_subject_id,
                SubjectRequirement.teacher_id == our_teacher_id,
                SubjectRequirement.is_grouped == False,
            ).first()
            if same_key:
                same_key.hours_per_week += si.get("hours", 1)
                continue

            req = SubjectRequirement(
                school_id=school_id,
                class_group_id=our_class_id,
                subject_id=our_subject_id,
                teacher_id=our_teacher_id,
                hours_per_week=si.get("hours", 1),
                is_grouped=False,
                shahaf_id=si["shahaf_id"],
            )
            db.add(req)
            stats["requirements"] += 1

    # 5c-ii. Multi-class standalone items → shared lesson clusters
    for si in standalone_shared:
        our_teacher_id = shahaf_teacher_to_our.get(si["teacher_shahaf_id"])
        our_subject_id = shahaf_subj_to_our.get(si["subject_shahaf_id"])
        if not our_teacher_id or not our_subject_id:
            stats["skipped"] += 1
            continue

        class_shahaf_ids = si.get("class_shahaf_ids", [])
        our_class_ids = [shahaf_class_to_our[cid] for cid in class_shahaf_ids if cid in shahaf_class_to_our]
        if len(our_class_ids) < 2:
            stats["skipped"] += 1
            continue

        # Determine grade — if all classes share a grade, use it; otherwise cross-grade
        grade_ids = set()
        for cid in our_class_ids:
            cls = db.get(ClassGroup, cid)
            if cls:
                grade_ids.add(cls.grade_id)
        grade_id = next(iter(grade_ids)) if len(grade_ids) == 1 else None

        subject_name = si.get("subject_name", "")

        cluster = GroupingCluster(
            school_id=school_id,
            name=subject_name,
            subject_id=our_subject_id,
            grade_id=grade_id,
            cluster_type="SHARED_LESSON",
        )
        db.add(cluster)
        db.flush()

        # Link source classes
        for src_cid in our_class_ids:
            db.execute(
                cluster_source_classes.insert().values(
                    cluster_id=cluster.id, class_group_id=src_cid
                )
            )

        # Single track — one teacher teaches all classes together
        track = Track(
            name=subject_name,
            cluster_id=cluster.id,
            teacher_id=our_teacher_id,
            hours_per_week=si.get("hours", 1),
            source_class_id=our_class_ids[0],
        )
        db.add(track)

        # Create grouped requirements per class
        for our_cid in our_class_ids:
            existing = db.query(SubjectRequirement).filter(
                SubjectRequirement.school_id == school_id,
                SubjectRequirement.shahaf_id == si["shahaf_id"],
                SubjectRequirement.class_group_id == our_cid,
            ).first()
            if not existing:
                req = SubjectRequirement(
                    school_id=school_id,
                    class_group_id=our_cid,
                    subject_id=our_subject_id,
                    teacher_id=our_teacher_id,
                    hours_per_week=si.get("hours", 1),
                    is_grouped=True,
                    grouping_cluster_id=cluster.id,
                    shahaf_id=si["shahaf_id"],
                )
                db.add(req)
                stats["requirements"] += 1

        stats["clusters"] += 1

    # 5d. Import grouped items — create GroupingCluster + Tracks
    stats["clusters"] = 0
    for link_id, items in link_groups.items():
        if not items:
            continue

        # Find the first item with a valid subject
        our_subject_id = None
        subject_name = ""
        for si in items:
            sid = shahaf_subj_to_our.get(si.get("subject_shahaf_id", ""))
            if sid:
                our_subject_id = sid
                subject_name = si.get("subject_name", "")
                break
        if not our_subject_id:
            stats["skipped"] += len(items)
            continue

        # Collect all source classes across the group
        all_source_class_ids: set[int] = set()
        all_grade_ids: set[int] = set()
        for si in items:
            for cid in si.get("class_shahaf_ids", []):
                our_cid = shahaf_class_to_our.get(cid)
                if our_cid:
                    all_source_class_ids.add(our_cid)
                    cls = db.get(ClassGroup, our_cid)
                    if cls:
                        all_grade_ids.add(cls.grade_id)

        # Determine cluster type
        is_cross_grade = len(all_grade_ids) > 1
        grade_id = next(iter(all_grade_ids)) if len(all_grade_ids) == 1 else None

        # Check if same teacher appears in multiple items (shared lesson pattern)
        from collections import Counter as _Ctr
        teacher_counts = _Ctr(si.get("teacher_shahaf_id") for si in items)
        has_teacher_duplicates = any(c > 1 for c in teacher_counts.values())

        # Determine cluster name
        cat = items[0].get("category", "grouped")
        if is_cross_grade or cat == "shared" or has_teacher_duplicates:
            cluster_type = "SHARED_LESSON"
            cluster_name = subject_name
        else:
            cluster_type = "REGULAR"
            cluster_name = f"הקבצת {subject_name}"

        # Create cluster
        cluster = GroupingCluster(
            school_id=school_id,
            name=cluster_name,
            subject_id=our_subject_id,
            grade_id=grade_id,
            cluster_type=cluster_type,
        )
        db.add(cluster)
        db.flush()

        # Link source classes
        for src_cid in all_source_class_ids:
            db.execute(
                cluster_source_classes.insert().values(
                    cluster_id=cluster.id, class_group_id=src_cid
                )
            )

        # Create tracks — merge items with the same teacher into ONE track
        # (same teacher in synced cluster = physically the same lesson slot)
        teacher_items: dict[int, list[dict]] = defaultdict(list)
        for si in items:
            our_teacher_id = shahaf_teacher_to_our.get(si["teacher_shahaf_id"])
            if not our_teacher_id:
                stats["skipped"] += 1
                continue
            teacher_items[our_teacher_id].append(si)

        for our_teacher_id, teacher_sis in teacher_items.items():
            # Merge: use first item's name, sum hours, collect all classes
            first_si = teacher_sis[0]
            merged_hours = max(si.get("hours", 1) for si in teacher_sis)
            merged_names = [si.get("subject_name", "") for si in teacher_sis]
            track_name = merged_names[0] if len(merged_names) == 1 else " + ".join(dict.fromkeys(merged_names))

            # Use first item's subject
            item_subject_id = shahaf_subj_to_our.get(first_si.get("subject_shahaf_id", "")) or our_subject_id

            # Collect all class IDs from all merged items
            all_class_ids: list[int] = []
            for si in teacher_sis:
                for cid in si.get("class_shahaf_ids", []):
                    our_cid = shahaf_class_to_our.get(cid)
                    if our_cid and our_cid not in all_class_ids:
                        all_class_ids.append(our_cid)
            source_class_id = all_class_ids[0] if len(all_class_ids) == 1 else None

            track = Track(
                name=track_name,
                cluster_id=cluster.id,
                teacher_id=our_teacher_id,
                hours_per_week=merged_hours,
                source_class_id=source_class_id,
            )
            db.add(track)

            # Create grouped requirements for each item (preserving per-subject data)
            for si in teacher_sis:
                si_subject_id = shahaf_subj_to_our.get(si.get("subject_shahaf_id", "")) or our_subject_id
                for cid in si.get("class_shahaf_ids", []):
                    our_cid = shahaf_class_to_our.get(cid)
                    if not our_cid:
                        continue
                    existing = db.query(SubjectRequirement).filter(
                        SubjectRequirement.school_id == school_id,
                        SubjectRequirement.shahaf_id == si["shahaf_id"],
                        SubjectRequirement.class_group_id == our_cid,
                    ).first()
                    if not existing:
                        req = SubjectRequirement(
                            school_id=school_id,
                            class_group_id=our_cid,
                            subject_id=si_subject_id,
                            teacher_id=our_teacher_id,
                            hours_per_week=si.get("hours", 1),
                            is_grouped=True,
                            grouping_cluster_id=cluster.id,
                            shahaf_id=si["shahaf_id"],
                        )
                        db.add(req)
                        stats["requirements"] += 1

        stats["clusters"] += 1

    db.commit()

    return {
        "success": True,
        "stats": stats,
        "mappings": {
            "teachers": len(shahaf_teacher_to_our),
            "classes": len(shahaf_class_to_our),
            "subjects": len(shahaf_subj_to_our),
        },
    }
