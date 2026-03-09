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


def load_solver_data(db: Session, school_id: int) -> SolverData:
    """Load all data needed for the solver from the database."""
    school = db.get(School, school_id)
    if not school:
        raise ValueError(f"בית ספר {school_id} לא נמצא")

    class_groups = (
        db.query(ClassGroup).filter(ClassGroup.school_id == school_id).all()
    )
    requirements = (
        db.query(SubjectRequirement)
        .filter(SubjectRequirement.school_id == school_id)
        .all()
    )
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
    if all_teacher_ids:
        teachers_with_blocks = (
            db.query(Teacher)
            .filter(Teacher.id.in_(all_teacher_ids))
            .all()
        )
        for t in teachers_with_blocks:
            if t.blocked_slots:
                teacher_blocked_slots[t.id] = {
                    (slot["day"], slot["period"]) for slot in t.blocked_slots
                }
            if t.homeroom_class_id is not None:
                homeroom_map[t.id] = t.homeroom_class_id

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
        min_free_days_map=min_free_days_map,
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
    _add_meetings_on_teaching_days(model, data, variables)
    _add_teacher_blocked_slots(model, data, variables)
    _add_secondary_track_end_of_day(model, data, variables)
    _add_pinned_lessons(model, data, variables)
    _add_pinned_meetings(model, data, variables)
    _add_pinned_tracks(model, data, variables)
    _add_blocked_requirement_slots(model, data, variables)
    _add_blocked_track_slots(model, data, variables)
    _add_blocked_meeting_slots(model, data, variables)
    _add_grouping_contiguous_prefix(model, data, variables)
    _add_grouping_extra_hours_end_of_day(model, data, variables)
    _add_linked_tracks_no_overlap(model, data, variables)
    _add_subject_blocked_slots(model, data, variables)


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

    # Build set of overlap-allowed requirement keys (c_id, s_id, t_id)
    overlap_req_keys: set[tuple[int, int, int]] = set()
    for req in data.requirements:
        if getattr(req, "allow_overlap", False) and req.teacher_id and not req.is_grouped:
            overlap_req_keys.add((req.class_group_id, req.subject_id, req.teacher_id))

    # Build set of overlap-allowed track IDs
    overlap_track_ids: set[int] = set()
    for cluster in data.clusters:
        for track in cluster.tracks:
            if getattr(track, "allow_overlap", False):
                overlap_track_ids.add(track.id)

    for teacher_id in teacher_ids:
        for day, period in data.available_slots:
            vars_at_slot: list[cp_model.IntVar] = []

            # Regular requirement variables for this teacher at this slot
            for key, var in variables.x.items():
                c_id, s_id, t_id, d, p = key
                if d != day or p != period:
                    continue
                # Skip overlap-allowed requirements
                if (c_id, s_id, t_id) in overlap_req_keys:
                    continue
                # Primary teacher match
                if t_id == teacher_id:
                    vars_at_slot.append(var)
                # Co-teacher match: this teacher appears as co-teacher of this requirement
                elif teacher_id in co_teacher_map.get((c_id, s_id, t_id), []):
                    vars_at_slot.append(var)

            # Track variables for this teacher at this slot
            for cluster in data.clusters:
                for track in cluster.tracks:
                    if track.teacher_id == teacher_id:
                        # Skip overlap-allowed tracks
                        if track.id in overlap_track_ids:
                            continue
                        tk = (track.id, day, period)
                        if tk in variables.x_track:
                            vars_at_slot.append(variables.x_track[tk])

            # Meeting variables for this teacher at this slot
            # (only mandatory-attendance meetings without allow_overlap are HARD no-overlap)
            for meeting in data.meetings:
                if not getattr(meeting, "is_mandatory_attendance", True):
                    continue  # Flexible meetings handled by brain as SOFT
                if getattr(meeting, "allow_overlap", False):
                    continue  # Meeting explicitly allows overlap with lessons
                if any(t.id == teacher_id for t in meeting.teachers):
                    mk = (meeting.id, day, period)
                    if mk in variables.x_meeting:
                        vars_at_slot.append(variables.x_meeting[mk])

            if len(vars_at_slot) > 1:
                model.add(sum(vars_at_slot) <= 1)


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
# System Constraint 8b: Meetings On Teaching Days
# Meetings are only scheduled on days when ALL participating teachers teach.
# ---------------------------------------------------------------------------
def _add_meetings_on_teaching_days(
    model: cp_model.CpModel, data: SolverData, variables: SolverVariables
) -> None:
    # Build teacher_teaches_on_day[teacher_id][day] = list of lesson/track vars
    teacher_day_vars: dict[int, dict[str, list[cp_model.IntVar]]] = {}

    for key, var in variables.x.items():
        _c, _s, t_id, day, _p = key
        teacher_day_vars.setdefault(t_id, {}).setdefault(day, []).append(var)

    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in variables.x_track.items():
                    tk_id, day, _p = key
                    if tk_id == track.id:
                        teacher_day_vars.setdefault(track.teacher_id, {}).setdefault(day, []).append(var)

    for meeting in data.meetings:
        if not meeting.teachers:
            continue
        for day in data.days:
            # Collect meeting vars for this meeting on this day
            day_meeting_vars: list[cp_model.IntVar] = []
            for key, var in variables.x_meeting.items():
                m_id, d, _p = key
                if m_id == meeting.id and d == day:
                    day_meeting_vars.append(var)

            if not day_meeting_vars:
                continue

            # For each teacher in this meeting, if they have no lessons on this day,
            # no meeting can be scheduled on this day.
            # Skip teachers with no teaching assignments at all (admins/managers) —
            # they can attend meetings on any day.
            for teacher in meeting.teachers:
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

            # Block meeting variables
            for meeting in data.meetings:
                if any(t.id == teacher_id for t in meeting.teachers):
                    mk = (meeting.id, day, period)
                    if mk in variables.x_meeting:
                        model.add(variables.x_meeting[mk] == 0)


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
        if not pinned:
            continue
        for pin in pinned:
            day = pin.get("day") if isinstance(pin, dict) else getattr(pin, "day", None)
            period = pin.get("period") if isinstance(pin, dict) else getattr(pin, "period", None)
            if day is None or period is None:
                continue
            key = (meeting.id, day, period)
            if key in variables.x_meeting:
                model.add(variables.x_meeting[key] == 1)


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
