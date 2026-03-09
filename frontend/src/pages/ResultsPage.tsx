import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, BarChart3, Eye, Download, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  fetchSolutions,
  deleteSolution,
  fetchScoreBreakdown,
  fetchLessonsByClass,
  fetchLessonsByTeacher,
  fetchScheduledMeetings,
  fetchTeacherPresence,
} from "@/api/solver";
import { fetchMeetings } from "@/api/meetings";
import { fetchClasses } from "@/api/classes";
import { fetchTeachers } from "@/api/teachers";
import { fetchSubjects } from "@/api/subjects";
import { fetchGroupingClusters } from "@/api/groupings";
import { useActiveSchool } from "@/hooks/useSchool";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/common/Card";
import { Select } from "@/components/common/Select";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { TimetableGrid } from "@/components/timetable/TimetableGrid";
import { DAYS_ORDER } from "@/lib/constraints";
import type { Solution } from "@/types/models";

export default function ResultsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const { data: school } = useActiveSchool();

  const [selectedSolutionId, setSelectedSolutionId] = useState<number | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"class" | "teacher">("class");
  const [viewTargetId, setViewTargetId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Solution | null>(null);

  const { data: solutions = [] } = useQuery({
    queryKey: ["solutions", schoolId],
    queryFn: () => fetchSolutions(schoolId!),
    enabled: !!schoolId,
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId!),
    enabled: !!schoolId,
  });

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId!),
    enabled: !!schoolId,
  });

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId!),
    enabled: !!schoolId,
  });

  const { data: scoreBreakdown } = useQuery({
    queryKey: ["score-breakdown", selectedSolutionId],
    queryFn: () => fetchScoreBreakdown(selectedSolutionId!),
    enabled: selectedSolutionId !== null,
  });

  const { data: viewLessons = [] } = useQuery({
    queryKey: [
      "view-lessons",
      selectedSolutionId,
      viewMode,
      viewTargetId,
    ],
    queryFn: () =>
      viewMode === "class"
        ? fetchLessonsByClass(selectedSolutionId!, viewTargetId!)
        : fetchLessonsByTeacher(selectedSolutionId!, viewTargetId!),
    enabled: selectedSolutionId !== null && viewTargetId !== null,
  });

  const { data: allScheduledMeetings = [] } = useQuery({
    queryKey: ["scheduled-meetings", selectedSolutionId],
    queryFn: () => fetchScheduledMeetings(selectedSolutionId!),
    enabled: selectedSolutionId !== null,
  });

  const { data: teacherPresence } = useQuery({
    queryKey: ["teacher-presence", selectedSolutionId, viewTargetId],
    queryFn: () => fetchTeacherPresence(selectedSolutionId!, viewTargetId!),
    enabled:
      selectedSolutionId !== null &&
      viewTargetId !== null &&
      viewMode === "teacher",
  });

  const { data: meetings = [] } = useQuery({
    queryKey: ["meetings", schoolId],
    queryFn: () => fetchMeetings(schoolId!),
    enabled: !!schoolId,
  });

  const { data: clusters = [] } = useQuery({
    queryKey: ["grouping-clusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: !!schoolId,
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteSolution(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solutions", schoolId] });
      toast.success("פתרון נמחק");
      setDeleteTarget(null);
      if (selectedSolutionId === deleteTarget?.id) {
        setSelectedSolutionId(null);
      }
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  const subjectMap = Object.fromEntries(
    subjects.map((s) => [s.id, { name: s.name, color: s.color }]),
  );
  const teacherMap = Object.fromEntries(
    teachers.map((t) => [t.id, t.name]),
  );
  const classMap = Object.fromEntries(
    classes.map((c) => [c.id, c.name]),
  );

  const meetingMap = Object.fromEntries(
    meetings.map((m) => [m.id, { id: m.id, name: m.name, color: m.color }]),
  );

  const trackMap = Object.fromEntries(
    clusters.flatMap((c) =>
      c.tracks.map((t) => {
        // Use cluster name for context (remove "הקבצת " prefix if present)
        const clusterLabel = c.name.replace(/^הקבצת\s*/, "");
        // If track name differs from cluster subject, use track name
        // Otherwise use the cluster label which includes the grade
        const subj = subjectMap[c.subject_id];
        const trackLabel =
          t.name !== subj?.name ? `${t.name} (${clusterLabel})` : clusterLabel;
        return [t.id, trackLabel];
      }),
    ),
  );

  // Filter meetings for current view target
  const filteredMeetings =
    viewMode === "teacher" && viewTargetId
      ? allScheduledMeetings.filter((sm) => {
          const meeting = meetings.find((m) => m.id === sm.meeting_id);
          return meeting?.teacher_ids.includes(viewTargetId);
        })
      : viewMode === "class"
        ? [] // Meetings are teacher-level, not shown in class view
        : allScheduledMeetings;

  const days = DAYS_ORDER.slice(
    0,
    school?.days_per_week ?? 6,
  ) as unknown as string[];
  const maxPeriod = school?.periods_per_day ?? 8;

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">תוצאות</h2>

      {/* Solutions List */}
      <div className="space-y-2">
        {solutions.length === 0 && (
          <p className="text-muted-foreground text-center py-8">
            אין פתרונות — הרץ את הפותר קודם
          </p>
        )}
        {solutions.map((sol) => (
          <div
            key={sol.id}
            className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
              selectedSolutionId === sol.id
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
            onClick={() => {
              setSelectedSolutionId(sol.id);
              // Auto-select first target
              if (viewMode === "class" && classes.length > 0) {
                setViewTargetId(classes[0].id);
              } else if (viewMode === "teacher" && teachers.length > 0) {
                setViewTargetId(teachers[0].id);
              }
            }}
          >
            <Badge
              variant={
                sol.status === "OPTIMAL"
                  ? "success"
                  : sol.status === "FEASIBLE"
                    ? "warning"
                    : "destructive"
              }
            >
              {sol.status}
            </Badge>
            <span className="font-medium">ציון: {sol.total_score}</span>
            <span className="text-sm text-muted-foreground">
              {sol.solve_time_seconds}s
            </span>
            <span className="text-xs text-muted-foreground me-auto">
              {new Date(sol.created_at).toLocaleString("he-IL")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/api/solutions/${sol.id}/export/excel`, "_blank");
              }}
              title="ייצוא Excel"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(sol);
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      {/* Selected Solution View */}
      {selectedSolutionId && (
        <>
          {/* Score Breakdown */}
          {scoreBreakdown && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  פירוט ציון
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6 mb-4">
                  <div>
                    <span className="text-3xl font-bold">
                      {scoreBreakdown.total_score}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      /100
                    </span>
                  </div>
                  <Badge variant="success">
                    {scoreBreakdown.satisfied_hard}/
                    {scoreBreakdown.total_hard} אילוצי חובה
                  </Badge>
                </div>
                {scoreBreakdown.soft_scores.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">אילוצים רכים:</p>
                    {scoreBreakdown.soft_scores.map((s) => (
                      <div
                        key={s.constraint_id}
                        className="flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm truncate">
                              {s.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {Math.round(s.satisfaction * 100)}%
                            </span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${s.satisfaction * 100}%`,
                                backgroundColor:
                                  s.satisfaction > 0.8
                                    ? "#22c55e"
                                    : s.satisfaction > 0.5
                                      ? "#eab308"
                                      : "#ef4444",
                              }}
                            />
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          משקל {s.weight}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Violations */}
          {scoreBreakdown?.violations?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  חריגות ({scoreBreakdown.violations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {scoreBreakdown.violations.map(
                    (
                      v: {
                        category: string;
                        severity: string;
                        message: string;
                      },
                      i: number,
                    ) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-sm py-1 border-b border-muted last:border-0"
                      >
                        <Badge
                          variant={
                            v.severity === "חובה" ? "destructive" : "warning"
                          }
                          className="shrink-0 mt-0.5"
                        >
                          {v.severity}
                        </Badge>
                        <span>{v.message}</span>
                      </div>
                    ),
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timetable View */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                מערכת שעות
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Select
                  className="w-32"
                  value={viewMode}
                  onChange={(e) => {
                    const mode = e.target.value as "class" | "teacher";
                    setViewMode(mode);
                    if (mode === "class" && classes.length > 0) {
                      setViewTargetId(classes[0].id);
                    } else if (mode === "teacher" && teachers.length > 0) {
                      setViewTargetId(teachers[0].id);
                    } else {
                      setViewTargetId(null);
                    }
                  }}
                >
                  <option value="class">לפי כיתה</option>
                  <option value="teacher">לפי מורה</option>
                </Select>

                <Select
                  className="flex-1"
                  value={viewTargetId ?? ""}
                  onChange={(e) =>
                    setViewTargetId(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                >
                  <option value="">
                    בחר {viewMode === "class" ? "כיתה" : "מורה"}
                  </option>
                  {(viewMode === "class" ? classes : teachers).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>

              {viewTargetId &&
                (viewLessons.length > 0 || filteredMeetings.length > 0) && (
                  <>
                    {viewMode === "teacher" && teacherPresence && (
                      <div className="flex gap-4 text-sm border rounded-lg p-3 bg-muted/30">
                        <span>
                          <strong>פרונטלי:</strong>{" "}
                          {teacherPresence.frontal_hours}
                        </span>
                        <span className="text-blue-600">
                          <strong>פרטני:</strong>{" "}
                          {teacherPresence.individual_hours}
                        </span>
                        <span className="text-amber-600">
                          <strong>שהייה:</strong>{" "}
                          {teacherPresence.staying_hours}
                        </span>
                        <span
                          className={
                            teacherPresence.actual_gaps >
                            teacherPresence.allowed_gaps
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }
                        >
                          <strong>חלונות:</strong>{" "}
                          {teacherPresence.actual_gaps}/
                          {teacherPresence.allowed_gaps}
                        </span>
                      </div>
                    )}
                    <TimetableGrid
                      lessons={viewLessons}
                      days={days}
                      maxPeriod={maxPeriod}
                      subjectMap={subjectMap}
                      teacherMap={teacherMap}
                      classMap={classMap}
                      trackMap={trackMap}
                      showTeacher={viewMode === "class"}
                      showClass={viewMode === "teacher"}
                      meetings={filteredMeetings}
                      meetingMap={meetingMap}
                      presenceSlots={
                        viewMode === "teacher" && teacherPresence
                          ? teacherPresence.slots
                              .filter(
                                (s) =>
                                  s.slot_type !== "frontal" &&
                                  s.slot_type !== "meeting",
                              )
                              .map((s) => ({
                                day: s.day,
                                period: s.period,
                                slot_type: s.slot_type,
                              }))
                          : []
                      }
                    />
                  </>
                )}

              {viewTargetId &&
                viewLessons.length === 0 &&
                filteredMeetings.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  אין שיעורים לתצוגה זו
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה"
        message="האם למחוק פתרון זה? פעולה זו לא ניתנת לביטול."
        loading={deleteMut.isPending}
      />
    </div>
  );
}
