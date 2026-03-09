import api from "./client";
import type { ClassGroup } from "@/types/models";

export async function fetchClasses(schoolId: number): Promise<ClassGroup[]> {
  const { data } = await api.get<ClassGroup[]>("/classes", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function createClass(
  payload: Omit<ClassGroup, "id">,
): Promise<ClassGroup> {
  const { data } = await api.post<ClassGroup>("/classes", payload);
  return data;
}

export async function updateClass(
  id: number,
  payload: Partial<ClassGroup>,
): Promise<ClassGroup> {
  const { data } = await api.put<ClassGroup>(`/classes/${id}`, payload);
  return data;
}

export async function deleteClass(id: number): Promise<void> {
  await api.delete(`/classes/${id}`);
}
