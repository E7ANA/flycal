import api from "./client";

interface ScenarioResult {
  status: string;
  message: string;
  solve_time: number;
  solutions: { id: number; total_score: number }[];
  change: string;
}

interface CompareResult {
  solution_a: { id: number; total_score: number; status: string; scenario_name: string | null };
  solution_b: { id: number; total_score: number; status: string; scenario_name: string | null };
  score_delta: number;
  common_lessons: number;
  only_in_a: number;
  only_in_b: number;
  similarity_pct: number;
  constraint_diffs: {
    constraint_id: number;
    name: string;
    satisfaction_a: number;
    satisfaction_b: number;
    delta: number;
  }[];
}

export async function scenarioToggle(payload: {
  school_id: number;
  constraint_id: number;
  new_active: boolean;
  scenario_name?: string;
  max_time?: number;
}): Promise<ScenarioResult> {
  const { data } = await api.post<ScenarioResult>("/scenarios/toggle", payload);
  return data;
}

export async function scenarioWeight(payload: {
  school_id: number;
  constraint_id: number;
  new_weight: number;
  scenario_name?: string;
  max_time?: number;
}): Promise<ScenarioResult> {
  const { data } = await api.post<ScenarioResult>("/scenarios/weight", payload);
  return data;
}

export async function scenarioType(payload: {
  school_id: number;
  constraint_id: number;
  new_type: string;
  scenario_name?: string;
  max_time?: number;
}): Promise<ScenarioResult> {
  const { data } = await api.post<ScenarioResult>("/scenarios/type", payload);
  return data;
}

export async function compareSolutions(
  solutionIdA: number,
  solutionIdB: number,
): Promise<CompareResult> {
  const { data } = await api.post<CompareResult>("/scenarios/compare", {
    solution_id_a: solutionIdA,
    solution_id_b: solutionIdB,
  });
  return data;
}
