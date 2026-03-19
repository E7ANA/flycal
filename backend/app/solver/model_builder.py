"""Builds the OR-Tools CP-SAT model with decision variables and system constraints.

System constraints are hardcoded rules representing physical/logical reality.
They are ALWAYS enforced and NOT stored in the user constraints table.
"""

from dataclasses import dataclass, field

from ortools.sat.python import cp_model
from sqlalchemy.orm import Session

from app.models.class_group import ClassGroup, GroupingCluster, Track
from app.models.meeting import Meeting, MeetingType
from app.models.school import School
from app.models.subject import Subject, SubjectRequirement
from app.models.teacher import Teacher
from app.models.timeslot import DayOfWeek, TimeSlot


@dataclass
class SolverData:
    """All data loaded from the DB that the solver needs."""

    school: School
    class_groups: list[ClassGroup]
    requirements: list[SubjectRequirement]
    timeslots: list[TimeSlot]
    clusters: list[GroupingCluster]
    meetings: list[Meeting] = field(default_factory=list)
    # All subjects in the school (for track name → subject_id resolution)
    all_subjects: list = field(default_factory=list)
    # teacher_id -> set of blocked (day, period)
    teacher_blocked_slots: dict[int, set[tuple[str, int]]] = field(default_factory=dict)
    # teacher_id -> homeroom class_group_id
    homeroom_map: dict[int, int] = field(default_factory=dict)
    # teacher_id -> min_free_days (from MIN_FREE_DAYS constraints)
    min_free_days_map: dict[int, int] = field(default_factory=dict)
    # teacher_id -> rubrica (general) hours
    teacher_rubrica_map: dict[int, float] = field(default_factory=dict)
    # teacher_id -> manual override for max work days
    teacher_max_work_days: dict[int, int] = field(default_factory=dict)
    # teacher_ids exempt from "must teach on meeting day" (management + counselors)
    meeting_day_exempt_ids: set[int] = field(default_factory=set)
    # Specific overlap pairs: set of ((type1, id1), (type2, id2)) — normalized
    allowed_overlap_pairs: set[tuple[tuple[str, int], tuple[str, int]]] = field(
        default_factory=set
    )
    # grade_id -> {day: max_period} from GRADE_ACTIVITY_HOURS constraints
    grade_periods_map: dict[int, dict[str, int]] = field(default_factory=dict)
    # Derived lookups
    available_slots: list[tuple[str, int]] = field(default_factory=list)
    days: list[str] = field(default_factory=list)
    max_period_per_day: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.available_slots = [
            (ts.day, ts.period) for ts in self.timeslots if ts.is_available
        ]
        day_set: dict[str, int] = {}
        for ts in self.timeslots:
            if ts.is_available:
                if ts.day not in day_set or ts.period > day_set[ts.day]:
                    day_set[ts.day] = ts.period
        self.days = list(day_set.keys())
        self.max_period_per_day = day_set


@dataclass
class SolverVariables:
    """Container for all CP-SAT decision variables."""

    # x[(class_group_id, subject_id, teacher_id, day, period)] -> BoolVar
    x: dict[tuple[int, int, int, str, int], cp_model.IntVar] = field(
        default_factory=dict
    )
    # Track variables: x_track[(track_id, day, period)] -> BoolVar
    x_track: dict[tuple[int, str, int], cp_model.IntVar] = field(
        default_factory=dict
    )
    # Meeting variables: x_meeting[(meeting_id, day, period)] -> BoolVar
    x_meeting: dict[tuple[int, str, int], cp_model.IntVar] = field(
        default_factory=dict
    )
    # Penalty variables for soft user constraints (filled by constraint_compiler)
    # Each entry: (variable, weight, constraint_id)
    penalties: list[tuple[cp_model.IntVar, int, int]] = field(default_factory=list)
    # Brain constraint metadata: {negative_id: {"name": str, "weight": int}}
    brain_info: dict[int, dict] = field(default_factory=dict)
    # Per-penalty group labels for per-grade score breakdown
    # Maps penalty index -> group label (e.g., "ז'1", "ח'2")
    penalty_labels: dict[int, str] = field(default_factory=dict)


def _normalize_pair(
    t1: str, id1: int, t2: str, id2: int,
) -> tuple[tuple[str, int], tuple[str, int]]:
    """Normalize an overlap pair so (A, B) == (B, A)."""
    a, b = (t1, id1), (t2, id2)
    return (a, b) if a <= b else (b, a)


def load_solver_data(db: Session, school_id: int) -> SolverData:
    """Load all data needed for the solver from the database."""
    school = db.get(School, school_id)
    if not school:
        raise ValueError(f"בית ספר {school_id} לא נמצא")

    class_groups = (
        db.query(ClassGroup).filter(ClassGroup.school_id == school_id).all()
    )
    # Filter out hidden requirements and requirements for hidden subjects
    hidden_subject_ids = {
        s.id for s in db.query(Subject).filter(
            Subject.school_id == school_id, Subject.is_hidden == True
        ).all()
    }
    requirements = [
        r for r in db.query(SubjectRequirement)
        .filter(SubjectRequirement.school_id == school_id)
        .all()
        if r.subject_id not in hidden_subject_ids and not r.is_hidden and not r.is_grouped
    ]
    timeslots = (
        db.query(TimeSlot).filter(TimeSlot.school_id == school_id).all()
    )
    clusters = (
        db.query(GroupingCluster)
        .filter(GroupingCluster.school_id == school_id)
        .all()
    )
    all_subjects = (
        db.query(Subject).filter(Subject.school_id == school_id).all()
    )

    # Load active meetings and refresh built-in type teachers
    meetings = (
        db.query(Meeting)
        .filter(Meeting.school_id == school_id, Meeting.is_active == True)
        .all()
    )
    for meeting in meetings:
        if meeting.meeting_type != MeetingType.CUSTOM.value:
            resolved = _resolve_meeting_teachers(
                db, school_id, meeting.meeting_type
            )
            if resolved:
                meeting.teachers = resolved
            # If auto-resolve returns empty, keep manually-assigned teachers

    # Load teacher blocked slots
    teacher_blocked_slots: dict[int, set[tuple[str, int]]] = {}
    all_teacher_ids: set[int] = set()
    for req in requirements:
        if req.teacher_id is not None and not req.is_grouped:
            all_teacher_ids.add(req.teacher_id)
        if req.co_teacher_ids and not req.is_grouped:
            all_teacher_ids.update(req.co_teacher_ids)
    for cl in clusters:
        for tr in cl.tracks:
            if tr.teacher_id is not None:
                all_teacher_ids.add(tr.teacher_id)
    for m in meetings:
        for t in m.teachers:
            all_teacher_ids.add(t.id)

    homeroom_map: dict[int, int] = {}
    teacher_rubrica_map: dict[int, float] = {}
    teacher_max_work_days: dict[int, int] = {}
    meeting_day_exempt_ids: set[int] = set()
    if all_teacher_ids:
        teachers_with_blocks = (
            db.query(Teacher)
            .filter(Teacher.id.in_(all_teacher_ids))
            .all()
        )
        meeting_day_exempt_ids: set[int] = set()
        for t in teachers_with_blocks:
            if t.blocked_slots:
                teacher_blocked_slots[t.id] = {
                    (slot["day"], slot["period"]) for slot in t.blocked_slots
                }
            if t.homeroom_class_id is not None:
                homeroom_map[t.id] = t.homeroom_class_id
            if t.rubrica_hours is not None:
                teacher_rubrica_map[t.id] = t.rubrica_hours
            if t.max_work_days is not None:
                teacher_max_work_days[t.id] = t.max_work_days
            # Management and counselors exempt from meeting-day teaching rule
            if (
                getattr(t, "is_management", False)
                or getattr(t, "is_principal", False)
                or getattr(t, "is_director", False)
                or getattr(t, "is_pedagogical_coordinator", False)
                or getattr(t, "is_counselor", False)
            ):
                meeting_day_exempt_ids.add(t.id)

    # Load MIN_FREE_DAYS constraints for brain integration
    from app.models.constraint import Constraint
    min_free_days_map: dict[int, int] = {}
    mfd_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == school_id,
            Constraint.rule_type == "MIN_FREE_DAYS",
            Constraint.is_active == True,
            Constraint.type == "HARD",
        )
        .all()
    )
    for c in mfd_constraints:
        if c.target_id is not None:
            min_days = (c.parameters or {}).get("min_days", 0)
            if min_days > 0:
                min_free_days_map[c.target_id] = max(
                    min_free_days_map.get(c.target_id, 0), min_days
                )

    # Load GRADE_ACTIVITY_HOURS constraints for validation
    grade_periods_map: dict[int, dict[str, int]] = {}
    gah_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == school_id,
            Constraint.rule_type == "GRADE_ACTIVITY_HOURS",
            Constraint.is_active == True,
        )
        .all()
    )
    for c in gah_constraints:
        if c.target_id is not None:
            pmap = (c.parameters or {}).get("periods_per_day_map", {})
            if pmap:
                grade_periods_map[c.target_id] = pmap

    # Load specific allowed overlap pairs
    from app.models.timetable import AllowedOverlap
    allowed_overlap_pairs: set[tuple[tuple[str, int], tuple[str, int]]] = set()
    ao_rows = (
        db.query(AllowedOverlap)
        .filter(AllowedOverlap.school_id == school_id)
        .all()
    )
    for ao in ao_rows:
        pair = _normalize_pair(ao.item1_type, ao.item1_id, ao.item2_type, ao.item2_id)
        allowed_overlap_pairs.add(pair)

    return SolverData(
        school=school,
        class_groups=class_groups,
        requirements=requirements,
        timeslots=timeslots,
        clusters=clusters,
        meetings=meetings,
        all_subjects=all_subjects,
        teacher_blocked_slots=teacher_blocked_slots,
        homeroom_map=homeroom_map,
        teacher_rubrica_map=teacher_rubrica_map,
        teacher_max_work_days=teacher_max_work_days,
        meeting_day_exempt_ids=meeting_day_exempt_ids,
        min_free_days_map=min_free_days_map,
        allowed_overlap_pairs=allowed_overlap_pairs,
        grade_periods_map=grade_periods_map,
    )


