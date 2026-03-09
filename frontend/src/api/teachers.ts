import api from "./client";
import type { Teacher } from "@/types/models";

export async function fetchTeachers(schoolId: number): Promise<Teacher[]> {
  const { data } = await api.get<Teacher[]>("/teachers", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function createTeacher(
  payload: Omit<Teacher, "id">,
): Promise<Teacher> {
  const { data } = await api.post<Teacher>("/teachers", payload);
  return data;
}

export async function updateTeacher(
  id: number,
  payload: Partial<Teacher>,
): Promise<Teacher> {
  const { data } = await api.put<Teacher>(`/teachers/${id}`, payload);
  return data;
}

export async function deleteTeacher(id: number): Promise<void> {
  await api.delete(`/teachers/${id}`);
}
