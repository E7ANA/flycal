import api from "./client";
import type {
  Solution,
  SolutionDetail,
  ScheduledLesson,
  ScheduledMeeting,
  ScoreBreakdown,
  ValidationResult,
} from "@/types/models";

interface SolveRequest {
  school_id: number;
  max_time?: number;
  max_solutions?: number;
  num_workers?: number;
}

export interface DiagnosisItem {
  source: string; // "user_constraint" | "brain_rule" | "system" | "combination"
  name: string;
  constraint_id: number | null;
  rule_type: string | null;
  details: string;
}

interface SolveResponse {
  status: string;
  message: string;
  solve_time: number;
  solutions: Solution[];
  diagnosis?: DiagnosisItem[] | null;
}

export async function runSolver(req: SolveRequest): Promise<SolveResponse> {
  const timeout = ((req.max_time ?? 300) + 60) * 1000; // max_time + 60s buffer
  const { data } = await api.post<SolveResponse>("/solve", req, { timeout });
  return data;
}

export async function stopSolver(jobId: string): Promise<void> {
  await api.post(`/solve/${jobId}/stop`);
}

export async function fetchSolutions(schoolId: number): Promise<Solution[]> {
  const { data } = await api.get<Solution[]>("/solutions", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function fetchSolution(id: number): Promise<SolutionDetail> {
  const { data } = await api.get<SolutionDetail>(`/solutions/${id}`);
  return data;
}

export async function deleteSolution(id: number): Promise<void> {
  await api.delete(`/solutions/${id}`);
}

export async function fetchLessonsByClass(
  solutionId: number,
  classId: number,
): Promise<ScheduledLesson[]> {
  const { data } = await api.get<ScheduledLesson[]>(
    `/solutions/${solutionId}/by-class/${classId}`,
  );
  return data;
}

export async function fetchLessonsByTeacher(
  solutionId: number,
  teacherId: number,
): Promise<ScheduledLesson[]> {
  const { data } = await api.get<ScheduledLesson[]>(
    `/solutions/${solutionId}/by-teacher/${teacherId}`,
  );
  return data;
}

export async function fetchLessonsBySubject(
  solutionId: number,
  subjectId: number,
): Promise<ScheduledLesson[]> {
  const { data } = await api.get<ScheduledLesson[]>(
    `/solutions/${solutionId}/by-subject/${subjectId}`,
  );
  return data;
}

export async function fetchScoreBreakdown(
  solutionId: number,
): Promise<ScoreBreakdown> {
  const { data } = await api.get<ScoreBreakdown>(
    `/solutions/${solutionId}/score-breakdown`,
  );
  return data;
}

export interface HomeroomDayDetail {
  day: string;
  day_label: string;
  periods: number[];
  opens: boolean;
}

export interface HomeroomTeacherSummary {
  teacher_id: number;
  teacher_name: string;
  class_id: number;
  class_name: string;
  present_days: number;
  total_days: number;
  absent_days: string[];
  opens_morning_count: number;
  opens_morning_days: string[];
  day_details: HomeroomDayDetail[];
}

export interface BrainScoreItem {
  constraint_id: number;
  name: string;
  weight: number;
  satisfaction: number;
  weighted_score: number;
  is_brain?: boolean;
  is_hard?: boolean;
}

export interface SolutionSummary {
  solution_id: number;
  total_score: number;
  homeroom_summary: HomeroomTeacherSummary[];
  brain_hard: { satisfied: number; total: number; items: BrainScoreItem[] };
  brain_soft: { items: BrainScoreItem[]; total_weight: number; total_scored: number };
  user_constraints: { items: BrainScoreItem[] };
}

export async function fetchSolutionSummary(
  solutionId: number,
): Promise<SolutionSummary> {
  const { data } = await api.get<SolutionSummary>(
    `/solutions/${solutionId}/summary`,
  );
  return data;
}

export async function fetchScheduledMeetings(
  solutionId: number,
): Promise<ScheduledMeeting[]> {
  const { data } = await api.get<ScheduledMeeting[]>(
    `/solutions/${solutionId}/meetings`,
  );
  return data;
}

// ── Teacher presence (שהייה / פרטני) ──────────────────────────────────────

export interface TeacherSlotAnnotation {
  day: string;
  period: number;
  slot_type: string; // "frontal" | "meeting" | "שהייה" | "שהייה (ישיבה)" | "פרטני" | "חלון"
  subject_name: string | null;
  class_name: string | null;
  meeting_name: string | null;
}

export interface TeacherPresence {
  teacher_id: number;
  teacher_name: string;
  frontal_hours: number;
  individual_hours: number;
  staying_hours: number;
  allowed_gaps: number;
  actual_gaps: number;
  slots: TeacherSlotAnnotation[];
}

export async function fetchTeacherPresence(
  solutionId: number,
  teacherId: number,
): Promise<TeacherPresence> {
  const { data } = await api.get<TeacherPresence>(
    `/solutions/${solutionId}/by-teacher/${teacherId}/presence`,
  );
  return data;
}

export async function validateBeforeSolve(
  schoolId: number,
): Promise<ValidationResult> {
  const { data } = await api.post<ValidationResult>("/validate", {
    school_id: schoolId,
  });
  return data;
}

// ── Overlap detection & resolution ──────────────────────────────────────

export interface OverlapItem {
  type: "requirement" | "track" | "meeting" | "teacher_absence";
  id: number;
  label: string;
  teacher_id: number;
  teacher_name: string;
}

export interface OverlapResolution {
  action: "remove_from_meeting" | "unlock_teacher";
  label: string;
  meeting_id: number | null;
  teacher_id: number | null;
}

export interface OverlapConflict {
  teacher_id: number;
  teacher_name: string;
  items: OverlapItem[];
  message: string;
  resolutions: OverlapResolution[];
}

export interface OverlapDetectionResult {
  conflicts: OverlapConflict[];
  approved: OverlapConflict[];
}

export async function detectOverlaps(
  schoolId: number,
): Promise<OverlapDetectionResult> {
  const { data } = await api.post<OverlapDetectionResult>("/detect-overlaps", {
    school_id: schoolId,
  });
  return data;
}

export async function toggleOverlaps(
  schoolId: number,
  items: { type: string; id: number }[],
  allow: boolean,
): Promise<{ updated: number }> {
  const { data } = await api.post<{ updated: number }>("/toggle-overlaps", {
    school_id: schoolId,
    items,
    allow,
  });
  return data;
}

export async function applyResolution(
  action: string,
  meetingId: number,
  teacherId: number,
): Promise<{ success: boolean; message: string }> {
  const { data } = await api.post<{ success: boolean; message: string }>(
    "/apply-resolution",
    { action, meeting_id: meetingId, teacher_id: teacherId },
  );
  return data;
}

export async function clearAllOverlaps(
  schoolId: number,
): Promise<{ cleared: number }> {
  const { data } = await api.post<{ cleared: number }>("/clear-all-overlaps", {
    school_id: schoolId,
  });
  return data;
}

// ── Meeting absences ─────────────────────────────────────────────────────

export interface MeetingAbsence {
  meeting_id: number;
  meeting_name: string;
  teacher_id: number;
  teacher_name: string;
}

export async function fetchMeetingAbsences(
  schoolId: number,
): Promise<MeetingAbsence[]> {
  const { data } = await api.get<MeetingAbsence[]>("/meeting-absences", {
    params: { school_id: schoolId },
  });
  return data;
}

// ── Async solve with polling ──────────────────────────────────────────

export async function startSolveAsync(
  req: SolveRequest,
): Promise<{ job_id: string }> {
  const { data } = await api.post<{ job_id: string }>("/solve-async", req);
  return data;
}

export interface SolveProgressData {
  step: string;
  step_label: string;
  step_number: number;
  total_steps: number;
  percent: number;
  solutions_found: number;
  elapsed: number;
  done: boolean;
  result?: SolveResponse;
}

export async function pollSolveProgress(
  jobId: string,
): Promise<SolveProgressData> {
  const { data } = await api.get<SolveProgressData>(`/solve/${jobId}/progress`);
  return data;
}

// ── Plenary attendance ─────────────────────────────────────────────────

export interface PlenaryTeacherInfo {
  id: number;
  name: string;
}

export interface PlenaryTradeoff {
  locked_teacher: PlenaryTeacherInfo;
  potential_day: string;
  potential_day_label: string;
  gained_teachers: PlenaryTeacherInfo[];
  gained_count: number;
}

export interface PlenaryAttendance {
  meeting_id: number;
  meeting_name: string;
  plenary_days: string[];
  mandatory_teachers: PlenaryTeacherInfo[];
  preferred_attending: PlenaryTeacherInfo[];
  preferred_absent: PlenaryTeacherInfo[];
  total_teachers: number;
  attending_count: number;
  tradeoffs: PlenaryTradeoff[];
}

export async function fetchPlenaryAttendance(
  solutionId: number,
): Promise<PlenaryAttendance[]> {
  const { data } = await api.get<PlenaryAttendance[]>(
    `/solutions/${solutionId}/plenary-attendance`,
  );
  return data;
}

// ── SSE-based solve with progress ────────────────────────────────────────

export interface SolveProgress {
  step: string;
  step_label: string;
  step_number: number;
  total_steps: number;
  percent: number;
  solutions_found: number;
  elapsed: number;
  done: boolean;
}

export function solveWithProgress(
  req: SolveRequest,
  onProgress: (progress: SolveProgress) => void,
  onResult: (result: SolveResponse) => void,
  onError: (error: string) => void,
): () => void {
  const controller = new AbortController();

  fetch("/api/solve-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        onError(`HTTP ${response.status}`);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        onError("No response body");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "message";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);
              if (eventType === "result") {
                onResult(parsed as SolveResponse);
              } else {
                onProgress(parsed as SolveProgress);
              }
            } catch {
              // ignore parse errors
            }
            eventType = "message";
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError(String(err));
      }
    });

  return () => controller.abort();
}
