import api from "./client";
import type { Subject, SubjectRequirement } from "@/types/models";

export async function fetchSubjects(schoolId: number): Promise<Subject[]> {
  const { data } = await api.get<Subject[]>("/subjects", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function createSubject(
  payload: Omit<Subject, "id">,
): Promise<Subject> {
  const { data } = await api.post<Subject>("/subjects", payload);
  return data;
}

export async function updateSubject(
  id: number,
  payload: Partial<Subject>,
): Promise<Subject> {
  const { data } = await api.put<Subject>(`/subjects/${id}`, payload);
  return data;
}

export async function deleteSubject(id: number): Promise<void> {
  await api.delete(`/subjects/${id}`);
}

// ─── Requirements ────────────────────────────────────────
export async function fetchRequirements(
  schoolId: number,
  includeGrouped = true,
): Promise<SubjectRequirement[]> {
  const { data } = await api.get<SubjectRequirement[]>(
    "/subject-requirements",
    { params: { school_id: schoolId, include_grouped: includeGrouped } },
  );
  return data;
}

export async function createRequirement(
  payload: Omit<SubjectRequirement, "id">,
): Promise<SubjectRequirement> {
  const { data } = await api.post<SubjectRequirement>(
    "/subject-requirements",
    payload,
  );
  return data;
}

export async function updateRequirement(
  id: number,
  payload: Partial<SubjectRequirement>,
): Promise<SubjectRequirement> {
  const { data } = await api.put<SubjectRequirement>(
    `/subject-requirements/${id}`,
    payload,
  );
  return data;
}

export async function deleteRequirement(id: number): Promise<void> {
  await api.delete(`/subject-requirements/${id}`);
}

// ─── Available Slots (for pin grid) ──────────────────────
export interface SlotStatus {
  day: string;
  period: number;
  status: "available" | "teacher_blocked" | "class_conflict" | "teacher_conflict";
}

export async function fetchAvailableSlots(
  reqId: number,
): Promise<SlotStatus[]> {
  const { data } = await api.get<SlotStatus[]>(
    `/subject-requirements/${reqId}/available-slots`,
  );
  return data;
}

// ─── Filtered Requirements ───────────────────────────────
export async function fetchRequirementsFiltered(params: {
  school_id: number;
  subject_id?: number;
  teacher_id?: number;
  grade_id?: number;
  class_group_id?: number;
}): Promise<SubjectRequirement[]> {
  const { data } = await api.get<SubjectRequirement[]>(
    "/subject-requirements",
    { params },
  );
  return data;
}
