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

// ─── Edit Scenario ────────────────────────────────────────
export interface EditAction {
  type: "PIN_LESSON" | "BLOCK_TEACHER_SLOT" | "PIN_TEACHER_DAY_CONSECUTIVE";
  params: Record<string, unknown>;
}

export interface EditScenarioResult {
  status: string;
  message: string;
  solve_time: number;
  solutions: { id: number; total_score: number }[];
  edits_applied: number;
  comparison: CompareResult | null;
}

export async function scenarioEdit(payload: {
  school_id: number;
  baseline_solution_id: number;
  edits: EditAction[];
  scenario_name?: string;
  max_time?: number;
  deviation_weight?: number;
}): Promise<EditScenarioResult> {
  const timeout = ((payload.max_time ?? 300) + 60) * 1000;
  const { data } = await api.post<EditScenarioResult>("/scenarios/edit", payload, { timeout });
  return data;
}

export interface SmartEditResult extends EditScenarioResult {
  parsed_edits: EditAction[];
  ai_description: string;
}

export async function scenarioSmartEdit(payload: {
  school_id: number;
  baseline_solution_id: number;
  prompt: string;
  max_time?: number;
  deviation_weight?: number;
}): Promise<SmartEditResult> {
  const timeout = ((payload.max_time ?? 300) + 120) * 1000; // extra time for AI parsing
  const { data } = await api.post<SmartEditResult>("/scenarios/smart-edit", payload, { timeout });
  return data;
}

export async function parseEditOnly(payload: {
  school_id: number;
  baseline_solution_id: number;
  prompt: string;
}): Promise<{ edits: EditAction[]; description: string }> {
  const { data } = await api.post<{ edits: EditAction[]; description: string }>(
    "/scenarios/parse-edit",
    payload,
  );
  return data;
}

// ─── Streaming Smart Edit ─────────────────────────────────

export interface StreamEvent {
  step: string;
  message: string;
  edits?: EditAction[];
  description?: string;
  token_usage?: { input_tokens: number; output_tokens: number };
  progress?: number;
  result?: SmartEditResult;
}

export async function scenarioSmartEditStream(
  payload: {
    school_id: number;
    baseline_solution_id: number;
    prompt: string;
    max_time?: number;
    deviation_weight?: number;
    conversation?: { role: string; content: string }[];
  },
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetch("/api/scenarios/smart-edit-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "שגיאה");
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event = JSON.parse(line.slice(6));
          onEvent(event);
        } catch {
          // ignore malformed events
        }
      }
    }
  }
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