def _resolve_meeting_teachers(
    db: Session, school_id: int, meeting_type: str
) -> list[Teacher]:
    """Auto-resolve teachers for built-in meeting types."""
    q = db.query(Teacher).filter(Teacher.school_id == school_id)
    if meeting_type == MeetingType.HOMEROOM.value:
        q = q.filter(Teacher.homeroom_class_id.isnot(None))
    elif meeting_type == MeetingType.COORDINATORS.value:
        q = q.filter(Teacher.is_coordinator == True)
    elif meeting_type == MeetingType.MANAGEMENT.value:
        q = q.filter(
            (Teacher.is_management == True)
            | (Teacher.is_principal == True)
            | (Teacher.is_director == True)
            | (Teacher.is_pedagogical_coordinator == True)
        )
    else:
        return []
    return q.all()


def create_variables(
    model: cp_model.CpModel, data: SolverData
) -> SolverVariables:
    """Create decision variables for all non-grouped requirements and tracks."""
    variables = SolverVariables()

    # Variables for regular (non-grouped) requirements
    for req in data.requirements:
        if req.is_grouped:
            continue
        if req.teacher_id is None:
            continue
        for day, period in data.available_slots:
            key = (req.class_group_id, req.subject_id, req.teacher_id, day, period)
            variables.x[key] = model.new_bool_var(
                f"x_c{req.class_group_id}_s{req.subject_id}_t{req.teacher_id}_{day}_p{period}"
            )

    # Variables for grouped tracks
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            for day, period in data.available_slots:
                key = (track.id, day, period)
                variables.x_track[key] = model.new_bool_var(
                    f"xtr_tr{track.id}_{day}_p{period}"
                )

    # Variables for meetings
    for meeting in data.meetings:
        if not meeting.teachers:
            continue
        for day, period in data.available_slots:
            key = (meeting.id, day, period)
            variables.x_meeting[key] = model.new_bool_var(
                f"xm_m{meeting.id}_{day}_p{period}"
            )

    return variables


