import api from "./client";
import type { AuthUser } from "@/stores/authStore";

export interface UserCreatePayload {
  email: string;
  password: string;
  name: string;
  role: string;
  school_id: number | null;
}

export interface UserUpdatePayload {
  email?: string;
  name?: string;
  role?: string;
  school_id?: number | null;
  is_active?: boolean;
}

export async function fetchUsers(): Promise<AuthUser[]> {
  const { data } = await api.get<AuthUser[]>("/users");
  return data;
}

export async function createUser(payload: UserCreatePayload): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>("/users", payload);
  return data;
}

export async function updateUser(id: number, payload: UserUpdatePayload): Promise<AuthUser> {
  const { data } = await api.put<AuthUser>(`/users/${id}`, payload);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}
