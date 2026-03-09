import api from "./client";
import type { Constraint } from "@/types/models";

export async function fetchConstraints(
  schoolId: number,
): Promise<Constraint[]> {
  const { data } = await api.get<Constraint[]>("/constraints", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function createConstraint(
  payload: Omit<Constraint, "id" | "created_at">,
): Promise<Constraint> {
  const { data } = await api.post<Constraint>("/constraints", payload);
  return data;
}

export async function updateConstraint(
  id: number,
  payload: Partial<Constraint>,
): Promise<Constraint> {
  const { data } = await api.put<Constraint>(`/constraints/${id}`, payload);
  return data;
}

export async function deleteConstraint(id: number): Promise<void> {
  await api.delete(`/constraints/${id}`);
}

export async function toggleConstraint(
  id: number,
  isActive: boolean,
): Promise<Constraint> {
  const { data } = await api.patch<Constraint>(`/constraints/${id}/toggle`, {
    is_active: isActive,
  });
  return data;
}

export async function updateConstraintWeight(
  id: number,
  weight: number,
): Promise<Constraint> {
  const { data } = await api.patch<Constraint>(`/constraints/${id}/weight`, {
    weight,
  });
  return data;
}

export interface ConstraintTemplate {
  index: number;
  name: string;
  rule_type: string;
  category: string;
  default_type: string;
  default_weight: number | null;
  default_params: Record<string, unknown>;
}

export async function fetchTemplates(): Promise<ConstraintTemplate[]> {
  const { data } = await api.get<ConstraintTemplate[]>(
    "/constraints/templates",
  );
  return data;
}

export async function createFromTemplate(
  index: number,
  schoolId: number,
  targetId: number | null,
): Promise<Constraint> {
  const { data } = await api.post<Constraint>(
    `/constraints/from-template/${index}`,
    null,
    { params: { school_id: schoolId, target_id: targetId } },
  );
  return data;
}
