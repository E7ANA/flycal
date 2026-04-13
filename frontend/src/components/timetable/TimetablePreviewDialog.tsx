import { useQuery } from "@tanstack/react-query";
import { useSchoolStore } from "@/stores/schoolStore";
import { useActiveSchool } from "@/hooks/useSchool";
import {
  fetchSolutions,
  fetchLessonsByClass,
  fetchLessonsByTeacher,
  fetchScheduledMeetings,
  fetchTeacherPresence,
  fetchMeetingAbsences,
} from "@/api/solver";
import { fetchMeetings } from "@/api/meetings";
import { fetchSubjects } from "@/api/subjects";
import { fetchTeachers } from "@/api/teachers";
import { fetchClasses } from "@/api/classes";
import { fetchGroupingClusters } from "@/api/groupings";
import { Dialog, DialogHeader, DialogTitle } from "@/components/common/Dialog";
import { TimetableGrid } from "@/components/timetable/TimetableGrid";
import { Badge } from "@/components/common/Badge";
import { DAYS_ORDER } from "@/lib/constraints";

interface Props {
  open: boolean;
  onClose: () => void;
  mode: "class" | "teacher";
  targetId: number;
  targetName: string;
}

export function TimetablePreviewDialog({ open, onClose, mode, targetId, targetName }: Props) {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const { data: school } = useActiveSchool();

  const { data: solutions = [] } = useQuery({
    queryKey: ["solutions", schoolId],
    queryFn: () => fetchSolutions(schoolId!),
    enabled: open && !!schoolId,
  });
  const latestSolution = solutions[0] ?? null;

  const { data: lessons = [] } = useQuery({
    queryKey: ["preview-lessons", latestSolution?.id, mode, targetId],
    queryFn: () =>
      mode === "class"
        ? fetchLessonsByClass(latestSolution!.id, targetId)
        : fetchLessonsByTeacher(latestSolution!.id, targetId),
    enabled: open && latestSolution !== null,
  });

  const { data: allMeetings = [] } = useQuery({
    queryKey: ["scheduled-meetings", latestSolution?.id],
    queryFn: () => fetchScheduledMeetings(latestSolution!.id),
    enabled: open && latestSolution !== null,
  });

  const { data: meetingDefs = [] } = useQuery({
    queryKey: ["meetings", schoolId],
    queryFn: () => fetchMeetings(schoolId!),
    enabled: open && !!schoolId,
  });

  const { data: meetingAbsences = [] } = useQuery({
    queryKey: ["meeting-absences", schoolId],
    queryFn: () => fetchMeetingAbsences(schoolId!),
    enabled: open && !!schoolId,
  });

  const { data: teacherPresence } = useQuery({
    queryKey: ["teacher-presence", latestSolution?.id, targetId],
    queryFn: () => fetchTeacherPresence(latestSolution!.id, targetId),
    enabled: open && latestSolution !== null && mode === "teacher",
  });

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId!),
    enabled: open && !!schoolId,
  });
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId!),
    enabled: open && !!schoolId,
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId!),
    enabled: open && !!schoolId,
  });
  const { data: clusters = [] } = useQuery({
    queryKey: ["grouping-clusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: open && !!schoolId,
  });

  const subjectMap = Object.fromEntries(subjects.map((s) => [s.id, { name: s.name, color: s.color }]));
  const teacherMap = Object.fromEntries(teachers.map((t) => [t.id, t.name]));
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]));
  const meetingMap = Object.fromEntries(meetingDefs.map((m) => [m.id, { id: m.id, name: m.name, color: m.color }]));
  const trackMap = Object.fromEntries(
    clusters.flatMap((c) =>
      c.tracks.map((t) => {
        const clusterLabel = c.name.replace(/^הקבצת\s*/, "");
        const subj = subjectMap[c.subject_id];
        const trackLabel = t.name !== subj?.name ? `${t.name} (${clusterLabel})` : clusterLabel;
        return [t.id, trackLabel];
      }),
    ),
  );

  const filteredMeetings =
    mode === "teacher"
      ? allMeetings.filter((sm) => {
          const m = meetingDefs.find((md) => md.id === sm.meeting_id);
          if (!m?.teacher_ids.includes(targetId)) return false;
          return !meetingAbsences.some((a) => a.meeting_id === sm.meeting_id && a.teacher_id === targetId);
        })
      : [];

  const days = DAYS_ORDER.slice(0, school?.days_per_week ?? 6) as unknown as string[];
  const maxPeriod = school?.periods_per_day ?? 8;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          מערכת שעות — {targetName}
          {latestSolution && (
            <Badge variant="outline" className="text-xs">פתרון #{latestSolution.id}</Badge>
          )}
        </DialogTitle>
      </DialogHeader>
      <div className="p-1">
        {!latestSolution ? (
          <p className="text-center text-muted-foreground py-8">אין פתרונות — הרץ את הפותר קודם</p>
        ) : lessons.length === 0 && filteredMeetings.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">אין שיעורים לתצוגה</p>
        ) : (
          <div className="space-y-2">
            {mode === "teacher" && teacherPresence && (
              <div className="flex gap-4 text-sm border rounded-lg p-2 bg-muted/30">
                <span><strong>פרונטלי:</strong> {teacherPresence.frontal_hours}</span>
                <span className="text-blue-600"><strong>פרטני:</strong> {teacherPresence.individual_hours}</span>
                <span className="text-amber-600"><strong>שהייה:</strong> {teacherPresence.staying_hours}</span>
                <span className={teacherPresence.actual_gaps > teacherPresence.allowed_gaps ? "text-red-500" : "text-muted-foreground"}>
                  <strong>חלונות:</strong> {teacherPresence.actual_gaps}/{teacherPresence.allowed_gaps}
                </span>
              </div>
            )}
            <TimetableGrid
              lessons={lessons}
              days={days}
              maxPeriod={maxPeriod}
              subjectMap={subjectMap}
              teacherMap={teacherMap}
              classMap={classMap}
              trackMap={trackMap}
              showTeacher={mode === "class"}
              showClass={mode === "teacher"}
              meetings={filteredMeetings}
              meetingMap={meetingMap}
              meetingAbsences={meetingAbsences}
              presenceSlots={
                mode === "teacher" && teacherPresence
                  ? teacherPresence.slots
                      .filter((s) => s.slot_type !== "frontal" && s.slot_type !== "meeting")
                      .map((s) => ({ day: s.day, period: s.period, slot_type: s.slot_type }))
                  : []
              }
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
