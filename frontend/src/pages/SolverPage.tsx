import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ShieldCheck,
  Users,
  Undo2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  validateBeforeSolve,
  runSolver,
  detectOverlaps,
  toggleOverlaps,
  clearAllOverlaps,
  type OverlapConflict,
} from "@/api/solver";
import { Button } from "@/components/common/Button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";
import { Input } from "@/components/common/Input";
import { Label } from "@/components/common/Label";
import type { ValidationResult, Solution } from "@/types/models";

export default function SolverPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);

  const [maxTime, setMaxTime] = useState(300);
  const [maxSolutions, setMaxSolutions] = useState(1);
  const [numWorkers, setNumWorkers] = useState(8);

  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [solveResult, setSolveResult] = useState<{
    status: string;
    message: string;
    solve_time: number;
    solutions: Solution[];
  } | null>(null);
  const [elapsedTimer, setElapsedTimer] = useState(0);

  // Overlap conflict state
  const [overlaps, setOverlaps] = useState<OverlapConflict[]>([]);
  const [allowedOverlaps, setAllowedOverlaps] = useState<
    Set<string>
  >(new Set()); // "type:id" keys

  const validateMut = useMutation({
    mutationFn: () => validateBeforeSolve(schoolId!),
    onSuccess: (data) => {
      setValidation(data);
      if (data.valid) {
        toast.success("הנתונים תקינים — מוכן ליצירת מערכת");
      } else {
        toast.error(`נמצאו ${data.errors.length} שגיאות`);
      }
    },
    onError: () => toast.error("שגיאה בבדיקת תקינות"),
  });

  const solveMut = useMutation({
    mutationFn: async () => {
      const start = Date.now();
      const interval = setInterval(
        () => setElapsedTimer(Math.round((Date.now() - start) / 1000)),
        1000,
      );
      try {
        const result = await runSolver({
          school_id: schoolId!,
          max_time: maxTime,
          max_solutions: maxSolutions,
          num_workers: numWorkers,
        });
        return result;
      } finally {
        clearInterval(interval);
      }
    },
    onSuccess: async (result) => {
      setSolveResult(result);
      if (result.status === "OPTIMAL" || result.status === "FEASIBLE") {
        toast.success(
          `נמצאו ${result.solutions.length} פתרונות ב-${result.solve_time} שניות`,
        );
      } else if (result.status === "INFEASIBLE") {
        // Auto-detect overlaps
        try {
          const detected = await detectOverlaps(schoolId!);
          setOverlaps(detected);
          if (detected.length > 0) {
            toast.error(
              `לא ניתן לפתור — נמצאו ${detected.length} חפיפות מורים`,
            );
          } else {
            toast.error(result.message);
          }
        } catch {
          toast.error(result.message);
        }
      } else {
        toast.error(result.message);
      }
    },
    onError: (err) => {
      toast.error(`שגיאה ביצירת מערכת: ${String(err)}`);
    },
  });

  const handleAllowOverlap = async (conflict: OverlapConflict) => {
    try {
      await toggleOverlaps(
        conflict.items.map((item) => ({ type: item.type, id: item.id })),
        true,
      );
      const newAllowed = new Set(allowedOverlaps);
      for (const item of conflict.items) {
        newAllowed.add(`${item.type}:${item.id}`);
      }
      setAllowedOverlaps(newAllowed);
      toast.success(`חפיפה אושרה עבור ${conflict.teacher_name}`);
    } catch {
      toast.error("שגיאה באישור חפיפה");
    }
  };

  const handleClearOverlaps = async () => {
    try {
      const res = await clearAllOverlaps(schoolId!);
      setAllowedOverlaps(new Set());
      setOverlaps([]);
      toast.success(`נוקו ${res.cleared} אישורי חפיפה`);
    } catch {
      toast.error("שגיאה בניקוי חפיפות");
    }
  };

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold">יצירת מערכת</h2>

      {/* Step 1: Validate */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            שלב 1: בדיקת תקינות
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            בדוק שכל הנתונים תקינים ואין סתירות לפני יצירת המערכת.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => validateMut.mutate()}
              disabled={validateMut.isPending}
              variant="outline"
            >
              {validateMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              בדוק תקינות
            </Button>
            <Button
              onClick={async () => {
                try {
                  const detected = await detectOverlaps(schoolId!);
                  setOverlaps(detected);
                  if (detected.length > 0) {
                    toast.error(`נמצאו ${detected.length} חפיפות מורים`);
                  } else {
                    toast.success("אין חפיפות מורים");
                  }
                } catch {
                  toast.error("שגיאה בבדיקת חפיפות");
                }
              }}
              variant="outline"
            >
              <Users className="h-4 w-4" />
              בדוק חפיפות
            </Button>
          </div>

          {validation && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span>כיתות: {validation.summary.classes}</span>
                <span>דרישות: {validation.summary.requirements}</span>
                <span>משבצות: {validation.summary.available_slots}</span>
                <span>הקבצות: {validation.summary.clusters}</span>
              </div>

              {validation.valid ? (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-md">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">הנתונים תקינים</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-700 bg-red-50 p-3 rounded-md">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">
                    נמצאו {validation.errors.length} שגיאות
                  </span>
                </div>
              )}

              {validation.errors.length > 0 && (
                <div className="space-y-1">
                  {validation.errors.map((e, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-sm text-red-700 bg-red-50 p-2 rounded"
                    >
                      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{e.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {validation.warnings.length > 0 && (
                <div className="space-y-1">
                  {validation.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-sm text-yellow-700 bg-yellow-50 p-2 rounded"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Overlap conflicts detected proactively (before solving) */}
          {!solveResult && overlaps.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-amber-800 bg-amber-50 p-3 rounded-md border border-amber-200">
                <Users className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">
                    נמצאו {overlaps.length} חפיפות מורים
                  </p>
                  <p className="text-xs mt-0.5">
                    מורים המשובצים ליותר שעות ממה שזמין להם.
                    אפשר חפיפה כדי לאפשר שיבוץ במקביל.
                  </p>
                </div>
              </div>

              {overlaps.map((conflict) => {
                const isAllowed = conflict.items.every((item) =>
                  allowedOverlaps.has(`${item.type}:${item.id}`),
                );
                return (
                  <div
                    key={conflict.teacher_id}
                    className={`rounded-md border p-3 space-y-2 ${
                      isAllowed
                        ? "bg-green-50 border-green-200"
                        : "bg-red-50 border-red-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">
                        {conflict.teacher_name}
                      </span>
                      {isAllowed ? (
                        <Badge variant="success">חפיפה מאושרת</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-400 text-amber-700 hover:bg-amber-100"
                          onClick={() => handleAllowOverlap(conflict)}
                        >
                          <Users className="h-3 w-3" />
                          אפשר חפיפה
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {conflict.message}
                    </p>
                    <div className="space-y-1">
                      {conflict.items.map((item) => (
                        <div
                          key={`${item.type}-${item.id}`}
                          className="text-xs px-2 py-1 rounded bg-white/60"
                        >
                          {item.type === "track" ? "רמה" : item.type === "meeting" ? "ישיבה" : "דרישה"}:{" "}
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Create Timetable */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            שלב 2: יצירת מערכת
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="max-time">זמן מקסימלי (שניות)</Label>
              <Input
                id="max-time"
                type="number"
                min={10}
                max={600}
                value={maxTime}
                onChange={(e) => setMaxTime(Number(e.target.value))}
                disabled={solveMut.isPending}
              />
            </div>
            <div>
              <Label htmlFor="max-solutions">מקסימום פתרונות</Label>
              <Input
                id="max-solutions"
                type="number"
                min={1}
                max={20}
                value={maxSolutions}
                onChange={(e) => setMaxSolutions(Number(e.target.value))}
                disabled={solveMut.isPending}
              />
            </div>
            <div>
              <Label htmlFor="num-workers">ליבות מעבד</Label>
              <Input
                id="num-workers"
                type="number"
                min={1}
                max={16}
                value={numWorkers}
                onChange={(e) => setNumWorkers(Number(e.target.value))}
                disabled={solveMut.isPending}
              />
            </div>
          </div>

          {/* Active overlaps indicator */}
          {allowedOverlaps.size > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-amber-50 border border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-sm text-amber-800 flex-1">
                {allowedOverlaps.size} פריטים עם חפיפת מורה מאושרת (זמני)
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearOverlaps}
              >
                <Undo2 className="h-3 w-3" />
                נקה הכל
              </Button>
            </div>
          )}

          <Button
            onClick={() => {
              setSolveResult(null);
              setOverlaps([]);
              setElapsedTimer(0);
              solveMut.mutate();
            }}
            disabled={solveMut.isPending}
            className="w-full"
            size="lg"
          >
            {solveMut.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Play className="h-5 w-5" />
            )}
            {solveMut.isPending ? "יוצר מערכת..." : "צור מערכת"}
          </Button>

          {/* Loading indicator */}
          {solveMut.isPending && (
            <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-muted/50 border">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-medium">המערכת נבנית...</p>
              <p className="text-sm text-muted-foreground">
                {elapsedTimer > 0 && `${elapsedTimer} שניות`}
                {elapsedTimer > 0 && ` מתוך ${maxTime} מקסימום`}
              </p>
              <p className="text-xs text-muted-foreground">
                תהליך זה יכול להימשך עד {maxTime} שניות. אין לסגור את הדף.
              </p>
            </div>
          )}

          {/* Results */}
          {solveResult && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center gap-3">
                {solveResult.status === "OPTIMAL" ||
                solveResult.status === "FEASIBLE" ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                <Badge
                  variant={
                    solveResult.status === "OPTIMAL"
                      ? "success"
                      : solveResult.status === "FEASIBLE"
                        ? "warning"
                        : "destructive"
                  }
                >
                  {solveResult.status === "OPTIMAL"
                    ? "אופטימלי"
                    : solveResult.status === "FEASIBLE"
                      ? "נמצא פתרון"
                      : solveResult.status === "INFEASIBLE"
                        ? "לא ניתן לפתור"
                        : "חריגת זמן"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {solveResult.solve_time} שניות
                </span>
              </div>

              <p className="text-sm">{solveResult.message}</p>

              {/* Overlap conflicts when INFEASIBLE */}
              {solveResult.status === "INFEASIBLE" &&
                overlaps.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-800 bg-amber-50 p-3 rounded-md border border-amber-200">
                      <Users className="h-5 w-5 shrink-0" />
                      <div>
                        <p className="font-medium">
                          נמצאו {overlaps.length} חפיפות מורים
                        </p>
                        <p className="text-xs mt-0.5">
                          מורים המשובצים ליותר שעות ממה שזמין להם.
                          אפשר חפיפה כדי לאפשר שיבוץ במקביל, ואז הרץ שוב.
                        </p>
                      </div>
                    </div>

                    {overlaps.map((conflict) => {
                      const isAllowed = conflict.items.every((item) =>
                        allowedOverlaps.has(`${item.type}:${item.id}`),
                      );
                      return (
                        <div
                          key={conflict.teacher_id}
                          className={`rounded-md border p-3 space-y-2 ${
                            isAllowed
                              ? "bg-green-50 border-green-200"
                              : "bg-red-50 border-red-200"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">
                              {conflict.teacher_name}
                            </span>
                            {isAllowed ? (
                              <Badge variant="success">חפיפה מאושרת</Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-amber-400 text-amber-700 hover:bg-amber-100"
                                onClick={() => handleAllowOverlap(conflict)}
                              >
                                <Users className="h-3 w-3" />
                                אפשר חפיפה
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {conflict.message}
                          </p>
                          <div className="space-y-1">
                            {conflict.items.map((item) => (
                              <div
                                key={`${item.type}-${item.id}`}
                                className="text-xs px-2 py-1 rounded bg-white/60"
                              >
                                {item.type === "track" ? "רמה" : item.type === "meeting" ? "ישיבה" : "דרישה"}:{" "}
                                {item.label}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {allowedOverlaps.size > 0 && (
                      <Button
                        className="w-full"
                        onClick={() => {
                          setSolveResult(null);
                          setOverlaps([]);
                          setElapsedTimer(0);
                          solveMut.mutate();
                        }}
                        disabled={solveMut.isPending}
                      >
                        <Play className="h-4 w-4" />
                        הרץ שוב עם חפיפות מאושרות
                      </Button>
                    )}
                  </div>
                )}

              {solveResult.solutions.length > 0 && (
                <div className="space-y-2">
                  {solveResult.solutions.map((sol, i) => (
                    <div
                      key={sol.id}
                      className="flex items-center gap-4 p-3 rounded-md border bg-green-50"
                    >
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-sm">
                        פתרון #{i + 1}
                      </span>
                      <Badge variant="outline">ציון: {sol.total_score}</Badge>
                      <span className="text-xs text-muted-foreground me-auto">
                        ID: {sol.id}
                      </span>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() =>
                          window.location.assign(`/results?solution=${sol.id}`)
                        }
                      >
                        צפה בתוצאות
                      </Button>
                    </div>
                  ))}

                  {/* Prompt to clear overlaps after successful solve */}
                  {allowedOverlaps.size > 0 && (
                    <div className="flex items-center gap-3 p-3 rounded-md bg-amber-50 border border-amber-200">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-sm text-amber-800 flex-1">
                        המערכת נוצרה עם חפיפות מאושרות. מומלץ לנקות אחרי סיום.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearOverlaps}
                      >
                        <Undo2 className="h-3 w-3" />
                        נקה חפיפות
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
