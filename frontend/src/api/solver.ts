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

export async function fetchScoreBreakdown(
  solutionId: number,
): Promise<ScoreBreakdown> {
  const { data } = await api.get<ScoreBreakdown>(
    `/solutions/${solutionId}/score-breakdown`,
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

export interface OverlapConflict {
  teacher_id: number;
  teacher_name: string;
  items: OverlapItem[];
  message: string;
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
