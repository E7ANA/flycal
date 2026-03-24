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

// ─── CLASS_END_TIME inline editor ────────────────────────
// Full editor with days selection + min/max period, inside a dialog
function EndOfDayDialog({
  open,
  onClose,
  constraint,
  schoolId,
  targetType,
  targetId,
  targetName,
}: {
  open: boolean;
  onClose: () => void;
  constraint: Constraint | undefined;
  schoolId: number;
  targetType: "GRADE" | "CLASS";
  targetId: number;
  targetName: string;
}) {
  const qc = useQueryClient();
  const params = constraint?.parameters ?? {};
  const [days, setDays] = useState<string[]>((params.days as string[]) ?? [...DAYS_ORDER]);
  const [minPeriod, setMinPeriod] = useState<number>((params.min_period as number) ?? 6);
  const [maxPeriod, setMaxPeriod] = useState<number>((params.max_period as number) ?? 8);
  const [isHard, setIsHard] = useState(constraint?.type === "HARD" || !constraint);

  useEffect(() => {
    if (constraint) {
      const p = constraint.parameters ?? {};
      setDays((p.days as string[]) ?? [...DAYS_ORDER]);
      setMinPeriod((p.min_period as number) ?? 6);
      setMaxPeriod((p.max_period as number) ?? 8);
      setIsHard(constraint.type === "HARD");
    } else {
      setDays([...DAYS_ORDER]);
      setMinPeriod(6);
      setMaxPeriod(8);
      setIsHard(true);
    }
  }, [constraint, open]);

  const toggleDay = (d: string) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: schoolId,
        name: `אילוץ סוף יום — ${targetName}`,
        category: targetType === "GRADE" ? ("GLOBAL" as const) : ("CLASS" as const),
        type: isHard ? ("HARD" as const) : ("SOFT" as const),
        weight: isHard ? 100 : 80,
        rule_type: "CLASS_END_TIME" as const,
        parameters: { days, min_period: minPeriod, max_period: maxPeriod },
        target_type: targetType,
        target_id: targetId,
        is_active: true,
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
    onError: () => toast.error("שגיאה בשמירת אילוץ"),
  });

  const removeMut = useMutation({
    mutationFn: () => deleteConstraint(constraint!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ סוף יום הוסר");
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>אילוץ סוף יום — {targetName}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>ימים</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {DAYS_ORDER.map((d) => {
              const selected = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                  onClick={() => toggleDay(d)}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="eod-min">משעה (מינימום)</Label>
            <Input
              id="eod-min"
              type="number"
              min={1}
              max={10}
              value={minPeriod}
              onChange={(e) => setMinPeriod(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="eod-max">עד שעה (מקסימום)</Label>
            <Input
              id="eod-max"
              type="number"
              min={1}
              max={10}
              value={maxPeriod}
              onChange={(e) => setMaxPeriod(Number(e.target.value))}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          הכיתה תסיים את הלימודים בין שעה {minPeriod} לשעה {maxPeriod} בימים הנבחרים.
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isHard}
            onChange={(e) => setIsHard(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm">אילוץ קשיח (חובה)</span>
        </label>

        <DialogFooter>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || days.length === 0}>
            {saveMut.isPending ? "שומר..." : "שמור"}
          </Button>
          {constraint && (
            <Button
              variant="destructive"
              onClick={() => removeMut.mutate()}
              disabled={removeMut.isPending}
            >
              הסר אילוץ
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

// Badge display for end-of-day constraint in the table
function EndOfDayBadge({
  constraint,
  inheritedConstraint,
  onClick,
}: {
  constraint: Constraint | undefined;
  inheritedConstraint?: Constraint;
  onClick: () => void;
}) {
  if (constraint) {
    const p = constraint.parameters ?? {};
    return (
      <button type="button" onClick={onClick} className="cursor-pointer" title="לחץ לעריכה">
        <Badge variant="default" className="text-xs">
          {p.min_period}–{p.max_period}
        </Badge>
      </button>
    );
  }
  if (inheritedConstraint) {
    const p = inheritedConstraint.parameters ?? {};
    return (
      <button type="button" onClick={onClick} className="cursor-pointer" title="ירושה משכבה — לחץ ל-override">
        <Badge variant="outline" className="text-xs opacity-60">
          {p.min_period}–{p.max_period} (שכבה)
        </Badge>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer text-muted-foreground hover:text-foreground"
      title="הוסף אילוץ סוף יום"
    >
      <Clock className="h-4 w-4" />
    </button>
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

  // End-of-day dialog state
  const [eodDialog, setEodDialog] = useState<{
    targetType: "GRADE" | "CLASS";
    targetId: number;
    targetName: string;
  } | null>(null);

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

  const classHoursSummary = useMemo(
    () => computeAllClassHours(allRequirements, clusters),
    [allRequirements, clusters],
  );

  // Build end-of-day constraint lookups (CLASS_END_TIME)
  const endOfDayConstraints = useMemo(() => {
    const byGrade: Record<number, Constraint> = {};
    const byClass: Record<number, Constraint> = {};
    for (const c of constraints) {
      if (c.rule_type !== "CLASS_END_TIME") continue;
      if (!c.is_active) continue;
      if (c.target_type === "GRADE" && c.target_id) {
        byGrade[c.target_id] = c;
      } else if (c.target_type === "CLASS" && c.target_id) {
        byClass[c.target_id] = c;
      }
    }
    return { byGrade, byClass };
  }, [constraints]);

  // Find constraint for the current eodDialog target
  const eodConstraint = eodDialog
    ? eodDialog.targetType === "GRADE"
      ? endOfDayConstraints.byGrade[eodDialog.targetId]
      : endOfDayConstraints.byClass[eodDialog.targetId]
    : undefined;

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
              header: "סוף יום",
              accessor: (g) => (
                <EndOfDayBadge
                  constraint={endOfDayConstraints.byGrade[g.id]}
                  onClick={() => setEodDialog({ targetType: "GRADE", targetId: g.id, targetName: `שכבה ${g.name}` })}
                />
              ),
            },
            {
              header: "פעולות",
              accessor: (g) => (
                <div className="flex gap-1">
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
              className: "w-24",
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
              accessor: (c) => classHoursSummary[c.id]?.regular || "—",
            },
            {
              header: "שעות הקבצות",
              accessor: (c) => classHoursSummary[c.id]?.grouped || "—",
            },
            {
              header: "שעות משותפים",
              accessor: (c) => classHoursSummary[c.id]?.shared || "—",
            },
            {
              header: "סה״כ",
              accessor: (c) => {
                const s = classHoursSummary[c.id];
                return s?.total ? (
                  <Badge variant="secondary" className="font-bold">{s.total}</Badge>
                ) : "—";
              },
            },
            {
              header: "סוף יום",
              accessor: (c) => (
                <EndOfDayBadge
                  constraint={endOfDayConstraints.byClass[c.id]}
                  inheritedConstraint={endOfDayConstraints.byGrade[c.grade_id]}
                  onClick={() => setEodDialog({ targetType: "CLASS", targetId: c.id, targetName: c.name })}
                />
              ),
            },
            {
              header: "מחנכת",
              accessor: (c) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHomeroomMut.mutate({ id: c.id, value: !c.homeroom_daily_required });
                  }}
                  className="cursor-pointer"
                  title="לחץ להחלפה"
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
                  <Button variant="ghost" size="icon" title="מערכת"
                    onClick={(e) => { e.stopPropagation(); navigate(`/results?view=class&id=${c.id}`); }}>
                    <Calendar className="h-4 w-4 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon"
                    onClick={(e) => { e.stopPropagation(); setEditingClass(c); setClassDialogOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: "class", id: c.id, name: c.name }); }}>
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

      {eodDialog && (
        <EndOfDayDialog
          open={!!eodDialog}
          onClose={() => setEodDialog(null)}
          constraint={eodConstraint}
          schoolId={schoolId}
          targetType={eodDialog.targetType}
          targetId={eodDialog.targetId}
          targetName={eodDialog.targetName}
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