def add_system_constraints(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    """Add all system constraints that are ALWAYS enforced."""

    _add_teacher_no_overlap(model, data, variables)
    _add_class_no_overlap(model, data, variables)
    _add_hours_exact_fulfillment(model, data, variables)
    _add_teacher_qualification(model, data, variables)
    _add_class_availability(model, data, variables)
    _add_grouping_sync(model, data, variables)
    _add_single_teacher_per_assignment(model, data, variables)
    _add_meeting_hours_fulfillment(model, data, variables)
    _add_meeting_consecutive_periods(model, data, variables)
    _add_meetings_on_teaching_days(model, data, variables)
    _add_teacher_blocked_slots(model, data, variables)
    _add_homeroom_must_teach_sunday(model, data, variables)
    _add_secondary_track_end_of_day(model, data, variables)
    _add_pinned_lessons(model, data, variables)
    _add_pinned_meetings(model, data, variables)
    _add_pinned_tracks(model, data, variables)
    _add_blocked_requirement_slots(model, data, variables)
    _add_blocked_track_slots(model, data, variables)
    _add_blocked_meeting_slots(model, data, variables)
    _add_plenary_no_overlap_with_meetings(model, data, variables)
    _add_grouping_contiguous_prefix(model, data, variables)
    _add_grouping_extra_hours_end_of_day(model, data, variables)
    _add_linked_tracks_no_overlap(model, data, variables)
    _add_subject_blocked_slots(model, data, variables)
    _add_high_school_daily_core(model, data, variables)
    _add_subject_link_group_daily_limit(model, data, variables)
    _add_subject_limit_last_periods(model, data, variables)
    _add_teacher_late_finish_limit(model, data, variables)


# ---------------------------------------------------------------------------
# System Constraint 1: Teacher No Overlap
# A teacher can teach at most 1 lesson per timeslot.
# ---------------------------------------------------------------------------
def _add_teacher_no_overlap(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Collect all teacher IDs
    teacher_ids: set[int] = set()
    for req in data.requirements:
        if req.teacher_id is not None and not req.is_grouped:
            teacher_ids.add(req.teacher_id)
        if req.co_teacher_ids and not req.is_grouped:
            teacher_ids.update(req.co_teacher_ids)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teacher_ids.add(track.teacher_id)
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_ids.add(t.id)

    # Build co-teacher mapping: (class_id, subject_id, primary_teacher_id) -> co_teacher_ids
    co_teacher_map: dict[tuple[int, int, int], list[int]] = {}
    for req in data.requirements:
        if req.co_teacher_ids and req.teacher_id is not None and not req.is_grouped:
            co_teacher_map[(req.class_group_id, req.subject_id, req.teacher_id)] = (
                req.co_teacher_ids
            )

    # Pre-build requirement id lookup: (c_id, s_id, t_id) -> requirement id
    req_id_map: dict[tuple[int, int, int], int] = {}
    for req in data.requirements:
        if req.teacher_id is not None and not req.is_grouped:
            req_id_map[(req.class_group_id, req.subject_id, req.teacher_id)] = req.id

    for teacher_id in teacher_ids:
        for day, period in data.available_slots:
            # Collect (item_type, item_id, var) tuples — ALL items, no skipping
            items_at_slot: list[tuple[str, int, cp_model.IntVar]] = []

            # Regular requirement variables for this teacher at this slot
            for key, var in variables.x.items():
                c_id, s_id, t_id, d, p = key
                if d != day or p != period:
                    continue
                # Primary teacher match
                if t_id == teacher_id:
                    rid = req_id_map.get((c_id, s_id, t_id), 0)
                    items_at_slot.append(("requirement", rid, var))
                # Co-teacher match
                elif teacher_id in co_teacher_map.get((c_id, s_id, t_id), []):
                    rid = req_id_map.get((c_id, s_id, t_id), 0)
                    items_at_slot.append(("requirement", rid, var))

            # Track variables for this teacher at this slot
            # For synced clusters: only add ONE track per teacher per cluster
            # (all tracks are synced to same slots, so multiple tracks = same physical lesson)
            seen_teacher_clusters: set[int] = set()
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id == teacher_id:
                        # Skip if we already added a track for this teacher in this cluster
                        cluster_key = cluster.id
                        if cluster_key in seen_teacher_clusters:
                            continue
                        seen_teacher_clusters.add(cluster_key)
                        tk = (track.id, day, period)
                        if tk in variables.x_track:
                            items_at_slot.append(("track", track.id, variables.x_track[tk]))

            # Meeting variables for this teacher at this slot
            # (only mandatory-attendance meetings participate in no-overlap)
            for meeting in data.meetings:
                if not getattr(meeting, "is_mandatory_attendance", True):
                    continue  # Flexible meetings handled by brain as SOFT
                if any(t.id == teacher_id for t in meeting.teachers):
                    mk = (meeting.id, day, period)
                    if mk in variables.x_meeting:
                        items_at_slot.append(("meeting", meeting.id, variables.x_meeting[mk]))

            if len(items_at_slot) <= 1:
                continue

            # Check if ANY pair has an allowed overlap
            has_any_allowed = False
            if data.allowed_overlap_pairs:
                for i in range(len(items_at_slot)):
                    for j in range(i + 1, len(items_at_slot)):
                        pair = _normalize_pair(
                            items_at_slot[i][0], items_at_slot[i][1],
                            items_at_slot[j][0], items_at_slot[j][1],
                        )
                        if pair in data.allowed_overlap_pairs:
                            has_any_allowed = True
                            break
                    if has_any_allowed:
                        break

            if not has_any_allowed:
                # Fast path: no allowed overlaps — single sum constraint
                model.add(sum(var for _, _, var in items_at_slot) <= 1)
            else:
                # Pairwise constraints, skipping allowed pairs
                for i in range(len(items_at_slot)):
                    for j in range(i + 1, len(items_at_slot)):
                        pair = _normalize_pair(
                            items_at_slot[i][0], items_at_slot[i][1],
                            items_at_slot[j][0], items_at_slot[j][1],
                        )
                        if pair not in data.allowed_overlap_pairs:
                            model.add(items_at_slot[i][2] + items_at_slot[j][2] <= 1)


# ---------------------------------------------------------------------------
# System Constraint 2: Class No Overlap
# A class can have at most 1 lesson per timeslot.
# ---------------------------------------------------------------------------
def _add_class_no_overlap(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    class_ids = {cg.id for cg in data.class_groups}

    # Build set of external requirement keys (class_id, subject_id) to skip
    external_keys: set[tuple[int, int]] = set()
    for req in data.requirements:
        if req.is_external and not req.is_grouped:
            external_keys.add((req.class_group_id, req.subject_id))

    for class_id in class_ids:
        for day, period in data.available_slots:
            vars_at_slot: list[cp_model.IntVar] = []

            # Regular requirements for this class (skip external)
            for key, var in variables.x.items():
                c_id, s_id, t_id, d, p = key
                if c_id == class_id and d == day and p == period:
                    if (c_id, s_id) in external_keys:
                        continue
                    vars_at_slot.append(var)

            # Cluster contribution: only count tracks that SERVE this class.
            # A track serves class_id if:
            #   - source_class_id is None (shared track, serves all source classes), OR
            #   - source_class_id == class_id
            for cluster in data.clusters:
                source_ids = {sc.id for sc in cluster.source_classes}
                if class_id not in source_ids:
                    continue

                serving_vars: list[cp_model.IntVar] = []
                for track in cluster.tracks:
                    if track.teacher_id is None or track.is_secondary:
                        continue
                    if (track.source_class_id is not None
                            and track.source_class_id != class_id):
                        continue  # Track serves a different class
                    tk = (track.id, day, period)
                    if tk in variables.x_track:
                        serving_vars.append(variables.x_track[tk])

                if len(serving_vars) == 1:
                    vars_at_slot.append(serving_vars[0])
                elif len(serving_vars) > 1:
                    # Multiple tracks serve this class — they may have
                    # different hours (subset sync) or be linked (no overlap).
                    # Use OR: class is blocked if ANY serving track is active.
                    or_var = model.new_bool_var(
                        f"cl{cluster.id}_c{class_id}_{day}_p{period}"
                    )
                    model.add_max_equality(or_var, serving_vars)
                    vars_at_slot.append(or_var)

            if len(vars_at_slot) > 1:
                model.add(sum(vars_at_slot) <= 1)


# ---------------------------------------------------------------------------
# System Constraint 3: Hours Exact Fulfillment
# Each requirement gets exactly its required weekly hours.
# ---------------------------------------------------------------------------
def _add_hours_exact_fulfillment(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Regular requirements
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        req_vars: list[cp_model.IntVar] = []
        for key, var in variables.x.items():
            c_id, s_id, t_id, d, p = key
            if (c_id == req.class_group_id and s_id == req.subject_id
                    and t_id == req.teacher_id):
                req_vars.append(var)

        if req_vars:
            model.add(sum(req_vars) == req.hours_per_week)

    # Track requirements
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            track_vars: list[cp_model.IntVar] = []
            for key, var in variables.x_track.items():
                tr_id, d, p = key
                if tr_id == track.id:
                    track_vars.append(var)
            if track_vars:
                model.add(sum(track_vars) == track.hours_per_week)


# ---------------------------------------------------------------------------
# System Constraint 4: Teacher Qualification
# Handled implicitly — we only create variables for assigned teacher-subject
# pairs from SubjectRequirement, so unqualified combinations don't exist.
# ---------------------------------------------------------------------------
def _add_teacher_qualification(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    pass  # Enforced by variable creation — no vars for unqualified pairs


# ---------------------------------------------------------------------------
# System Constraint 5: Class Availability
# No lessons when timeslot is unavailable.
# Handled implicitly — we only create variables for available timeslots.
# ---------------------------------------------------------------------------
def _add_class_availability(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    pass  # Enforced by variable creation — only available slots get variables


# ---------------------------------------------------------------------------
# System Constraint 6: Grouping Sync
# Tracks in a cluster share a common set of timeslots.
#
# Equal-hours case: all tracks must occupy the exact same timeslots.
# Variable-hours case: all tracks share min_hours "shared" timeslots.
#   Each track MUST be active at every shared slot. Extra hours beyond
#   min_hours can be scheduled freely at any valid timeslot.
# ---------------------------------------------------------------------------
@dataclass
class _SyncParticipant:
    """A participant in grouping sync — either a real track or a virtual linked group."""

    id: int  # track.id or negative for virtual
    hours_per_week: int
    # For virtual groups: mapping from (day, period) -> OR variable
    slot_vars: dict[tuple[str, int], cp_model.IntVar] = field(default_factory=dict)
    is_virtual: bool = False


def _add_grouping_sync(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for cluster in data.clusters:
        # Secondary tracks are NOT synced with the grouping — they schedule independently.
        # Linked tracks (link_group with 2+ tracks) represent tracks attended by the
        # SAME students at different times. Individually they must NOT be synced, but
        # collectively (as a group) they must participate in sync so that the grouping
        # timeslots overlap correctly across classes.
        link_groups: dict[int, list] = {}
        for t in cluster.tracks:
            if t.link_group is not None and t.teacher_id is not None and not t.is_secondary:
                link_groups.setdefault(t.link_group, []).append(t)

        # Build sync participants: regular tracks + virtual linked groups
        participants: list[_SyncParticipant] = []

        for t in cluster.tracks:
            if t.teacher_id is None or t.is_secondary:
                continue
            if t.link_group is not None and len(link_groups.get(t.link_group, [])) >= 2:
                continue  # Will be represented by virtual group
            participants.append(_SyncParticipant(id=t.id, hours_per_week=t.hours_per_week))

        # Create virtual participants for each multi-track link_group
        for lg_id, lg_tracks in link_groups.items():
            if len(lg_tracks) < 2:
                continue
            combined_hours = sum(t.hours_per_week for t in lg_tracks)
            virtual = _SyncParticipant(
                id=-lg_id,  # Negative to avoid collision with real track IDs
                hours_per_week=combined_hours,
                is_virtual=True,
            )
            # Create OR variable per timeslot: active if ANY linked track is active
            for day, period in data.available_slots:
                member_vars = []
                for t in lg_tracks:
                    tk = (t.id, day, period)
                    if tk in variables.x_track:
                        member_vars.append(variables.x_track[tk])
                if member_vars:
                    or_var = model.new_bool_var(
                        f"lg{lg_id}_or_{day}_p{period}"
                    )
                    model.add_max_equality(or_var, member_vars)
                    virtual.slot_vars[(day, period)] = or_var
            participants.append(virtual)

        if len(participants) < 2:
            continue

        hours_set = set(p.hours_per_week for p in participants)

        if len(hours_set) == 1:
            _add_grouping_sync_equal_v2(model, data, variables, participants)
        else:
            _add_grouping_sync_variable_v2(model, data, variables, participants)


def _get_participant_var(
    p: _SyncParticipant,
    variables: SolverVariables,
    day: str,
    period: int,
) -> cp_model.IntVar | None:
    """Get the variable for a sync participant at a given timeslot."""
    if p.is_virtual:
        return p.slot_vars.get((day, period))
    tk = (p.id, day, period)
    return variables.x_track.get(tk)


def _add_grouping_sync_equal_v2(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    participants: list[_SyncParticipant],
) -> None:
    """All participants have the same hours — force identical timeslots."""
    ref = participants[0]
    for other in participants[1:]:
        for day, period in data.available_slots:
            v_ref = _get_participant_var(ref, variables, day, period)
            v_other = _get_participant_var(other, variables, day, period)
            if v_ref is not None and v_other is not None:
                model.add(v_other == v_ref)


def _add_grouping_sync_variable_v2(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    participants: list[_SyncParticipant],
) -> None:
    """Participants have different hours_per_week.

    The participant(s) with the most hours define the "envelope".
    All shorter participants must only be active within this envelope
    (their slots are a subset of it).

    Participants with the same hours are synced to identical timeslots.
    """
    max_hours = max(p.hours_per_week for p in participants)
    if max_hours <= 0:
        return

    # Group by hours_per_week
    by_hours: dict[int, list[_SyncParticipant]] = {}
    for p in participants:
        by_hours.setdefault(p.hours_per_week, []).append(p)

    # 1. Sync participants with the same hours (identical timeslots within group)
    for hrs, group in by_hours.items():
        if len(group) >= 2:
            _add_grouping_sync_equal_v2(model, data, variables, group)

    # 2. Use one reference participant (max hours) as the envelope.
    #    All shorter participants must be subsets: p[ts] <= ref[ts]
    ref = by_hours[max_hours][0]

    for p in participants:
        if p.hours_per_week == max_hours:
            continue
        for day, period in data.available_slots:
            v_ref = _get_participant_var(ref, variables, day, period)
            v_p = _get_participant_var(p, variables, day, period)
            if v_ref is not None and v_p is not None:
                model.add(v_p <= v_ref)


# ---------------------------------------------------------------------------
# System Constraint 7: Single Teacher Per Assignment
# Handled implicitly — each SubjectRequirement has a fixed teacher_id,
# and we only create variables for that specific teacher.
# ---------------------------------------------------------------------------
def _add_single_teacher_per_assignment(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    pass  # Enforced by variable creation — one teacher per requirement


# ---------------------------------------------------------------------------
# System Constraint 8: Meeting Hours Fulfillment
# Each meeting gets exactly its hours_per_week.
# ---------------------------------------------------------------------------
def _add_meeting_hours_fulfillment(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for meeting in data.meetings:
        if not meeting.teachers:
            continue
        meeting_vars: list[cp_model.IntVar] = []
        for key, var in variables.x_meeting.items():
            m_id, d, p = key
            if m_id == meeting.id:
                meeting_vars.append(var)
        if meeting_vars:
            model.add(sum(meeting_vars) == meeting.hours_per_week)


# ---------------------------------------------------------------------------
# System Constraint 8a: Meeting Consecutive Periods
# When require_consecutive is True, all meeting hours must be in a single
# contiguous block on the same day (e.g. 2 hours → double period).
# ---------------------------------------------------------------------------
def _add_meeting_consecutive_periods(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for meeting in data.meetings:
        if not meeting.teachers or not getattr(meeting, "require_consecutive", False):
            continue
        hours = meeting.hours_per_week
        if hours < 2:
            continue  # No consecutive constraint needed for 1 hour

        # Collect sorted periods per day for this meeting
        day_periods: dict[str, list[int]] = {}
        for key in variables.x_meeting:
            m_id, day, period = key
            if m_id == meeting.id:
                day_periods.setdefault(day, []).append(period)

        for day in day_periods:
            day_periods[day].sort()

        # All hours must be on a single day in consecutive periods.
        # Create a bool per day indicating if the meeting is on that day.
        day_bools: list[cp_model.IntVar] = []
        for day, periods in day_periods.items():
            day_vars = [
                variables.x_meeting[(meeting.id, day, p)]
                for p in periods
            ]
            day_has = model.new_bool_var(f"meeting_{meeting.id}_on_{day}")
            # day_has = 1 iff any meeting var on this day is 1
            model.add(sum(day_vars) >= 1).only_enforce_if(day_has)
            model.add(sum(day_vars) == 0).only_enforce_if(day_has.negated())
            day_bools.append(day_has)

            # If meeting is on this day, all hours must be consecutive.
            # For each valid start position, create a block bool.
            if len(periods) < hours:
                # Not enough periods on this day — block it entirely
                model.add(sum(day_vars) == 0)
                continue

            block_starts: list[cp_model.IntVar] = []
            for i in range(len(periods) - hours + 1):
                # Check if periods[i:i+hours] are all consecutive
                is_consecutive = all(
                    periods[i + j + 1] == periods[i + j] + 1
                    for j in range(hours - 1)
                )
                if not is_consecutive:
                    continue
                block_var = model.new_bool_var(
                    f"meeting_{meeting.id}_{day}_block_at_p{periods[i]}"
                )
                block_starts.append(block_var)
                # If this block is chosen, exactly these periods are 1
                for j in range(hours):
                    model.add(
                        variables.x_meeting[(meeting.id, day, periods[i + j])] == 1
                    ).only_enforce_if(block_var)
                # Periods outside this block must be 0
                for j, p in enumerate(periods):
                    if j < i or j >= i + hours:
                        model.add(
                            variables.x_meeting[(meeting.id, day, p)] == 0
                        ).only_enforce_if(block_var)

            if block_starts:
                # If meeting is on this day, exactly one block must be chosen
                model.add(sum(block_starts) == 1).only_enforce_if(day_has)
            else:
                # No valid consecutive block on this day — block it
                model.add(sum(day_vars) == 0)

        # Meeting must be on exactly one day
        if day_bools:
            model.add(sum(day_bools) == 1)


# ---------------------------------------------------------------------------
# System Constraint 8b: Meetings On Teaching Days
# Meetings are only scheduled on days when ALL participating teachers teach.
# ---------------------------------------------------------------------------
def _add_meetings_on_teaching_days(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Build teacher_teaches_on_day[teacher_id][day] = list of lesson/track vars
    # Exclude vars on blocked slots — a teacher with all slots blocked on a day
    # should not be considered "active" on that day.
    teacher_day_vars: dict[int, dict[str, list[cp_model.IntVar]]] = {}

    for key, var in variables.x.items():
        _c, _s, t_id, day, _p = key
        if (day, _p) in data.teacher_blocked_slots.get(t_id, set()):
            continue
        teacher_day_vars.setdefault(t_id, {}).setdefault(day, []).append(var)

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in variables.x_track.items():
                    tk_id, day, _p = key
                    if tk_id == track.id:
                        if (day, _p) in data.teacher_blocked_slots.get(track.teacher_id, set()):
                            continue
                        teacher_day_vars.setdefault(track.teacher_id, {}).setdefault(day, []).append(var)

    for meeting in data.meetings:
        if not meeting.teachers:
            continue

        # Non-mandatory meetings: teachers attend only if already teaching that day.
        # Exception: locked_teacher_ids are always mandatory even in non-mandatory meetings.
        is_mandatory = getattr(meeting, "is_mandatory_attendance", True)
        locked_ids: set[int] = set(getattr(meeting, "locked_teacher_ids", None) or [])

        # Build set of teachers who have a blocked-slot conflict with any
        # of the meeting's pinned slots.  These teachers are automatically
        # excused — they cannot attend and must not constrain the meeting.
        pinned = getattr(meeting, "pinned_slots", None) or []
        pinned_set: set[tuple[str, int]] = set()
        pinned_days: set[str] = set()
        for pin in pinned:
            d = pin.get("day") if isinstance(pin, dict) else getattr(pin, "day", None)
            p = pin.get("period") if isinstance(pin, dict) else getattr(pin, "period", None)
            if d is not None and p is not None:
                pinned_set.add((d, p))
                pinned_days.add(d)

        conflicting_teacher_ids: set[int] = set()
        if pinned_set:
            for teacher in meeting.teachers:
                teacher_blocked = data.teacher_blocked_slots.get(teacher.id, set())
                if teacher_blocked & pinned_set:
                    conflicting_teacher_ids.add(teacher.id)

        for day in data.days:
            # Collect meeting vars for this meeting on this day
            day_meeting_vars: list[cp_model.IntVar] = []
            for key, var in variables.x_meeting.items():
                m_id, d, _p = key
                if m_id == meeting.id and d == day:
                    day_meeting_vars.append(var)

            if not day_meeting_vars:
                continue

            # For non-pinned days, enforce all relevant teachers.
            # For pinned days of mandatory meetings: still enforce locked
            # teachers — they must teach on days they attend a mandatory meeting.
            # For pinned days of non-mandatory meetings: skip (teacher is
            # already committed to being at school).
            is_pinned_day = day in pinned_days

            # Determine which teachers to enforce for this meeting
            if is_mandatory:
                if is_pinned_day:
                    # Pinned mandatory day: only enforce locked teachers
                    enforced_teachers = [
                        t for t in meeting.teachers
                        if t.id in locked_ids and t.id not in conflicting_teacher_ids
                    ]
                else:
                    enforced_teachers = [
                        t for t in meeting.teachers
                        if t.id not in conflicting_teacher_ids
                    ]
            elif is_pinned_day:
                continue  # Non-mandatory pinned day: skip enforcement
            elif locked_ids:
                # Non-mandatory but with locked teachers: only enforce locked ones
                enforced_teachers = [
                    t for t in meeting.teachers
                    if t.id in locked_ids and t.id not in conflicting_teacher_ids
                ]
            else:
                # Fully non-mandatory: skip all enforcement
                continue

            # For each enforced teacher, if they have no lessons on this day,
            # no meeting can be scheduled on this day.
            # Skip teachers with no teaching assignments at all (admins/managers) —
            # they can attend meetings on any day.
            # Skip management + counselor staff — exempt from meeting-day rule.
            # Also skip teachers excused from this meeting (approved via overlap system).
            for teacher in enforced_teachers:
                # Management/counselor staff exempt from teaching-day requirement
                if teacher.id in data.meeting_day_exempt_ids:
                    continue

                # Check if teacher is excused from this meeting
                excused_pair = _normalize_pair(
                    "meeting", meeting.id, "teacher_absence", teacher.id
                )
                if excused_pair in data.allowed_overlap_pairs:
                    continue  # Teacher excused — absent from this meeting

                all_teacher_vars = teacher_day_vars.get(teacher.id, {})
                has_any_teaching = any(
                    len(vars_list) > 0 for vars_list in all_teacher_vars.values()
                )
                if not has_any_teaching:
                    continue  # Non-teaching staff — don't constrain meeting days

                lesson_vars = all_teacher_vars.get(day, [])
                if not lesson_vars:
                    # Teacher has no possible lessons on this day → block meeting here
                    for mv in day_meeting_vars:
                        model.add(mv == 0)
                    break  # No need to check other teachers
                else:
                    # teacher_active_on_day = 1 iff teacher has at least one lesson
                    active = model.new_bool_var(
                        f"t{teacher.id}_active_{day}_m{meeting.id}"
                    )
                    model.add_max_equality(active, lesson_vars)
                    # If meeting happens on this day, teacher must be active
                    for mv in day_meeting_vars:
                        model.add(mv <= active)


# ---------------------------------------------------------------------------
# System Constraint 9: Teacher Blocked Slots
# No lessons/meetings when the teacher has marked a timeslot as blocked.
# ---------------------------------------------------------------------------
def _add_teacher_blocked_slots(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Build reverse mapping: co_teacher_id -> list of (class_id, subject_id, primary_teacher_id)
    co_teacher_reqs: dict[int, list[tuple[int, int, int]]] = {}
    for req in data.requirements:
        if req.co_teacher_ids and req.teacher_id is not None and not req.is_grouped:
            for co_tid in req.co_teacher_ids:
                co_teacher_reqs.setdefault(co_tid, []).append(
                    (req.class_group_id, req.subject_id, req.teacher_id)
                )

    for teacher_id, blocked in data.teacher_blocked_slots.items():
        for day, period in blocked:
            # Block regular lesson variables where this teacher is primary
            for key, var in variables.x.items():
                c_id, s_id, t_id, d, p = key
                if t_id == teacher_id and d == day and p == period:
                    model.add(var == 0)

            # Block regular lesson variables where this teacher is co-teacher
            for c_id, s_id, primary_tid in co_teacher_reqs.get(teacher_id, []):
                key = (c_id, s_id, primary_tid, day, period)
                if key in variables.x:
                    model.add(variables.x[key] == 0)

            # Block track variables for this teacher.
            # Note: grouping sync constraints will propagate the block
            # to other tracks in equal-hours clusters automatically.
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id == teacher_id:
                        tk = (track.id, day, period)
                        if tk in variables.x_track:
                            model.add(variables.x_track[tk] == 0)

            # Block meeting variables — but only if ALL participating teachers
            # are blocked at this slot.  If only some are blocked they simply
            # don't attend; the meeting still takes place.
            for meeting in data.meetings:
                participating = [t for t in meeting.teachers if t.id == teacher_id]
                if not participating:
                    continue
                mk = (meeting.id, day, period)
                if mk not in variables.x_meeting:
                    continue
                # Check whether every teacher in the meeting is blocked here
                all_blocked = all(
                    (day, period) in data.teacher_blocked_slots.get(t.id, set())
                    for t in meeting.teachers
                )
                if all_blocked:
                    model.add(variables.x_meeting[mk] == 0)


# ---------------------------------------------------------------------------
# System Constraint 9b: Homeroom Teachers Must Teach on Sunday
# Homeroom teachers (מחנכות) cannot have Sunday as a free day.
# ---------------------------------------------------------------------------
def _add_homeroom_must_teach_sunday(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    """Homeroom teacher must teach HER class at period 1 on Sunday (open the morning)."""
    if not data.homeroom_map:
        return

    sunday = None
    for d in data.days:
        if str(d) == "SUNDAY" or (hasattr(d, 'value') and d.value == "SUNDAY"):
            sunday = d
            break
    if sunday is None:
        return

    for teacher_id, class_id in data.homeroom_map.items():
        # Find vars where this teacher teaches THIS class on Sunday period 1
        period1_vars: list[cp_model.IntVar] = []
        for key, var in variables.x.items():
            c_id, _s, t_id, day, period = key
            if t_id == teacher_id and c_id == class_id and day == sunday and period == 1:
                period1_vars.append(var)

        if period1_vars:
            # Must teach her class at Sunday period 1
            model.add(sum(period1_vars) >= 1)


# ---------------------------------------------------------------------------
# System Constraint 10: Secondary Track End-of-Day Preference
# Secondary tracks (מגמה שניה) are preferred at the end of the school day.
# ---------------------------------------------------------------------------
def _add_secondary_track_end_of_day(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for cluster in data.clusters:
        for track in cluster.tracks:
            if not track.is_secondary or track.teacher_id is None:
                continue
            # Soft penalty: penalize earlier periods more heavily
            for day in data.days:
                max_p = data.max_period_per_day.get(day, 8)
                for period in range(1, max_p + 1):
                    tk = (track.id, day, period)
                    if tk in variables.x_track:
                        # Penalty proportional to how early the period is
                        # Earlier period = higher penalty
                        penalty_weight = max_p - period
                        if penalty_weight > 0:
                            variables.penalties.append(
                                (variables.x_track[tk], penalty_weight, -1)
                            )


# ---------------------------------------------------------------------------
# System Constraint 11: Pinned Lessons
# Lessons pinned to specific timeslots must be scheduled exactly there.
# ---------------------------------------------------------------------------
def _add_pinned_lessons(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        pinned = getattr(req, "pinned_slots", None)
        if not pinned:
            continue
        for pin in pinned:
            day = pin.get("day")
            period = pin.get("period")
            if day is None or period is None:
                continue
            key = (req.class_group_id, req.subject_id, req.teacher_id, day, period)
            if key in variables.x:
                model.add(variables.x[key] == 1)


# ---------------------------------------------------------------------------
# System Constraint 11b: Pinned Meetings
# Meetings pinned to specific timeslots must be scheduled exactly there.
# ---------------------------------------------------------------------------
def _add_pinned_meetings(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for meeting in data.meetings:
        pinned = getattr(meeting, "pinned_slots", None)
        alternative = getattr(meeting, "alternative_slots", None)

        if not pinned:
            continue

        # If meeting has alternative slots, solver picks primary OR alternative
        if alternative and meeting.meeting_type == MeetingType.PLENARY.value:
            _add_pinned_meeting_with_alternatives(
                model, data, variables, meeting, pinned, alternative
            )
            continue

        # Standard: pin exactly at pinned slots
        for pin in pinned:
            day = pin.get("day") if isinstance(pin, dict) else getattr(pin, "day", None)
            period = pin.get("period") if isinstance(pin, dict) else getattr(pin, "period", None)
            if day is None or period is None:
                continue
            key = (meeting.id, day, period)
            if key in variables.x_meeting:
                model.add(variables.x_meeting[key] == 1)


def _add_pinned_meeting_with_alternatives(
    model: cp_model.CpModel,
    data: SolverData,
    variables: SolverVariables,
    meeting,
    pinned: list,
    alternative: list,
) -> None:
    """Plenary with alternative slots: must be at primary OR alternative set."""

    def _parse_slots(slots):
        result = []
        for s in slots:
            d = s.get("day") if isinstance(s, dict) else getattr(s, "day", None)
            p = s.get("period") if isinstance(s, dict) else getattr(s, "period", None)
            if d is not None and p is not None:
                result.append((d, p))
        return result

    primary_slots = _parse_slots(pinned)
    alt_slots = _parse_slots(alternative)

    if not primary_slots:
        return

    # use_primary = 1 → scheduled at primary slots, 0 → at alternative slots
    use_primary = model.new_bool_var(f"plenary_{meeting.id}_use_primary")

    # If use_primary: all primary slots are 1
    for day, period in primary_slots:
        key = (meeting.id, day, period)
        if key in variables.x_meeting:
            model.add(variables.x_meeting[key] == 1).only_enforce_if(use_primary)

    # If NOT use_primary: all alternative slots are 1
    if alt_slots:
        for day, period in alt_slots:
            key = (meeting.id, day, period)
            if key in variables.x_meeting:
                model.add(variables.x_meeting[key] == 1).only_enforce_if(use_primary.negated())

    # Block all non-chosen slots
    all_chosen = set(primary_slots) | set(alt_slots)
    for key in variables.x_meeting:
        m_id, d, p = key
        if m_id == meeting.id and (d, p) not in all_chosen:
            model.add(variables.x_meeting[key] == 0)


# ---------------------------------------------------------------------------
# System Constraint 11c: Pinned Tracks
# Track lessons pinned to specific timeslots must be scheduled exactly there.
# ---------------------------------------------------------------------------
def _add_pinned_tracks(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            pinned = getattr(track, "pinned_slots", None)
            if not pinned:
                continue
            for pin in pinned:
                day = pin.get("day") if isinstance(pin, dict) else getattr(pin, "day", None)
                period = pin.get("period") if isinstance(pin, dict) else getattr(pin, "period", None)
                if day is None or period is None:
                    continue
                key = (track.id, day, period)
                if key in variables.x_track:
                    model.add(variables.x_track[key] == 1)


# ---------------------------------------------------------------------------
# System Constraint 11d: Blocked Requirement Slots
# Requirements blocked from specific timeslots cannot be scheduled there.
# ---------------------------------------------------------------------------
def _add_blocked_requirement_slots(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for req in data.requirements:
        if req.is_grouped or req.teacher_id is None:
            continue
        blocked = getattr(req, "blocked_slots", None)
        if not blocked:
            continue
        for slot in blocked:
            day = slot.get("day") if isinstance(slot, dict) else getattr(slot, "day", None)
            period = slot.get("period") if isinstance(slot, dict) else getattr(slot, "period", None)
            if day is None or period is None:
                continue
            key = (req.class_group_id, req.subject_id, req.teacher_id, day, period)
            if key in variables.x:
                model.add(variables.x[key] == 0)


# ---------------------------------------------------------------------------
# System Constraint 11e: Blocked Track Slots
# Track lessons blocked from specific timeslots cannot be scheduled there.
# ---------------------------------------------------------------------------
def _add_blocked_track_slots(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for cluster in data.clusters:
        for track in cluster.tracks:
            blocked = getattr(track, "blocked_slots", None)
            if not blocked:
                continue
            for slot in blocked:
                day = slot.get("day") if isinstance(slot, dict) else getattr(slot, "day", None)
                period = slot.get("period") if isinstance(slot, dict) else getattr(slot, "period", None)
                if day is None or period is None:
                    continue
                key = (track.id, day, period)
                if key in variables.x_track:
                    model.add(variables.x_track[key] == 0)


# ---------------------------------------------------------------------------
# System Constraint 11f: Blocked Meeting Slots
# Meetings blocked from specific timeslots cannot be scheduled there.
# ---------------------------------------------------------------------------
def _add_blocked_meeting_slots(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for meeting in data.meetings:
        blocked = getattr(meeting, "blocked_slots", None)
        if not blocked:
            continue
        for slot in blocked:
            day = slot.get("day") if isinstance(slot, dict) else getattr(slot, "day", None)
            period = slot.get("period") if isinstance(slot, dict) else getattr(slot, "period", None)
            if day is None or period is None:
                continue
            key = (meeting.id, day, period)
            if key in variables.x_meeting:
                model.add(variables.x_meeting[key] == 0)


# ---------------------------------------------------------------------------
# System Constraint 11g: Plenary No Overlap With Other Meetings
# When a plenary (מליאה) meeting is scheduled at a timeslot, no other
# meeting can be scheduled at that same timeslot.
# ---------------------------------------------------------------------------
def _add_plenary_no_overlap_with_meetings(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    plenary_meetings = [
        m for m in data.meetings
        if m.meeting_type == MeetingType.PLENARY.value and m.teachers
    ]
    if not plenary_meetings:
        return

    other_meetings = [
        m for m in data.meetings
        if m.meeting_type != MeetingType.PLENARY.value and m.teachers
    ]
    if not other_meetings:
        return

    for plenary in plenary_meetings:
        for other in other_meetings:
            for day, period in data.available_slots:
                pk = (plenary.id, day, period)
                ok = (other.id, day, period)
                pv = variables.x_meeting.get(pk)
                ov = variables.x_meeting.get(ok)
                if pv is not None and ov is not None:
                    # At most one can be active at this timeslot
                    model.add(pv + ov <= 1)


# ---------------------------------------------------------------------------
# System Constraint 12: Grouping Contiguous Prefix
# In variable-hours groupings with the OLD subset-sync model, shorter tracks
# scheduled hours as a contiguous prefix of the reference track.
#
# With the new shared-slot sync model (variable hours), this constraint is
# no longer applicable — extra hours are free to go anywhere, so there is
# no "reference envelope" to form a prefix within.  This constraint now
# only activates for equal-hours clusters (where it is a no-op anyway).
# ---------------------------------------------------------------------------
def _add_grouping_contiguous_prefix(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Under the new shared-slot sync model, variable-hours clusters no longer
    # require short tracks to be subsets of a reference track, so the
    # contiguous-prefix constraint does not apply.  Skip entirely.
    pass


# ---------------------------------------------------------------------------
# System Constraint 13: Grouping Extra Hours End-of-Day Preference
# In the OLD subset-sync model, extra hours (when reference is active but
# short track is not) were penalized for being early in the day.
#
# With the new shared-slot sync model, tracks schedule extra hours freely
# and independently — there is no concept of "reference active, short
# inactive" since they only share min_hours slots.  This constraint is
# no longer applicable for variable-hours clusters.
# ---------------------------------------------------------------------------
def _add_grouping_extra_hours_end_of_day(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Under the new shared-slot sync model, variable-hours clusters allow
    # each track to schedule extra hours independently, so the "extra hours
    # end-of-day" preference based on a reference track no longer applies.
    pass


# ---------------------------------------------------------------------------
# System Constraint 14: Linked Tracks No Overlap
# Tracks with the same link_group within a cluster serve the same students.
# They must NOT overlap — their hours are scheduled at different timeslots,
# but collectively within the reference track's envelope.
# ---------------------------------------------------------------------------
def _add_linked_tracks_no_overlap(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    for cluster in data.clusters:
        # Group tracks by link_group
        link_groups: dict[int, list[Track]] = {}
        for track in cluster.tracks:
            if track.link_group is not None and track.teacher_id is not None:
                link_groups.setdefault(track.link_group, []).append(track)

        for _lg, linked_tracks in link_groups.items():
            if len(linked_tracks) < 2:
                continue

            # For each timeslot, at most ONE of the linked tracks can be active
            # (same students can't be in two lessons at once)
            for day, period in data.available_slots:
                vars_at_slot: list[cp_model.IntVar] = []
                for track in linked_tracks:
                    tk = (track.id, day, period)
                    if tk in variables.x_track:
                        vars_at_slot.append(variables.x_track[tk])
                if len(vars_at_slot) > 1:
                    model.add(sum(vars_at_slot) <= 1)


# ---------------------------------------------------------------------------
# Subject Blocked Slots
# No lessons for a subject at its blocked timeslots.
# ---------------------------------------------------------------------------
def _add_subject_blocked_slots(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Build subject_id -> set of blocked (day, period)
    subject_blocked: dict[int, set[tuple[str, int]]] = {}
    for subj in data.all_subjects:
        blocked = getattr(subj, "blocked_slots", None)
        if blocked:
            subject_blocked[subj.id] = {
                (slot["day"], slot["period"]) for slot in blocked
            }

    if not subject_blocked:
        return

    # Block regular requirement variables
    for key, var in variables.x.items():
        _c, s_id, _t, day, period = key
        if s_id in subject_blocked and (day, period) in subject_blocked[s_id]:
            model.add(var == 0)

    # Block track variables for clusters with this subject
    for cluster in data.clusters:
        if cluster.subject_id not in subject_blocked:
            continue
        blocked = subject_blocked[cluster.subject_id]
        for track in cluster.tracks:
            if track.teacher_id is None:
                continue
            for key, var in variables.x_track.items():
                tr_id, day, period = key
                if tr_id == track.id and (day, period) in blocked:
                    model.add(var == 0)



# ---------------------------------------------------------------------------
# System Constraint: High School Daily Core Subjects
# כיתות י-יא-יב חייבות בכל יום לפחות שיעור אחד של אנגלית/מתמטיקה/מגמות
# ---------------------------------------------------------------------------
_CORE_SUBJECT_KEYWORDS = {"אנגלית", "מתמטיקה"}


def _add_high_school_daily_core(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    MIN_GRADE_LEVEL = 10  # י and above

    # Identify core subject IDs (English, Math)
    core_subject_ids: set[int] = set()
    for subj in data.all_subjects:
        for kw in _CORE_SUBJECT_KEYWORDS:
            if kw in subj.name:
                core_subject_ids.add(subj.id)
                break

    # Build class_id -> grade level map
    class_grade: dict[int, int] = {}
    for cg in data.class_groups:
        if cg.grade and cg.grade.level >= MIN_GRADE_LEVEL:
            class_grade[cg.id] = cg.grade.level

    if not class_grade:
        return  # No high-school classes

    # Identify מגמות subject IDs
    megamot_keywords = {"מגמות", "מגמה"}
    megamot_subject_ids: set[int] = set()
    for subj in data.all_subjects:
        for kw in megamot_keywords:
            if kw in subj.name:
                megamot_subject_ids.add(subj.id)
                break

    # Build class_id -> set of relevant cluster IDs (core subjects + מגמות only)
    class_clusters: dict[int, set[int]] = {}
    for cluster in data.clusters:
        # Only include clusters whose subject is core (math/English) or מגמות
        if cluster.subject_id not in core_subject_ids and cluster.subject_id not in megamot_subject_ids:
            continue
        for src_class in cluster.source_classes:
            if src_class.id in class_grade:
                class_clusters.setdefault(src_class.id, set()).add(cluster.id)

    # For each high-school class, each day: sum of core + מגמה vars >= 1
    for class_id in class_grade:
        cluster_ids = class_clusters.get(class_id, set())

        for day in data.days:
            day_core_vars: list = []

            # Regular lessons: English or Math for this class on this day
            for key, var in variables.x.items():
                c_id, s_id, _t_id, d, _p = key
                if c_id == class_id and d == day and s_id in core_subject_ids:
                    day_core_vars.append(var)

            # Track vars: only from core/מגמות clusters
            for cl_id in cluster_ids:
                for cluster in data.clusters:
                    if cluster.id != cl_id:
                        continue
                    for track in cluster.tracks:
                        if track.teacher_id is None:
                            continue
                        for key, var in variables.x_track.items():
                            tr_id, d, _p = key
                            if tr_id == track.id and d == day:
                                day_core_vars.append(var)

            if day_core_vars:
                model.add(sum(day_core_vars) >= 1)


# ---------------------------------------------------------------------------
# System Constraint: Subject Limit in Last Periods
# מקצועות עם limit_last_periods — מקסימום פעם אחת בשעתיים האחרונות ליום לכל כיתה
# ---------------------------------------------------------------------------
def _add_subject_limit_last_periods(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    """For each class × limited subject: the subject may appear in the last
    2 periods at most ONCE across the entire week (not per day — per week).

    A double lesson (7+8) on one day counts as that one weekly occurrence.
    Tracks in a cluster are synced so we count only one representative.
    """
    LAST_N = 2  # last 2 periods of each day

    limited_subject_ids: set[int] = set()
    for subj in data.all_subjects:
        if getattr(subj, "limit_last_periods", False):
            limited_subject_ids.add(subj.id)

    if not limited_subject_ids:
        return

    # Precompute last periods per day
    day_last: dict[str, set[int]] = {}
    for day in data.days:
        max_p = data.max_period_per_day.get(day, 8)
        day_last[day] = set(range(max_p - LAST_N + 1, max_p + 1))

    for class_id in {cg.id for cg in data.class_groups}:
        for subj_id in limited_subject_ids:
            # Collect one bool per day: "does this subject appear in last
            # periods on this day for this class?"
            day_present_vars: list = []

            for day in data.days:
                last_periods = day_last[day]
                last_vars: list = []

                # Regular lesson vars
                for key, var in variables.x.items():
                    c_id, s_id, _t, d, p = key
                    if c_id == class_id and s_id == subj_id and d == day and p in last_periods:
                        last_vars.append(var)

                # Track vars — one representative per cluster (all synced)
                for cluster in data.clusters:
                    if cluster.subject_id != subj_id:
                        continue
                    if not any(sc.id == class_id for sc in cluster.source_classes):
                        continue
                    rep_track = next(
                        (t for t in cluster.tracks if t.teacher_id is not None),
                        None,
                    )
                    if rep_track is None:
                        continue
                    for key, var in variables.x_track.items():
                        tr_id, d, p = key
                        if tr_id == rep_track.id and d == day and p in last_periods:
                            last_vars.append(var)

                if not last_vars:
                    continue

                # Bool: subject present in last periods on this day
                present = model.new_bool_var(
                    f"limit_last_{subj_id}_{class_id}_{day}"
                )
                model.add_max_equality(present, last_vars)
                day_present_vars.append(present)

            # At most 1 day per week with this subject in last periods
            if len(day_present_vars) > 1:
                model.add(sum(day_present_vars) <= 1)


# ---------------------------------------------------------------------------
# System Constraint: Teacher Late Finish Limit
# מחנכת — מקסימום 2 ימים בשעה שמינית
# מורה מקצועי — מקסימום 3 ימים בשעה שמינית, שאר הימים עד שעה שישית בלבד
# ---------------------------------------------------------------------------
def _add_teacher_late_finish_limit(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    LATE_PERIOD = 8    # שעה שמינית
    EARLY_MAX = 6      # ביום "קצר" — עד שעה שישית
    MAX_LATE_DAYS_HOMEROOM = 2
    MAX_LATE_DAYS_REGULAR = 3
    MIN_SHORT_DAYS_HOMEROOM = 1  # מחנכת: לפחות יום אחד קצר (עד שעה 6)

    # Build teacher -> track_id set for fast lookup
    teacher_track_ids: dict[int, set[int]] = {}
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                teacher_track_ids.setdefault(track.teacher_id, set()).add(track.id)

    # Build teacher -> meeting_ids for meeting participation
    teacher_meeting_ids: dict[int, set[int]] = {}
    for meeting in data.meetings:
        for t in meeting.teachers:
            teacher_meeting_ids.setdefault(t.id, set()).add(meeting.id)

    # Collect all teaching teacher IDs
    teacher_ids: set[int] = set()
    for req in data.requirements:
        if req.teacher_id is not None and not req.is_grouped:
            teacher_ids.add(req.teacher_id)
    teacher_ids.update(teacher_track_ids.keys())

    for teacher_id in teacher_ids:
        is_homeroom = teacher_id in data.homeroom_map
        max_late = MAX_LATE_DAYS_HOMEROOM if is_homeroom else MAX_LATE_DAYS_REGULAR
        my_track_ids = teacher_track_ids.get(teacher_id, set())
        my_meeting_ids = teacher_meeting_ids.get(teacher_id, set())

        # Collect vars per day at period >= LATE_PERIOD (for "late" bool)
        late_vars_by_day: dict[str, list] = {}
        # Collect vars per day at period > EARLY_MAX (for "early day" enforcement)
        after6_vars_by_day: dict[str, list] = {}

        for key, var in variables.x.items():
            _c, _s, t_id, day, period = key
            if t_id != teacher_id:
                continue
            if period >= LATE_PERIOD:
                late_vars_by_day.setdefault(day, []).append(var)
            if period > EARLY_MAX:
                after6_vars_by_day.setdefault(day, []).append(var)

        for key, var in variables.x_track.items():
            tr_id, day, period = key
            if tr_id not in my_track_ids:
                continue
            if period >= LATE_PERIOD:
                late_vars_by_day.setdefault(day, []).append(var)
            if period > EARLY_MAX:
                after6_vars_by_day.setdefault(day, []).append(var)

        # Include meetings in late-day counting
        for key, var in variables.x_meeting.items():
            m_id, day, period = key
            if m_id not in my_meeting_ids:
                continue
            if period >= LATE_PERIOD:
                late_vars_by_day.setdefault(day, []).append(var)
            if period > EARLY_MAX:
                after6_vars_by_day.setdefault(day, []).append(var)

        # --- Limit: max N days with period >= 8 ---
        day_late_bools: dict[str, cp_model.IntVar] = {}
        for day, dvars in late_vars_by_day.items():
            b = model.new_bool_var(f"late8_t{teacher_id}_{day}")
            model.add_max_equality(b, dvars)
            day_late_bools[day] = b

        if day_late_bools:
            model.add(sum(day_late_bools.values()) <= max_late)

        # --- Homeroom teachers: at least 1 short day (finish by period 6) ---
        # Extends the 2-late-days limit: out of remaining days, at least 1 is short
        if is_homeroom:
            day_short_bools: list[cp_model.IntVar] = []
            for day in data.days:
                dvars_after6 = after6_vars_by_day.get(day)
                if not dvars_after6:
                    # No vars after period 6 → always a short day
                    day_short_bools.append(model.new_constant(1))
                else:
                    has_late = model.new_bool_var(f"has_after6_t{teacher_id}_{day}")
                    model.add_max_equality(has_late, dvars_after6)
                    day_short_bools.append(has_late.negated())

            if day_short_bools:
                model.add(sum(day_short_bools) >= MIN_SHORT_DAYS_HOMEROOM)

        # --- Regular teachers: on non-late days, finish by period 6 ---
        if not is_homeroom:
            for day, dvars_after6 in after6_vars_by_day.items():
                # is_late_day = 1 iff teacher has activity at period >= 8 on this day
                is_late_day = day_late_bools.get(day)
                if is_late_day is None:
                    # No vars at period 8+ on this day → this is always an "early day"
                    # Block everything after period 6
                    for v in dvars_after6:
                        model.add(v == 0)
                else:
                    # If NOT a late day → no lessons after period 6
                    for v in dvars_after6:
                        model.add(v == 0).only_enforce_if(is_late_day.negated())


def _add_subject_link_group_daily_limit(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    """HARD: subjects with same link_group share a daily max per class.

    E.g., תורה + נביא + תושב"ע all in link_group "תנ"ך" with max_per_day=2
    means a class can have at most 2 combined hours of these subjects per day.
    """
    from collections import defaultdict

    # Build link_group -> (subject_ids, max_per_day)
    link_groups: dict[str, dict] = {}
    for subj in data.all_subjects:
        if subj.link_group:
            if subj.link_group not in link_groups:
                link_groups[subj.link_group] = {
                    "subject_ids": set(),
                    "max_per_day": subj.link_group_max_per_day or 2,
                }
            link_groups[subj.link_group]["subject_ids"].add(subj.id)
            # Use the minimum max_per_day across all subjects in the group
            if subj.link_group_max_per_day is not None:
                link_groups[subj.link_group]["max_per_day"] = min(
                    link_groups[subj.link_group]["max_per_day"],
                    subj.link_group_max_per_day,
                )

    if not link_groups:
        return

    # For each class, for each day, sum all vars of linked subjects and cap at max
    for lg_name, lg_info in link_groups.items():
        subject_ids = lg_info["subject_ids"]
        max_per_day = lg_info["max_per_day"]

        for cg in data.class_groups:
            for day in data.days:
                day_vars = []
                for key, var in variables.x.items():
                    cg_id, subj_id, _t_id, d, _p = key
                    if cg_id == cg.id and subj_id in subject_ids and d == day:
                        day_vars.append(var)
                if day_vars:
                    model.add(sum(day_vars) <= max_per_day)
