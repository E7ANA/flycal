import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  ToggleRight,
  SlidersHorizontal,
  ArrowLeftRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchConstraints } from "@/api/constraints";
import { fetchSolutions } from "@/api/solver";
import {
  scenarioToggle,
  scenarioWeight,
  scenarioType as runScenarioTypeChange,
  compareSolutions,
} from "@/api/scenarios";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/common/Card";
import { Select } from "@/components/common/Select";
import { Input } from "@/components/common/Input";
import { Label } from "@/components/common/Label";
import { RULE_TYPE_LABELS } from "@/lib/constraints";
import type { RuleType } from "@/types/models";

export default function ScenariosPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  // Scenario state
  const [selectedConstraintId, setSelectedConstraintId] = useState<number | "">(
    "",
  );
  const [scenarioType, setScenarioType] = useState<
    "toggle" | "weight" | "type"
  >("toggle");
  const [newWeight, setNewWeight] = useState(50);
  const [newConstraintType, setNewConstraintType] = useState("SOFT");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioResult, setScenarioResult] = useState<{
    status: string;
    message: string;
    solve_time: number;
    solutions: { id: number; total_score: number }[];
    change: string;
  } | null>(null);

  // Compare state
  const [compareA, setCompareA] = useState<number | "">("");
  const [compareB, setCompareB] = useState<number | "">("");
  const [compareResult, setCompareResult] = useState<Awaited<
    ReturnType<typeof compareSolutions>
  > | null>(null);

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  const { data: solutions = [] } = useQuery({
    queryKey: ["solutions", schoolId],
    queryFn: () => fetchSolutions(schoolId!),
    enabled: !!schoolId,
  });

  const selectedConstraint = constraints.find(
    (c) => c.id === selectedConstraintId,
  );

  const runMut = useMutation({
    mutationFn: async () => {
      if (!schoolId || selectedConstraintId === "") return;
      const name = scenarioName || "תרחיש";
      if (scenarioType === "toggle") {
        return scenarioToggle({
          school_id: schoolId,
          constraint_id: selectedConstraintId as number,
          new_active: !selectedConstraint?.is_active,
          scenario_name: name,
        });
      } else if (scenarioType === "weight") {
        return scenarioWeight({
          school_id: schoolId,
          constraint_id: selectedConstraintId as number,
          new_weight: newWeight,
          scenario_name: name,
        });
      } else {
        return runScenarioTypeChange({
          school_id: schoolId,
          constraint_id: selectedConstraintId as number,
          new_type: newConstraintType,
          scenario_name: name,
        });
      }
    },
    onSuccess: (data) => {
      if (data) {
        setScenarioResult(data);
        qc.invalidateQueries({ queryKey: ["solutions", schoolId] });
        toast.success("תרחיש הורץ בהצלחה");
      }
    },
    onError: () => toast.error("שגיאה בהרצת תרחיש"),
  });

  const compareMut = useMutation({
    mutationFn: () => compareSolutions(compareA as number, compareB as number),
    onSuccess: (data) => {
      setCompareResult(data);
    },
    onError: () => toast.error("שגיאה בהשוואה"),
  });

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold">תרחישים (What-If)</h2>

      {/* Run Scenario */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            הרצת תרחיש
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>אילוץ</Label>
            <Select
              value={selectedConstraintId}
              onChange={(e) =>
                setSelectedConstraintId(
                  e.target.value ? Number(e.target.value) : "",
                )
              }
            >
              <option value="">בחר אילוץ</option>
              {constraints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type === "HARD" ? "חובה" : "רך"}) —{" "}
                  {RULE_TYPE_LABELS[c.rule_type as RuleType] ?? c.rule_type}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex gap-2">
            {(
              [
                ["toggle", "הפעל/השבת", ToggleRight],
                ["weight", "שנה משקל", SlidersHorizontal],
                ["type", "שנה סוג", ArrowLeftRight],
              ] as const
            ).map(([type, label, Icon]) => (
              <button
                key={type}
                onClick={() => setScenarioType(type)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-colors cursor-pointer ${
                  scenarioType === type
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {scenarioType === "weight" && (
            <div>
              <Label>משקל חדש ({newWeight})</Label>
              <input
                type="range"
                min={1}
                max={100}
                value={newWeight}
                onChange={(e) => setNewWeight(Number(e.target.value))}
                className="w-full"
              />
            </div>
          )}

          {scenarioType === "type" && (
            <div>
              <Label>סוג חדש</Label>
              <Select
                value={newConstraintType}
                onChange={(e) => setNewConstraintType(e.target.value)}
              >
                <option value="HARD">חובה (HARD)</option>
                <option value="SOFT">רך (SOFT)</option>
              </Select>
            </div>
          )}

          <div>
            <Label>שם תרחיש</Label>
            <Input
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              placeholder="לדוגמה: מה אם נשבית את חסימת יום שישי?"
            />
          </div>

          <Button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending || selectedConstraintId === ""}
            className="w-full"
          >
            {runMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                מריץ תרחיש...
              </>
            ) : (
              <>
                <FlaskConical className="h-4 w-4" />
                הרץ תרחיש
              </>
            )}
          </Button>

          {scenarioResult && (
            <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
              <div className="flex items-center gap-3">
                <Badge
                  variant={
                    scenarioResult.status === "OPTIMAL"
                      ? "success"
                      : scenarioResult.status === "FEASIBLE"
                        ? "warning"
                        : "destructive"
                  }
                >
                  {scenarioResult.status}
                </Badge>
                <span className="text-sm">{scenarioResult.change}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {scenarioResult.message} • {scenarioResult.solve_time}s
              </p>
              {scenarioResult.solutions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <span>ציון: {s.total_score}</span>
                  <span className="text-muted-foreground">
                    (ID: {s.id})
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compare Solutions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            השוואת פתרונות
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>פתרון A</Label>
              <Select
                value={compareA}
                onChange={(e) =>
                  setCompareA(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">בחר פתרון</option>
                {solutions.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.id} — ציון {s.total_score}
                    {s.scenario_name ? ` (${s.scenario_name})` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>פתרון B</Label>
              <Select
                value={compareB}
                onChange={(e) =>
                  setCompareB(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">בחר פתרון</option>
                {solutions.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.id} — ציון {s.total_score}
                    {s.scenario_name ? ` (${s.scenario_name})` : ""}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => compareMut.mutate()}
            disabled={
              compareMut.isPending || compareA === "" || compareB === ""
            }
            className="w-full"
          >
            {compareMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowLeftRight className="h-4 w-4" />
            )}
            השווה
          </Button>

          {compareResult && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg border text-center">
                  <p className="text-xs text-muted-foreground">פתרון A</p>
                  <p className="text-xl font-bold">
                    {compareResult.solution_a.total_score}
                  </p>
                </div>
                <div className="p-3 rounded-lg border text-center">
                  <p className="text-xs text-muted-foreground">פתרון B</p>
                  <p className="text-xl font-bold">
                    {compareResult.solution_b.total_score}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <span className="text-sm">הפרש ציון:</span>
                <Badge
                  variant={
                    compareResult.score_delta > 0
                      ? "success"
                      : compareResult.score_delta < 0
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {compareResult.score_delta > 0 ? (
                    <TrendingUp className="h-3 w-3 me-1" />
                  ) : compareResult.score_delta < 0 ? (
                    <TrendingDown className="h-3 w-3 me-1" />
                  ) : (
                    <Minus className="h-3 w-3 me-1" />
                  )}
                  {compareResult.score_delta > 0 ? "+" : ""}
                  {compareResult.score_delta}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  דמיון: {compareResult.similarity_pct}%
                </span>
              </div>

              <div className="text-sm text-muted-foreground text-center">
                {compareResult.common_lessons} שיעורים משותפים •{" "}
                {compareResult.only_in_a} רק ב-A •{" "}
                {compareResult.only_in_b} רק ב-B
              </div>

              {/* Constraint Diffs */}
              {compareResult.constraint_diffs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">הבדלים באילוצים:</p>
                  {compareResult.constraint_diffs.map((d) => (
                    <div
                      key={d.constraint_id}
                      className="flex items-center gap-3 text-sm p-2 rounded border"
                    >
                      <span className="flex-1 truncate">{d.name}</span>
                      <span className="text-muted-foreground">
                        {Math.round(d.satisfaction_a * 100)}%
                      </span>
                      <span>→</span>
                      <span className="text-muted-foreground">
                        {Math.round(d.satisfaction_b * 100)}%
                      </span>
                      <Badge
                        variant={
                          d.delta > 0
                            ? "success"
                            : d.delta < 0
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {d.delta > 0 ? "+" : ""}
                        {Math.round(d.delta * 100)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
