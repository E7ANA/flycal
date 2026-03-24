import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Calendar, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchGrades, createGrade, updateGrade, deleteGrade } from "@/api/grades";
import { fetchClasses, createClass, updateClass, deleteClass } from "@/api/classes";
import { fetchRequirements } from "@/api/subjects";
import { fetchGroupingClusters } from "@/api/groupings";
import { fetchConstraints, createConstraint, updateConstraint, deleteConstraint } from "@/api/constraints";
import { computeAllClassHours } from "@/lib/classHours";
import { Button } from "@/components/common/Button";
import { DataTable } from "@/components/common/DataTable";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Label } from "@/components/common/Label";
import { Badge } from "@/components/common/Badge";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";
import type { Grade, ClassGroup, Constraint } from "@/types/models";

// ─── End-of-Day Constraint Dialog (CLASS_END_TIME) ───────
// Matches the existing ConstraintsPage form exactly.
function EndOfDayConstraintDialog({
  open,
  onClose,
  constraint,
  schoolId,
  allClasses,
  preselectedClassIds,
}: {
  open: boolean;
  onClose: () => void;
  constraint: Constraint | null;
  schoolId: number;
  allClasses: ClassGroup[];
  preselectedClassIds: number[];
}) {
  const qc = useQueryClient();
  const params = constraint?.parameters ?? {};

  const [name, setName] = useState("");
  const [type, setType] = useState<"HARD" | "SOFT">("HARD");
  const [weight, setWeight] = useState(80);
  const [days, setDays] = useState<string[]>([]);
  const [allowedPeriods, setAllowedPeriods] = useState<number[]>([]);
  const [targetClassIds, setTargetClassIds] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    if (constraint) {
      setName(constraint.name ?? "");
      setType((constraint.type as "HARD" | "SOFT") ?? "HARD");
      setWeight(constraint.weight ?? 80);
      setDays((params.days as string[]) ?? [...DAYS_ORDER]);
      // Support both allowed_periods and legacy min/max
      const ap = params.allowed_periods as number[] | undefined;
      if (ap) {
        setAllowedPeriods(ap);
      } else {
        const mn = params.min_period as number | undefined;
        const mx = params.max_period as number | undefined;
        if (mn != null && mx != null) {
          setAllowedPeriods(Array.from({ length: mx - mn + 1 }, (_, i) => mn + i));
        } else {
          setAllowedPeriods([6, 7, 8]);
        }
      }
      const tids = params.target_class_ids as number[] | undefined;
      setTargetClassIds(tids ?? preselectedClassIds);
    } else {
      setName("");
      setType("HARD");
      setWeight(80);
      setDays([...DAYS_ORDER]);
      setAllowedPeriods([6, 7, 8]);
      setTargetClassIds(preselectedClassIds);
    }
  }, [open, constraint, preselectedClassIds]);

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const togglePeriod = (p: number) =>
    setAllowedPeriods((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b)));

  const toggleClass = (id: number) =>
    setTargetClassIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () =>
    setTargetClassIds((prev) => (prev.length === allClasses.length ? [] : allClasses.map((c) => c.id)));

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: schoolId,
        name: name || "אילוץ סוף יום",
        description: null,
        category: "CLASS" as const,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: "CLASS_END_TIME" as const,
        parameters: {
          days,
          allowed_periods: allowedPeriods,
          target_class_ids: targetClassIds.length === 0 || targetClassIds.length === allClasses.length ? [] : targetClassIds,
        },
        target_type: "ALL" as const,
        target_id: null,
        is_active: true,
        notes: null,
      };
      if (constraint) {
        await updateConstraint(constraint.id, payload);
      } else {
        await createConstraint(payload as Omit<Constraint, "id" | "created_at">);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ סוף יום נשמר");
      onClose();
    },
    onError: () => toast.error("שגיאה בשמירה"),
  });

  const removeMut = useMutation({
    mutationFn: () => deleteConstraint(constraint!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ הוסר");
      onClose();
    },
  });

  const allSelected = targetClassIds.length === 0 || targetClassIds.length === allClasses.length;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>אילוץ סוף יום</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>שם (אופציונלי)</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="הסעות רביעי ח ט" />
        </div>

        <div>
          <Label>סוג</Label>
          <Select value={type} onChange={(e) => setType(e.target.value as "HARD" | "SOFT")}>
            <option value="HARD">חובה (HARD)</option>
            <option value="SOFT">רך (SOFT)</option>
          </Select>
        </div>

        {type === "SOFT" && (
          <div>
            <Label>משקל ({weight})</Label>
            <input type="range" min={1} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full" />
          </div>
        )}

        <div>
          <Label>ימים</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {DAYS_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors ${
                  days.includes(d)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>שעות סיום אפשריות</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePeriod(p)}
                className={`w-9 h-9 text-sm rounded border cursor-pointer transition-colors ${
                  allowedPeriods.includes(p)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">בחר את השעות שבהן מותר לסיים את היום</p>
        </div>

        <div>
          <Label>כיתות</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <button
              type="button"
              onClick={toggleAll}
              className={`px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors ${
                allSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              כולן
            </button>
            {allClasses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleClass(c.id)}
                className={`px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors ${
                  allSelected || targetClassIds.includes(c.id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">ריק = כל הכיתות</p>
        </div>

        <DialogFooter>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || days.length === 0 || allowedPeriods.length === 0}>
            {saveMut.isPending ? "שומר..." : constraint ? "עדכן" : "צור"}
          </Button>
          {constraint && (
            <Button variant="destructive" onClick={() => removeMut.mutate()} disabled={removeMut.isPending}>
              הסר
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

// ─── Grade Form ──────────────────────────────────────────
function GradeFormDialog({
  open,
  onClose,
  grade,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  grade: Grade | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(grade?.name ?? "");
  const [level, setLevel] = useState(grade?.level ?? 7);

  const createMut = useMutation({
    mutationFn: () => createGrade({ school_id: schoolId, name, level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grades", schoolId] });
      toast.success("שכבה נוצרה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת שכבה"),
  });

  const updateMut = useMutation({
    mutationFn: () => updateGrade(grade!.id, { name, level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grades", schoolId] });
      toast.success("שכבה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון שכבה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{grade ? "עריכת שכבה" : "שכבה חדשה"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          grade ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="grade-name">שם</Label>
          <Input
            id="grade-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: ז'
            required
          />
        </div>
        <div>
          <Label htmlFor="grade-level">רמה</Label>
          <Input
            id="grade-level"
            type="number"
            min={1}
            max={12}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            required
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : grade ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Class Form ──────────────────────────────────────────
function ClassFormDialog({
  open,
  onClose,
  classGroup,
  grades,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  classGroup: ClassGroup | null;
  grades: Grade[];
  schoolId: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(classGroup?.name ?? "");
  const [gradeId, setGradeId] = useState(classGroup?.grade_id ?? (grades[0]?.id ?? 0));
  const [homeroomDailyRequired, setHomeroomDailyRequired] = useState(
    classGroup?.homeroom_daily_required ?? false,
  );

  const createMut = useMutation({
    mutationFn: () =>
      createClass({
        school_id: schoolId,
        name,
        grade_id: gradeId,
        homeroom_daily_required: homeroomDailyRequired,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes", schoolId] });
      toast.success("כיתה נוצרה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת כיתה"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateClass(classGroup!.id, {
        name,
        grade_id: gradeId,
        homeroom_daily_required: homeroomDailyRequired,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes", schoolId] });
      toast.success("כיתה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון כיתה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{classGroup ? "עריכת כיתה" : "כיתה חדשה"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          classGroup ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="class-name">שם</Label>
          <Input
            id="class-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: ט1'
            required
          />
        </div>
        <div>
          <Label htmlFor="class-grade">שכבה</Label>
          <Select
            id="class-grade"
            value={gradeId}
            onChange={(e) => setGradeId(Number(e.target.value))}
            required
          >
            <option value="">בחר שכבה</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={homeroomDailyRequired}
            onChange={(e) => setHomeroomDailyRequired(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm">מחנכת חייבת לפגוש כיתה כל יום</span>
        </label>
        <p className="text-xs text-muted-foreground -mt-2">
          כשמסומן — המחנכת חייבת ללמד בכיתה בכל יום שהיא בבית הספר (אילוץ קשיח).
          כשלא מסומן — מועדף אך לא מחייב.
          שיעור <strong>כינוס</strong> אינו נחשב כמפגש עם הכיתה לצורך כלל זה.
        </p>

        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : classGroup ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function ClassesPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Dialog state
  const [gradeDialogOpen, setGradeDialogOpen] = useState(false);
  const [editingGrade, setEditingGrade] = useState<Grade | null>(null);
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "grade" | "class"; id: number; name: string } | null>(null);
  // End-of-day constraint dialog
  const [eodOpen, setEodOpen] = useState(false);
  const [eodPreselected, setEodPreselected] = useState<number[]>([]);
  const [eodConstraint, setEodConstraint] = useState<Constraint | null>(null);

  const { data: grades = [] } = useQuery({
    queryKey: ["grades", schoolId],
    queryFn: () => fetchGrades(schoolId!),
    enabled: !!schoolId,
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId!),
    enabled: !!schoolId,
  });

  const { data: allRequirements = [] } = useQuery({
    queryKey: ["requirements", schoolId, true],
    queryFn: () => fetchRequirements(schoolId!, true),
    enabled: !!schoolId,
  });

  const { data: clusters = [] } = useQuery({
    queryKey: ["grouping-clusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: !!schoolId,
  });

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  // Find CLASS_END_TIME constraints that apply to a specific class
  const findEodForClass = (classId: number): Constraint | null => {
    for (const c of constraints) {
      if (c.rule_type !== "CLASS_END_TIME" || !c.is_active) continue;
      const tids = (c.parameters?.target_class_ids as number[]) ?? [];
      if (tids.length === 0 || tids.includes(classId)) return c;
    }
    return null;
  };

  const openEodForClass = (classId: number) => {
    setEodConstraint(findEodForClass(classId));
    setEodPreselected([classId]);
    setEodOpen(true);
  };

  const openEodForGrade = (gradeId: number) => {
    const gradeClassIds = classes.filter((c) => c.grade_id === gradeId).map((c) => c.id);
    // Find a constraint that covers these classes
    const existing = constraints.find((c) => {
      if (c.rule_type !== "CLASS_END_TIME" || !c.is_active) return false;
      const tids = (c.parameters?.target_class_ids as number[]) ?? [];
      if (tids.length === 0) return true; // applies to all
      return gradeClassIds.some((id) => tids.includes(id));
    });
    setEodConstraint(existing ?? null);
    setEodPreselected(gradeClassIds);
    setEodOpen(true);
  };

  const classHoursSummary = useMemo(
    () => computeAllClassHours(allRequirements, clusters),
    [allRequirements, clusters],
  );

  const toggleHomeroomMut = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      updateClass(id, { homeroom_daily_required: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes", schoolId] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      deleteTarget!.type === "grade"
        ? deleteGrade(deleteTarget!.id)
        : deleteClass(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [deleteTarget!.type === "grade" ? "grades" : "classes", schoolId] });
      toast.success("נמחק בהצלחה");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  const gradeMap = Object.fromEntries(grades.map((g) => [g.id, g.name]));

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Grades Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">שכבות</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditingGrade(null);
              setGradeDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            שכבה חדשה
          </Button>
        </div>
        <DataTable
          compact
          keyField="id"
          data={grades}
          columns={[
            { header: "שם", accessor: "name" },
            { header: "רמה", accessor: "level" },
            {
              header: "כיתות",
              accessor: (g) => {
                const count = classes.filter((c) => c.grade_id === g.id).length;
                return <Badge variant="secondary">{count}</Badge>;
              },
            },
            {
              header: "פעולות",
              accessor: (g) => (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="אילוץ סוף יום"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEodForGrade(g.id);
                    }}
                  >
                    <Clock className="h-4 w-4 text-amber-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingGrade(g);
                      setGradeDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ type: "grade", id: g.id, name: g.name });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ),
              className: "w-32",
            },
          ]}
          emptyMessage="אין שכבות — הוסף שכבה חדשה"
        />
      </section>

      {/* Classes Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">כיתות</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditingClass(null);
              setClassDialogOpen(true);
            }}
            disabled={grades.length === 0}
          >
            <Plus className="h-4 w-4" />
            כיתה חדשה
          </Button>
        </div>
        <DataTable
          compact
          keyField="id"
          data={classes}
          columns={[
            { header: "שם", accessor: "name" },
            {
              header: "שכבה",
              accessor: (c) => gradeMap[c.grade_id] ?? "—",
            },
            {
              header: "שעות רגילות",
              accessor: (c) => {
                const s = classHoursSummary[c.id];
                return s?.regular || "—";
              },
            },
            {
              header: "שעות הקבצות",
              accessor: (c) => {
                const s = classHoursSummary[c.id];
                return s?.grouped || "—";
              },
            },
            {
              header: "שעות משותפים",
              accessor: (c) => {
                const s = classHoursSummary[c.id];
                return s?.shared || "—";
              },
            },
            {
              header: "סה״כ שעות",
              accessor: (c) => {
                const s = classHoursSummary[c.id];
                return s?.total ? (
                  <Badge variant="secondary" className="font-bold">{s.total}</Badge>
                ) : "—";
              },
            },
            {
              header: "מחנכת יומית",
              accessor: (c) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHomeroomMut.mutate({
                      id: c.id,
                      value: !c.homeroom_daily_required,
                    });
                  }}
                  className="cursor-pointer"
                  title="לחץ להחלפה בין חובה/מועדף"
                >
                  {c.homeroom_daily_required ? (
                    <Badge variant="default" className="text-xs">חובה</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">מועדף</Badge>
                  )}
                </button>
              ),
            },
            {
              header: "פעולות",
              accessor: (c) => (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="אילוץ סוף יום"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEodForClass(c.id);
                    }}
                  >
                    <Clock className="h-4 w-4 text-amber-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="צפה במערכת"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/results?view=class&id=${c.id}`);
                    }}
                  >
                    <Calendar className="h-4 w-4 text-primary" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingClass(c);
                      setClassDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ type: "class", id: c.id, name: c.name });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ),
              className: "w-24",
            },
          ]}
          emptyMessage="אין כיתות — הוסף כיתה חדשה"
        />
      </section>

      {/* Dialogs */}
      {gradeDialogOpen && (
        <GradeFormDialog
          open={gradeDialogOpen}
          onClose={() => setGradeDialogOpen(false)}
          grade={editingGrade}
          schoolId={schoolId}
        />
      )}

      {classDialogOpen && (
        <ClassFormDialog
          open={classDialogOpen}
          onClose={() => setClassDialogOpen(false)}
          classGroup={editingClass}
          grades={grades}
          schoolId={schoolId}
        />
      )}

      {eodOpen && (
        <EndOfDayConstraintDialog
          open={eodOpen}
          onClose={() => setEodOpen(false)}
          constraint={eodConstraint}
          schoolId={schoolId}
          allClasses={classes}
          preselectedClassIds={eodPreselected}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה"
        message={`האם למחוק את "${deleteTarget?.name}"? פעולה זו לא ניתנת לביטול.`}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
