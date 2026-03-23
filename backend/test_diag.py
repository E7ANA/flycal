"""Diagnose which system constraint causes infeasibility."""
import app.solver.model_builder as mb
from app.database import SessionLocal
from ortools.sat.python import cp_model


def quick_solve(model, t=8):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = t
    solver.parameters.num_workers = 8
    return solver.solve(model)


def label(s):
    return "INFEASIBLE" if s == cp_model.INFEASIBLE else "OK"


db = SessionLocal()
data = mb.load_solver_data(db, 1)

ALL_SYS = [
    ("teacher_no_overlap", mb._add_teacher_no_overlap),
    ("class_no_overlap", mb._add_class_no_overlap),
    ("hours_fulfillment", mb._add_hours_exact_fulfillment),
    ("teacher_qualification", mb._add_teacher_qualification),
    ("class_availability", mb._add_class_availability),
    ("grouping_sync", mb._add_grouping_sync),
    ("single_teacher", mb._add_single_teacher_per_assignment),
    ("meeting_hours", mb._add_meeting_hours_fulfillment),
    ("meetings_on_teaching_days", mb._add_meetings_on_teaching_days),
    ("teacher_blocked_slots", mb._add_teacher_blocked_slots),
    ("pinned_lessons", mb._add_pinned_lessons),
    ("pinned_meetings", mb._add_pinned_meetings),
    ("pinned_tracks", mb._add_pinned_tracks),
    ("blocked_req_slots", mb._add_blocked_requirement_slots),
    ("blocked_track_slots", mb._add_blocked_track_slots),
    ("blocked_meeting_slots", mb._add_blocked_meeting_slots),
    ("grouping_contiguous", mb._add_grouping_contiguous_prefix),
    ("grouping_extra_eod", mb._add_grouping_extra_hours_end_of_day),
    ("linked_tracks_no_overlap", mb._add_linked_tracks_no_overlap),
    ("subject_blocked_slots", mb._add_subject_blocked_slots),
]

# Incremental test
print("=== Incremental (add one by one) ===")
m = cp_model.CpModel()
v = mb.create_variables(m, data)
last_ok = None
for name, fn in ALL_SYS:
    fn(m, data, v)
    s = quick_solve(m)
    status = label(s)
    print(f"  + {name}: {status}")
    if s == cp_model.INFEASIBLE:
        print(f"  >>> BREAKS at: {name}")
        break
    last_ok = name

# If broke, try removing only the breaking one from full set
if s == cp_model.INFEASIBLE:
    print(f"\n=== Remove one at a time (from full set) ===")
    for skip_name, _ in ALL_SYS:
        m2 = cp_model.CpModel()
        v2 = mb.create_variables(m2, data)
        for name, fn in ALL_SYS:
            if name == skip_name:
                continue
            fn(m2, data, v2)
        s2 = quick_solve(m2)
        st = label(s2)
        if st == "OK":
            print(f"  without {skip_name}: {st}  <<<< REMOVING THIS FIXES IT")
        else:
            print(f"  without {skip_name}: {st}")

db.close()
