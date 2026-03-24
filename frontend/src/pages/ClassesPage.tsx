import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchGrades, createGrade, updateGrade, deleteGrade } from "@/api/grades";
import { fetchClasses, createClass, updateClass, deleteClass } from "@/api/classes";
import { fetchRequirements } from "@/api/subjects";
import { fetchGroupingClusters } from "@/api/groupings";
import { fetchConstraints, createConstraint, updateConstraint, deleteConstraint } from "@/api/constraints";
import { computeAllClassHours } from "@/lib/classHours";
import { Button } from "@/components/common/Button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Label } from "@/components/common/Label";
import { Badge } from "@/components/common/Badge";
import { DAY_LABELS_SHORT, DAYS_ORDER } from "@/lib/constraints";
import type { Grade, ClassGroup, Constraint } from "@/types/models";

const MAX_PERIOD = 10;

// ─── End-of-Day Grid ─────────────────────────────────────
// Per-day allowed periods grid for a single class
function EndOfDayGrid({
  classId,
  className: clsName,
  schoolId,
  constraint,
  schoolDays,
}: {
  classId: number;
  className: string;
  schoolId: number;
  constraint: Constraint | undefined;
  schoolDays: string[];
}) {
  const qc = useQueryClient();

  // per_day_periods: { "SUNDAY": [6,7,8], "WEDNESDAY": [6], ... }
  const [grid, setGrid] = useState<Record<string, number[]>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (constraint) {
      const pdp = constraint.parameters?.per_day_periods as Record<string, number[]> | undefined;
      if (pdp) {
        setGrid(pdp);
      } else {
        // Legacy format: days + allowed_periods
        const days = (constraint.parameters?.days as string[]) ?? [];
        const ap = (constraint.parameters?.allowed_periods as number[]) ??
          (() => {
            const mn = constraint.parameters?.min_period as number | undefined;
            const mx = constraint.parameters?.max_period as number | undefined;
            if (mn != null && mx != null) return Array.from({ length: mx - mn + 1 }, (_, i) => mn + i);
            return [];
          })();
        const g: Record<string, number[]> = {};
        for (const d of days) g[d] = [...ap];
        setGrid(g);
      }
    } else {
      setGrid({});
    }
    setDirty(false);
  }, [constraint]);

  const toggle = useCallback((day: string, period: number) => {
    setGrid((prev) => {
      const dayPeriods = prev[day] ?? [];
      const next = dayPeriods.includes(period)
        ? dayPeriods.filter((p) => p !== period)
        : [...dayPeriods, period].sort((a, b) => a - b);
      const result = { ...prev };
      if (next.length === 0) {
        delete result[day];
      } else {
        result[day] = next;
      }
      return result;
    });
    setDirty(true);
  }, []);

  const saveMut = useMutation({
    mutationFn: async () => {
      // Clean: remove days with no periods
      const clean: Record<string, number[]> = {};
      for (const [d, ps] of Object.entries(grid)) {
        if (ps.length > 0) clean[d] = ps;
      }

      if (Object.keys(clean).length === 0) {
        // No periods selected — delete constraint if exists
        if (constraint) await deleteConstraint(constraint.id);
        return;
      }

      const payload = {
        school_id: schoolId,
        name: `סוף יום — ${clsName}`,
        description: null,
        category: "CLASS" as const,
        type: "HARD" as const,
        weight: 100,
        rule_type: "CLASS_END_TIME" as const,
        parameters: { per_day_periods: clean },
        target_type: "CLASS" as const,
        target_id: classId,
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
      setDirty(false);
      toast.success("אילוץ סוף יום נשמר");
    },
    onError: () => toast.error("שגיאה בשמירה"),
  });

  const periods = Array.from({ length: MAX_PERIOD }, (_, i) => i + 1);

  return (
    <div className="border rounded-lg p-3 bg-card space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{clsName}</span>
        <div className="flex items-center gap-2">
          {constraint && (
            <span className="text-xs text-muted-foreground">#{constraint.id}</span>
          )}
          {dirty && (
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "שומר..." : "שמור"}
            </Button>
          )}
        </div>
      </div>
      <table className="border-collapse w-full">
        <thead>
          <tr>
            <th className="text-xs text-muted-foreground p-1 w-12">יום</th>
            {periods.map((p) => (
              <th key={p} className="text-xs text-muted-foreground p-0.5 w-8 text-center">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schoolDays.map((day) => (
            <tr key={day}>
              <td className="text-xs font-medium p-1">{DAY_LABELS_SHORT[day]}</td>
              {periods.map((p) => {
                const selected = (grid[day] ?? []).includes(p);
                return (
                  <td key={p} className="p-0.5">
                    <button
                      type="button"
                      onClick={() => toggle(day, p)}
                      className={`w-7 h-7 rounded text-xs transition-colors cursor-pointer ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {selected ? p : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          <Input id="grade-name" value={name} onChange={(e) => setName(e.target.value)} placeholder='לדוגמה: ז' required />
        </div>
        <div>
          <Label htmlFor="grade-level">רמה</Label>
          <Input id="grade-level" type="number" min={1} max={12} value={level} onChange={(e) => setLevel(Number(e.target.value))} required />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading ? "שומר..." : grade ? "עדכן" : "צור"}</Button>
          <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Class Form ──────────────────────────────────────────
function ClassFormDialog({
  open, onClose, classGroup, grades, schoolId,
}: {
  open: boolean; onClose: () => void; classGroup: ClassGroup | null; grades: Grade[]; schoolId: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(classGroup?.name ?? "");
  const [gradeId, setGradeId] = useState(classGroup?.grade_id ?? (grades[0]?.id ?? 0));
  const [homeroomDailyRequired, setHomeroomDailyRequired] = useState(classGroup?.homeroom_daily_required ?? false);

  const createMut = useMutation({
    mutationFn: () => createClass({ school_id: schoolId, name, grade_id: gradeId, homeroom_daily_required: homeroomDailyRequired }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["classes", schoolId] }); toast.success("כיתה נוצרה"); onClose(); },
    onError: () => toast.error("שגיאה ביצירת כיתה"),
  });

  const updateMut = useMutation({
    mutationFn: () => updateClass(classGroup!.id, { name, grade_id: gradeId, homeroom_daily_required: homeroomDailyRequired }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["classes", schoolId] }); toast.success("כיתה עודכנה"); onClose(); },
    onError: () => toast.error("שגיאה בעדכון כיתה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader><DialogTitle>{classGroup ? "עריכת כיתה" : "כיתה חדשה"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); classGroup ? updateMut.mutate() : createMut.mutate(); }} className="space-y-4">
        <div>
          <Label htmlFor="class-name">שם</Label>
          <Input id="class-name" value={name} onChange={(e) => setName(e.target.value)} placeholder='לדוגמה: ט1' required />
        </div>
        <div>
          <Label htmlFor="class-grade">שכבה</Label>
          <Select id="class-grade" value={gradeId} onChange={(e) => setGradeId(Number(e.target.value))} required>
            <option value="">בחר שכבה</option>
            {grades.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
          </Select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={homeroomDailyRequired} onChange={(e) => setHomeroomDailyRequired(e.target.checked)} className="rounded border-border" />
          <span className="text-sm">מחנכת חייבת לפגוש כיתה כל יום</span>
        </label>
        <p className="text-xs text-muted-foreground -mt-2">
          כשמסומן — המחנכת חייבת ללמד בכיתה בכל יום שהיא בבית הספר.
          כשלא מסומן — מועדף אך לא מחייב.
        </p>
        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading ? "שומר..." : classGroup ? "עדכן" : "צור"}</Button>
          <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
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

  const [gradeDialogOpen, setGradeDialogOpen] = useState(false);
  const [editingGrade, setEditingGrade] = useState<Grade | null>(null);
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "grade" | "class"; id: number; name: string } | null>(null);
  const [expandedGrade, setExpandedGrade] = useState<number | null>(null);

  const { data: grades = [] } = useQuery({ queryKey: ["grades", schoolId], queryFn: () => fetchGrades(schoolId!), enabled: !!schoolId });
  const { data: classes = [] } = useQuery({ queryKey: ["classes", schoolId], queryFn: () => fetchClasses(schoolId!), enabled: !!schoolId });
  const { data: allRequirements = [] } = useQuery({ queryKey: ["requirements", schoolId, true], queryFn: () => fetchRequirements(schoolId!, true), enabled: !!schoolId });
  const { data: clusters = [] } = useQuery({ queryKey: ["grouping-clusters", schoolId], queryFn: () => fetchGroupingClusters(schoolId!), enabled: !!schoolId });
  const { data: constraints = [] } = useQuery({ queryKey: ["constraints", schoolId], queryFn: () => fetchConstraints(schoolId!), enabled: !!schoolId });

  const classHoursSummary = useMemo(() => computeAllClassHours(allRequirements, clusters), [allRequirements, clusters]);

  // Build per-class end-of-day constraint lookup
  const eodByClass = useMemo(() => {
    const map: Record<number, Constraint> = {};
    for (const c of constraints) {
      if (c.rule_type !== "CLASS_END_TIME" || !c.is_active) continue;
      if (c.target_type === "CLASS" && c.target_id) {
        map[c.target_id] = c;
      }
    }
    return map;
  }, [constraints]);

  // School days (from existing timeslots or default)
  const schoolDays = useMemo(() => {
    return DAYS_ORDER.filter(() => true).slice(0, 6); // Sunday-Friday
  }, []);

  const toggleHomeroomMut = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) => updateClass(id, { homeroom_daily_required: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["classes", schoolId] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteTarget!.type === "grade" ? deleteGrade(deleteTarget!.id) : deleteClass(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [deleteTarget!.type === "grade" ? "grades" : "classes", schoolId] });
      toast.success("נמחק"); setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  const gradeMap = Object.fromEntries(grades.map((g) => [g.id, g.name]));

  if (!schoolId) {
    return <div className="flex items-center justify-center h-full"><p className="text-muted-foreground">בחר בית ספר</p></div>;
  }

  return (
    <div className="space-y-8">
      {/* Grades + Classes grouped */}
      {grades.map((grade) => {
        const gradeClasses = classes.filter((c) => c.grade_id === grade.id);
        const expanded = expandedGrade === grade.id;

        return (
          <section key={grade.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">שכבה {grade.name}</h2>
                <Badge variant="secondary">{gradeClasses.length} כיתות</Badge>
                <Badge variant="outline" className="text-xs">רמה {grade.level}</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" title="אילוצי סוף יום"
                  onClick={() => setExpandedGrade(expanded ? null : grade.id)}>
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <span className="text-xs mr-1">סוף יום</span>
                </Button>
                <Button variant="ghost" size="icon"
                  onClick={() => { setEditingGrade(grade); setGradeDialogOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon"
                  onClick={() => setDeleteTarget({ type: "grade", id: grade.id, name: grade.name })}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            {/* Class table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-right p-2 font-medium">שם</th>
                    <th className="text-right p-2 font-medium">רגילות</th>
                    <th className="text-right p-2 font-medium">הקבצות</th>
                    <th className="text-right p-2 font-medium">משותפים</th>
                    <th className="text-right p-2 font-medium">סה״כ</th>
                    <th className="text-right p-2 font-medium">מחנכת</th>
                    <th className="text-right p-2 font-medium w-28">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {gradeClasses.map((c) => {
                    const s = classHoursSummary[c.id];
                    return (
                      <tr key={c.id} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-medium">{c.name}</td>
                        <td className="p-2">{s?.regular || "—"}</td>
                        <td className="p-2">{s?.grouped || "—"}</td>
                        <td className="p-2">{s?.shared || "—"}</td>
                        <td className="p-2">
                          {s?.total ? <Badge variant="secondary" className="font-bold">{s.total}</Badge> : "—"}
                        </td>
                        <td className="p-2">
                          <button type="button" onClick={() => toggleHomeroomMut.mutate({ id: c.id, value: !c.homeroom_daily_required })} className="cursor-pointer">
                            {c.homeroom_daily_required
                              ? <Badge variant="default" className="text-xs">חובה</Badge>
                              : <Badge variant="outline" className="text-xs">מועדף</Badge>}
                          </button>
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" title="מערכת"
                              onClick={() => navigate(`/results?view=class&id=${c.id}`)}>
                              <Calendar className="h-4 w-4 text-primary" />
                            </Button>
                            <Button variant="ghost" size="icon"
                              onClick={() => { setEditingClass(c); setClassDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon"
                              onClick={() => setDeleteTarget({ type: "class", id: c.id, name: c.name })}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {gradeClasses.length === 0 && (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">אין כיתות בשכבה זו</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* End-of-day grids (expandable) */}
            {expanded && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {gradeClasses.map((c) => (
                  <EndOfDayGrid
                    key={c.id}
                    classId={c.id}
                    className={c.name}
                    schoolId={schoolId}
                    constraint={eodByClass[c.id]}
                    schoolDays={schoolDays}
                  />
                ))}
                {gradeClasses.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-2">הוסף כיתות כדי להגדיר אילוצי סוף יום</p>
                )}
              </div>
            )}
          </section>
        );
      })}

      {grades.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">אין שכבות — הוסף שכבה חדשה</div>
      )}

      {/* Add buttons */}
      <div className="flex gap-3">
        <Button onClick={() => { setEditingGrade(null); setGradeDialogOpen(true); }}>
          <Plus className="h-4 w-4" /> שכבה חדשה
        </Button>
        <Button onClick={() => { setEditingClass(null); setClassDialogOpen(true); }} disabled={grades.length === 0}>
          <Plus className="h-4 w-4" /> כיתה חדשה
        </Button>
      </div>

      {/* Dialogs */}
      {gradeDialogOpen && (
        <GradeFormDialog open={gradeDialogOpen} onClose={() => setGradeDialogOpen(false)} grade={editingGrade} schoolId={schoolId} />
      )}
      {classDialogOpen && (
        <ClassFormDialog open={classDialogOpen} onClose={() => setClassDialogOpen(false)} classGroup={editingClass} grades={grades} schoolId={schoolId} />
      )}
      <ConfirmDialog
        open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה" message={`האם למחוק את "${deleteTarget?.name}"?`} loading={deleteMut.isPending}
      />
    </div>
  );
}
