"""Converts CP-SAT solver output into ScheduledLesson and ScheduledMeeting records."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.models.timetable import ScheduledLesson, ScheduledMeeting
from app.solver.model_builder import SolverData

if TYPE_CHECKING:
    from app.solver.engine import SolutionSnapshot


def parse_solution_from_snapshot(
    snapshot: SolutionSnapshot,
    data: SolverData,
    solution_id: int,
) -> tuple[list[ScheduledLesson], list[ScheduledMeeting]]:
    """Extract scheduled lessons and meetings from a captured solution snapshot."""
    lessons: list[ScheduledLesson] = []

    # Regular requirements
    for (c_id, s_id, t_id, day, period), val in snapshot.x_values.items():
        if val == 1:
            lessons.append(ScheduledLesson(
                solution_id=solution_id,
                class_group_id=c_id,
                track_id=None,
                subject_id=s_id,
                teacher_id=t_id,
                day=day,
                period=period,
            ))

    # Track assignments — "implant" into each source class of the cluster
    # Build track→(cluster, track_obj, served_class_ids) lookup for fast access
    track_lookup: dict[int, tuple] = {}

    # Build subject name→id lookup for resolving track-specific subjects
    # (e.g. "מגמות" clusters where each track is a different subject)
    # Uses all_subjects pre-loaded in SolverData (no separate DB session needed).
    subject_name_to_id: dict[str, int] = {}
    for subj in getattr(data, 'all_subjects', []):
        subject_name_to_id[subj.name.strip()] = subj.id

    for cluster in data.clusters:
        all_source_class_ids = [sc.id for sc in cluster.source_classes]
        for track in cluster.tracks:
            # If track.source_class_id is set, this track only serves that
            # specific class. Otherwise it serves ALL source classes.
            if track.source_class_id is not None:
                served_ids = [track.source_class_id]
            else:
                served_ids = all_source_class_ids

            # Resolve the actual subject_id for this track:
            # If track name matches a known subject, use that subject's id.
            # Otherwise fall back to the cluster's subject_id.
            track_name_clean = track.name.strip()
            resolved_subject_id = subject_name_to_id.get(
                track_name_clean, cluster.subject_id
            )

            track_lookup[track.id] = (cluster, track, served_ids, resolved_subject_id)

    for (track_id, day, period), val in snapshot.x_track_values.items():
        if val == 1:
            info = track_lookup.get(track_id)
            if not info:
                continue
            cluster, track, served_class_ids, resolved_subject_id = info
            # Guard against missing subject_id or teacher_id
            if resolved_subject_id is None:
                resolved_subject_id = cluster.subject_id
            if resolved_subject_id is None or track.teacher_id is None:
                continue  # Skip malformed track — can't create valid lesson
            # Create one entry per served class so each class "owns" the slot
            for cg_id in served_class_ids:
                lessons.append(ScheduledLesson(
                    solution_id=solution_id,
                    class_group_id=cg_id,
                    track_id=track_id,
                    subject_id=resolved_subject_id,
                    teacher_id=track.teacher_id,
                    day=day,
                    period=period,
                ))

    # Meeting assignments
    scheduled_meetings: list[ScheduledMeeting] = []
    for (meeting_id, day, period), val in snapshot.x_meeting_values.items():
        if val == 1:
            scheduled_meetings.append(ScheduledMeeting(
                solution_id=solution_id,
                meeting_id=meeting_id,
                day=day,
                period=period,
            ))

    return lessons, scheduled_meetings
