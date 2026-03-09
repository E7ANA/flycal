import api from "./client";
import type { School } from "@/types/models";

export async function fetchSchools(): Promise<School[]> {
  const { data } = await api.get<School[]>("/schools");
  return data;
}

export async function fetchSchool(id: number): Promise<School> {
  const { data } = await api.get<School>(`/schools/${id}`);
  return data;
}

export async function createSchool(
  payload: Omit<School, "id">,
): Promise<School> {
  const { data } = await api.post<School>("/schools", payload);
  return data;
}

export async function updateSchool(
  id: number,
  payload: Partial<School>,
): Promise<School> {
  const { data } = await api.put<School>(`/schools/${id}`, payload);
  return data;
}

export async function deleteSchool(id: number): Promise<void> {
  await api.delete(`/schools/${id}`);
}
