import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Eye, Download, FileText, AlertTriangle, Users, Check, X, ClipboardList, ChevronLeft, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { useAuthStore } from "@/stores/authStore";
import {
  fetchSolutions,
  deleteSolution,
  fetchScoreBreakdown,
  fetchLessonsByClass,
  fetchLessonsByTeacher,
  fetchLessonsBySubject,
  fetchScheduledMeetings,
  fetchTeacherPresence,
  fetchMeetingAbsences,
  fetchPlenaryAttendance,
  fetchSolutionSummary,
} from "@/api/solver";
import type { HomeroomTeacherSummary, BrainScoreItem } from "@/api/solver";
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
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";
import type { Solution } from "@/types/models";

export default function ResultsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const { data: school } = useActiveSchool();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedSolutionId, setSelectedSolutionId] = useState<number | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"class" | "teacher" | "subject" | "meetings">("class");
  const [viewTargetId, setViewTargetId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Solution | null>(null);
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);

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

  const { data: solutionSummary } = useQuery({
    queryKey: ["solution-summary", selectedSolutionId],
    queryFn: () => fetchSolutionSummary(selectedSolutionId!),
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
        : viewMode === "subject"
          ? fetchLessonsBySubject(selectedSolutionId!, viewTargetId!)
          : fetchLessonsByTeacher(selectedSolutionId!, viewTargetId!),
    enabled: selectedSolutionId !== null && viewTargetId !== null && viewMode !== "meetings",
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

  const { data: meetingAbsences = [] } = useQuery({
    queryKey: ["meeting-absences", schoolId],
    queryFn: () => fetchMeetingAbsences(schoolId!),
    enabled: !!schoolId,
  });

  const { data: plenaryAttendance = [] } = useQuery({
    queryKey: ["plenary-attendance", selectedSolutionId],
    queryFn: () => fetchPlenaryAttendance(selectedSolutionId!),
    enabled: selectedSolutionId !== null,
  });

  const { data: clusters = [] } = useQuery({
    queryKey: ["grouping-clusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: !!schoolId,
  });

  // Deep link from entity pages: ?view=teacher&id=123
  useEffect(() => {
    if (deepLinkApplied || solutions.length === 0) return;
    const view = searchParams.get("view") as "class" | "teacher" | "subject" | "meetings" | null;
    const id = searchParams.get("id");
    if (view) {
      setViewMode(view);
      if (id) setViewTargetId(Number(id));
      // Auto-select latest solution
      setSelectedSolutionId(solutions[0].id);
      setDeepLinkApplied(true);
      // Clear params from URL
      setSearchParams({}, { replace: true });
    }
  }, [solutions, searchParams, deepLinkApplied, setSearchParams]);

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

  // Arrow navigation for teachers
  const sortedTeachers = [...teachers].sort((a, b) => a.name.localeCompare(b.name, "he"));
  const currentTeacherIndex = sortedTeachers.findIndex((t) => t.id === viewTargetId);
  const handlePrevTeacher = () => {
    if (!sortedTeachers.length) return;
    const newIdx = currentTeacherIndex <= 0 ? sortedTeachers.length - 1 : currentTeacherIndex - 1;
    setViewTargetId(sortedTeachers[newIdx].id);
  };
  const handleNextTeacher = () => {
    if (!sortedTeachers.length) return;
    const newIdx = currentTeacherIndex >= sortedTeachers.length - 1 ? 0 : currentTeacherIndex + 1;
    setViewTargetId(sortedTeachers[newIdx].id);
  };

  // Arrow navigation for classes
  const sortedClasses = [...classes].sort((a, b) => a.name.localeCompare(b.name, "he"));
  const currentClassIndex = sortedClasses.findIndex((c) => c.id === viewTargetId);
  const handlePrevClass = () => {
    if (!sortedClasses.length) return;
    const newIdx = currentClassIndex <= 0 ? sortedClasses.length - 1 : currentClassIndex - 1;
    setViewTargetId(sortedClasses[newIdx].id);
  };
  const handleNextClass = () => {
    if (!sortedClasses.length) return;
    const newIdx = currentClassIndex >= sortedClasses.length - 1 ? 0 : currentClassIndex + 1;
    setViewTargetId(sortedClasses[newIdx].id);
  };

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
  // Exclude teachers who are absent from meetings (approved absences)
  const filteredMeetings =
    viewMode === "teacher" && viewTargetId
      ? allScheduledMeetings.filter((sm) => {
          const meeting = meetings.find((m) => m.id === sm.meeting_id);
          if (!meeting?.teacher_ids.includes(viewTargetId)) return false;
          const isAbsent = meetingAbsences.some(
            (a) => a.meeting_id === sm.meeting_id && a.teacher_id === viewTargetId,
          );
          return !isAbsent;
        })
      : viewMode === "meetings"
        ? allScheduledMeetings
        : []; // class and subject views don't show meetings

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
              } else if (viewMode === "subject" && subjects.length > 0) {
                setViewTargetId(subjects[0].id);
              }
            }}
          >
            <span className="text-xs text-muted-foreground font-mono">#{sol.id}</span>
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
              {new Date(sol.created_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                {
                  const token = useAuthStore.getState().token;
                  fetch(`/api/solutions/${sol.id}/export/excel`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                  })
                    .then((res) => {
                      if (!res.ok) throw new Error("Export failed");
                      return res.blob();
                    })
                    .then((blob) => {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `timetable_solution_${sol.id}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                    .catch(() => toast.error("שגיאה בהורדת קובץ"));
                }
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
                const token = useAuthStore.getState().token;
                toast.loading("מייצר PDF...", { id: "pdf-export" });
                fetch(`/api/solutions/${sol.id}/export/pdf`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                })
                  .then((res) => {
                    if (!res.ok) throw new Error("Export failed");
                    return res.blob();
                  })
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `timetable_solution_${sol.id}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("PDF הורד בהצלחה", { id: "pdf-export" });
                  })
                  .catch(() => toast.error("שגיאה בייצוא PDF", { id: "pdf-export" }));
              }}
              title="ייצוא PDF"
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                const token = useAuthStore.getState().token;
                fetch(`/api/solutions/${sol.id}/export/shahaf`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                })
                  .then((res) => {
                    if (!res.ok) return res.json().then((err) => { throw new Error(err?.detail ?? "Export failed"); });
                    const matched = res.headers.get("X-Shahaf-Matched") ?? "?";
                    const unmatched = res.headers.get("X-Shahaf-Unmatched") ?? "0";
                    toast.success(`ייצוא לשחף: ${matched} שיעורים מופו, ${unmatched} לא מופו`);
                    return res.blob();
                  })
                  .then((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `shahaf_updated_${sol.id}.zip`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch((err) => toast.error(`שגיאה בייצוא לשחף: ${err instanceof Error ? err.message : String(err)}`));
              }}
              title="ייצוא לשחף"
            >
              <Download className="h-4 w-4 text-indigo-500" />
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
          {/* Timetable View — shown FIRST */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                מערכת שעות
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Select
                  className="w-40"
                  value={viewMode}
                  onChange={(e) => {
                    const mode = e.target.value as "class" | "teacher" | "subject" | "meetings";
                    setViewMode(mode);
                    if (mode === "class" && classes.length > 0) {
                      setViewTargetId(classes[0].id);
                    } else if (mode === "teacher" && teachers.length > 0) {
                      setViewTargetId(teachers[0].id);
                    } else if (mode === "subject" && subjects.length > 0) {
                      setViewTargetId(subjects[0].id);
                    } else if (mode === "meetings") {
                      setViewTargetId(null);
                    } else {
                      setViewTargetId(null);
                    }
                  }}
                >
                  <option value="class">לפי כיתה</option>
                  <option value="teacher">לפי מורה</option>
                  <option value="subject">לפי מקצוע</option>
                  <option value="meetings">מערכת ישיבות</option>
                </Select>

                {viewMode === "teacher" && (
                  <>
                    <Select
                      className="flex-1"
                      value={viewTargetId ?? ""}
                      onChange={(e) =>
                        setViewTargetId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">בחר מורה</option>
                      {sortedTeachers.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                    <div className="flex items-center gap-0.5" dir="ltr">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={handlePrevTeacher}
                        disabled={!sortedTeachers.length}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground shrink-0 min-w-[2.5rem] text-center">
                        {currentTeacherIndex >= 0 ? `${currentTeacherIndex + 1}/${sortedTeachers.length}` : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={handleNextTeacher}
                        disabled={!sortedTeachers.length}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}

                {viewMode === "class" && (
                  <>
                    <Select
                      className="flex-1"
                      value={viewTargetId ?? ""}
                      onChange={(e) =>
                        setViewTargetId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">בחר כיתה</option>
                      {sortedClasses.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                    <div className="flex items-center gap-0.5" dir="ltr">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={handlePrevClass}
                        disabled={!sortedClasses.length}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground shrink-0 min-w-[2.5rem] text-center">
                        {currentClassIndex >= 0 ? `${currentClassIndex + 1}/${sortedClasses.length}` : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={handleNextClass}
                        disabled={!sortedClasses.length}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}

                {viewMode === "subject" && (
                  <Select
                    className="flex-1"
                    value={viewTargetId ?? ""}
                    onChange={(e) =>
                      setViewTargetId(
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  >
                    <option value="">בחר מקצוע</option>
                    {subjects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              {/* Meetings view */}
              {viewMode === "meetings" && allScheduledMeetings.length > 0 && (
                <TimetableGrid
                  lessons={[]}
                  days={days}
                  maxPeriod={maxPeriod}
                  subjectMap={subjectMap}
                  teacherMap={teacherMap}
                  classMap={classMap}
                  trackMap={trackMap}
                  showTeacher={false}
                  showClass={false}
                  meetings={allScheduledMeetings}
                  meetingMap={meetingMap}
                />
              )}
              {viewMode === "meetings" && allScheduledMeetings.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  אין ישיבות מתוזמנות בפתרון זה
                </p>
              )}

              {/* Class / Teacher / Subject views */}
              {viewMode !== "meetings" && viewTargetId &&
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
                      showTeacher={viewMode === "class" || viewMode === "subject"}
                      showClass={viewMode === "teacher" || viewMode === "subject"}
                      meetings={filteredMeetings}
                      meetingMap={meetingMap}
                      meetingAbsences={meetingAbsences}
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

              {viewMode !== "meetings" && viewTargetId &&
                viewLessons.length === 0 &&
                filteredMeetings.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  אין שיעורים לתצוגה זו
                </p>
              )}
            </CardContent>
          </Card>

          {/* Solution Summary */}
          {solutionSummary && <SolutionSummaryCard summary={solutionSummary} />}

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

          {/* Plenary Attendance */}
          {plenaryAttendance.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-rose-400" />
                  ישיבת מליאה
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {plenaryAttendance.map((pa) => (
                  <div key={pa.meeting_id} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{pa.meeting_name}</span>
                      <Badge variant="outline">
                        {pa.plenary_days.map((d) => DAY_LABELS[d] ?? d).join(", ")}
                      </Badge>
                      <Badge variant="success">
                        {pa.attending_count}/{pa.total_teachers} נוכחים
                      </Badge>
                    </div>

                    {/* All attending teachers (mandatory + preferred) */}
                    {(() => {
                      const allAttending = [
                        ...pa.mandatory_teachers,
                        ...pa.preferred_attending,
                      ];
                      return allAttending.length > 0 ? (
                        <div>
                          <span className="text-xs font-medium text-emerald-700 mb-1 block">
                            <Check className="h-3 w-3 inline ml-1" />
                            נוכחים ({allAttending.length})
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {allAttending.map((t) => (
                              <Badge key={t.id} className="text-xs bg-emerald-100 text-emerald-800 border-emerald-300" variant="outline">
                                {t.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    })()}

                    {pa.preferred_absent.length > 0 && (
                      <div>
                        <span className="text-xs font-medium text-orange-600 mb-1 block">
                          <X className="h-3 w-3 inline ml-1" />
                          נוכחות מועדפת — לא נוכחים ({pa.preferred_absent.length})
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {pa.preferred_absent.map((t) => (
                            <Badge key={t.id} className="text-xs bg-orange-50 text-orange-700 border-orange-200" variant="outline">
                              {t.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Trade-off analysis */}
                    {pa.tradeoffs && pa.tradeoffs.length > 0 && (
                      <div className="rounded-md border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
                        <span className="text-xs font-semibold text-indigo-800 block">
                          ניתוח מה-אם: שחרור מורה נעול/ה יכול להוסיף נוכחים
                        </span>
                        {pa.tradeoffs.map((tf) => (
                          <div key={tf.locked_teacher.id} className="text-xs border-t border-indigo-200 pt-2">
                            <span className="text-indigo-900">
                              אם <strong>{tf.locked_teacher.name}</strong> לא הייתה נעולה →
                              מליאה ביום <strong>{tf.potential_day_label}</strong> →
                              {" "}<strong className="text-emerald-700">+{tf.gained_count}</strong> מורים נוספים:
                            </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {tf.gained_teachers.map((gt) => (
                                <Badge key={gt.id} className="text-xs bg-emerald-50 text-emerald-700 border-emerald-300" variant="outline">
                                  {gt.name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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


/* ─── Solution Summary Card ─────────────────────────────────────────── */

function ScoreBar({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-left">{Math.round(pct)}%</span>
    </div>
  );
}

function SolutionSummaryCard({ summary }: { summary: import("@/api/solver").SolutionSummary }) {
  const [tab, setTab] = useState<"hard" | "soft" | "homeroom">("hard");

  const { homeroom_summary, brain_hard, brain_soft, user_constraints } = summary;

  // Combine all soft items for the soft tab
  const allSoftItems = [
    ...brain_soft.items.map((b) => ({ ...b, source: "מוח" })),
    ...user_constraints.items.map((s) => ({ ...s, source: "משתמש" })),
  ].sort((a, b) => a.satisfaction - b.satisfaction);

  const totalSoftWeight = brain_soft.total_weight + user_constraints.items.reduce((s, c) => s + c.weight, 0);
  const totalSoftScored = brain_soft.total_scored + user_constraints.items.reduce((s, c) => s + c.weighted_score, 0);

  const tabs = [
    { id: "hard" as const, label: "אילוצי חובה", badge: `${brain_hard.satisfied}/${brain_hard.total}` },
    { id: "soft" as const, label: "אילוצים רכים", badge: `${Math.round((totalSoftScored / Math.max(totalSoftWeight, 1)) * 100)}%` },
    { id: "homeroom" as const, label: "מחנכות", badge: String(homeroom_summary.length) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          ניתוח פתרון
          <div className="mr-auto flex items-center gap-3">
            <span className="text-3xl font-bold">{summary.total_score}</span>
            <span className="text-muted-foreground text-sm">/100</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Tabs ── */}
        <div className="flex gap-1 border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <Badge variant="outline" className="text-[10px] mr-2">{t.badge}</Badge>
            </button>
          ))}
        </div>

        {/* ── Tab: אילוצי חובה ── */}
        {tab === "hard" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge variant={brain_hard.satisfied === brain_hard.total ? "success" : "destructive"} className="text-sm px-3 py-1">
                {brain_hard.satisfied === brain_hard.total ? (
                  <><Check className="h-4 w-4 ml-1" /> כל אילוצי החובה מסופקים</>
                ) : (
                  <><X className="h-4 w-4 ml-1" /> {brain_hard.total - brain_hard.satisfied} אילוצים לא מסופקים</>
                )}
              </Badge>
            </div>
            <div className="space-y-1">
              {brain_hard.items.map((b) => (
                <div key={b.constraint_id} className="flex items-center gap-2 py-1.5 border-b border-muted last:border-0">
                  {b.satisfaction === 1 ? (
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-red-500 shrink-0" />
                  )}
                  <span className="text-sm flex-1">{b.name}</span>
                  <Badge variant={b.satisfaction === 1 ? "success" : "destructive"} className="text-[10px]">
                    {b.satisfaction === 1 ? "מסופק" : "נכשל"}
                  </Badge>
                </div>
              ))}
              {brain_hard.items.length === 0 && (
                <p className="text-sm text-muted-foreground">אין אילוצי חובה</p>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: אילוצים רכים ── */}
        {tab === "soft" && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                ניקוד כולל: <strong>{totalSoftScored.toFixed(0)}</strong> / {totalSoftWeight.toFixed(0)}
              </span>
              <div className="h-3 flex-1 max-w-xs bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${totalSoftWeight > 0 ? (totalSoftScored / totalSoftWeight) * 100 : 0}%`,
                    backgroundColor: totalSoftScored / Math.max(totalSoftWeight, 1) > 0.8 ? "#22c55e" : totalSoftScored / Math.max(totalSoftWeight, 1) > 0.5 ? "#eab308" : "#ef4444",
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              {allSoftItems.map((s) => (
                <React.Fragment key={`${s.source}-${s.constraint_id}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">{s.name}</span>
                    <ScoreBar value={s.weighted_score} max={s.weight} className="w-32" />
                    <span className="text-xs text-muted-foreground w-14 text-left shrink-0">
                      {s.weighted_score.toFixed(0)}/{s.weight}
                    </span>
                  </div>
                  {(s as any).label_breakdown && (s as any).label_breakdown.length > 0 && s.satisfaction < 1 && (
                    <div className="mr-4 mb-1 flex flex-wrap gap-1">
                      {(s as any).label_breakdown.map((lb: any) => (
                        <Badge
                          key={lb.label}
                          variant="outline"
                          className={`text-[10px] ${
                            lb.satisfaction >= 1 ? "border-emerald-300 text-emerald-700"
                              : lb.satisfaction > 0.5 ? "border-amber-300 text-amber-700"
                              : "border-red-300 text-red-700"
                          }`}
                        >
                          {lb.label}: {Math.round(lb.satisfaction * 100)}%
                        </Badge>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))}
              {allSoftItems.length === 0 && (
                <p className="text-sm text-muted-foreground">אין אילוצים רכים</p>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: מחנכות ── */}
        {tab === "homeroom" && (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-right py-1.5 px-2 font-medium">מחנכת</th>
                    <th className="text-right py-1.5 px-2 font-medium">כיתה</th>
                    <th className="text-center py-1.5 px-2 font-medium">נוכחות</th>
                    <th className="text-center py-1.5 px-2 font-medium">פתיחת בוקר</th>
                    <th className="text-right py-1.5 px-2 font-medium">ימים חסרים</th>
                    <th className="text-right py-1.5 px-2 font-medium">פירוט ימים</th>
                  </tr>
                </thead>
                <tbody>
                  {homeroom_summary.map((h) => (
                    <tr key={h.teacher_id} className="border-b border-muted last:border-0 hover:bg-muted/50">
                      <td className="py-1.5 px-2">{h.teacher_name}</td>
                      <td className="py-1.5 px-2">{h.class_name}</td>
                      <td className="text-center py-1.5 px-2">
                        <Badge variant={h.present_days >= 4 ? "success" : h.present_days >= 3 ? "warning" : "destructive"}>
                          {h.present_days}/{h.total_days}
                        </Badge>
                      </td>
                      <td className="text-center py-1.5 px-2">
                        <Badge variant={h.opens_morning_count >= 3 ? "success" : h.opens_morning_count >= 1 ? "warning" : "destructive"}>
                          {h.opens_morning_count}/{h.total_days}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground text-xs">
                        {h.absent_days.length > 0 ? h.absent_days.join(", ") : "—"}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex flex-wrap gap-0.5">
                          {h.day_details.map((dd) => (
                            <span
                              key={dd.day}
                              className={`inline-block px-1 py-0.5 rounded text-[10px] ${dd.opens ? "bg-emerald-100 text-emerald-800" : dd.periods.length > 0 ? "bg-muted text-muted-foreground" : "bg-red-50 text-red-400"}`}
                              title={dd.periods.length > 0 ? `שעות ${dd.periods.join(",")}` : "לא נוכחת"}
                            >
                              {dd.day_label}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {homeroom_summary.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">אין מחנכות מוגדרות</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
