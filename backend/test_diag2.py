"""Find exact conflict: which teacher+day combo breaks with pinned_tracks."""
import app.solver.model_builder as mb
from app.database import SessionLocal
from ortools.sat.python import cp_model

db = SessionLocal()
data = mb.load_solver_data(db, 1)

def quick_solve(model, t=5):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = t
    solver.parameters.num_workers = 8
    return solver.solve(model)

# Base = all system constraints EXCEPT pinned_tracks and meetings_on_teaching_days
# We know: base alone = OK, base+pinned_tracks = INFEASIBLE
# But removing meetings_on_teaching_days also fixes it.
# So let's find which meeting+teacher combo causes the conflict WITH pinned_tracks.

ALL_EXCEPT = [
    mb._add_teacher_no_overlap,
    mb._add_class_no_overlap,
    mb._add_hours_exact_fulfillment,
    mb._add_teacher_qualification,
    mb._add_class_availability,
    mb._add_grouping_sync,
    mb._add_single_teacher_per_assignment,
    mb._add_meeting_hours_fulfillment,
    # skip meetings_on_teaching_days
    mb._add_teacher_blocked_slots,
    mb._add_secondary_track_end_of_day,
    mb._add_pinned_lessons,
    mb._add_pinned_meetings,
    mb._add_pinned_tracks,
    mb._add_blocked_requirement_slots,
    mb._add_blocked_track_slots,
    mb._add_blocked_meeting_slots,
    mb._add_grouping_contiguous_prefix,
    mb._add_grouping_extra_hours_end_of_day,
    mb._add_linked_tracks_no_overlap,
    mb._add_subject_blocked_slots,
]

# Verify: base + pinned but no meetings_on_teaching_days = OK
m = cp_model.CpModel()
v = mb.create_variables(m, data)
for fn in ALL_EXCEPT:
    fn(m, data, v)
s = quick_solve(m)
print(f"Base + pinned (no meetings_on_teaching_days): {'OK' if s != cp_model.INFEASIBLE else 'INFEASIBLE'}")

# Now add meetings_on_teaching_days manually, one meeting at a time
print("\n=== Adding meetings_on_teaching_days per meeting ===")
for meeting in data.meetings:
    if not meeting.teachers:
        continue
    m2 = cp_model.CpModel()
    v2 = mb.create_variables(m2, data)
    for fn in ALL_EXCEPT:
        fn(m2, data, v2)
    
    # Build teacher_day_vars
    teacher_day_vars = {}
    for key, var in v2.x.items():
        _c, _s, t_id, day, _p = key
        teacher_day_vars.setdefault(t_id, {}).setdefault(day, []).append(var)
    for cluster in data.clusters:
        for track in cluster.tracks:
            if track.teacher_id is not None:
                for key, var in v2.x_track.items():
                    tk_id, day, _p = key
                    if tk_id == track.id:
                        teacher_day_vars.setdefault(track.teacher_id, {}).setdefault(day, []).append(var)
    
    # Add constraint only for this meeting
    for day in data.days:
        day_meeting_vars = []
        for key, var in v2.x_meeting.items():
            m_id, d, _p = key
            if m_id == meeting.id and d == day:
                day_meeting_vars.append(var)
        if not day_meeting_vars:
            continue
        for teacher in meeting.teachers:
            all_tv = teacher_day_vars.get(teacher.id, {})
            has_any = any(len(vl) > 0 for vl in all_tv.values())
            if not has_any:
                continue
            lesson_vars = all_tv.get(day, [])
            if not lesson_vars:
                for mv in day_meeting_vars:
                    m2.add(mv == 0)
                break
            else:
                active = m2.new_bool_var(f"t{teacher.id}_active_{day}_m{meeting.id}")
                m2.add_max_equality(active, lesson_vars)
                for mv in day_meeting_vars:
                    m2.add(mv <= active)
    
    s2 = quick_solve(m2)
    teachers_str = ", ".join(t.name for t in meeting.teachers)
    status = "OK" if s2 != cp_model.INFEASIBLE else "INFEASIBLE"
    if status == "INFEASIBLE":
        print(f"  Meeting '{meeting.name}' (teachers: {teachers_str}): {status} <<<")
    else:
        print(f"  Meeting '{meeting.name}': {status}")

db.close()
