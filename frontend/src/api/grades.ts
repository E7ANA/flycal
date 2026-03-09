import api from "./client";
import type { Grade } from "@/types/models";

export async function fetchGrades(schoolId: number): Promise<Grade[]> {
  const { data } = await api.get<Grade[]>("/grades", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function createGrade(
  payload: Omit<Grade, "id">,
): Promise<Grade> {
  const { data } = await api.post<Grade>("/grades", payload);
  return data;
}

export async function updateGrade(
  id: number,
  payload: Partial<Grade>,
): Promise<Grade> {
  const { data } = await api.put<Grade>(`/grades/${id}`, payload);
  return data;
}

export async function deleteGrade(id: number): Promise<void> {
  await api.delete(`/grades/${id}`);
}
