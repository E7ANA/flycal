import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Calendar, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchGrades, createGrade, updateGrade, deleteGrade } from "@/api/grades";
import { fetchClasses, createClass, updateClass, deleteClass } from "@/api/classes";
import { fetchTeachers } from "@/api/teachers";
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
import type { Grade, ClassGroup, Constraint, HomeroomConfig, Teacher } from "@/types/models";

const MAX_PERIOD = 10;
const SCHOOL_DAYS = DAYS_ORDER.slice(0, 6); // Sun-Fri

// ─── Reusable End-of-Day Grid ────────────────────────────
// Compact grid: rows=days, cols=periods. Toggle each cell.
function EndOfDayGrid({
  grid,
  onChange,
}: {
  grid: Record<string, number[]>;
  onChange: (grid: Record<string, number[]>) => void;
}) {
  const toggle = (day: string, period: number) => {
    const dayPeriods = grid[day] ?? [];
    const next = dayPeriods.includes(period)
      ? dayPeriods.filter((p) => p !== period)
      : [...dayPeriods, period].sort((a, b) => a - b);
    const result = { ...grid };
    if (next.length === 0) delete result[day];
    else result[day] = next;
    onChange(result);
  };

  const periods = Array.from({ length: MAX_PERIOD }, (_, i) => i + 1);

  return (
    <div>
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="text-xs text-muted-foreground p-0.5 w-8"></th>
            {periods.map((p) => (
              <th key={p} className="text-xs text-muted-foreground p-0.5 w-7 text-center">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SCHOOL_DAYS.map((day) => (
            <tr key={day}>
              <td className="text-xs font-medium p-0.5">{DAY_LABELS_SHORT[day]}</td>
              {periods.map((p) => {
                const selected = (grid[day] ?? []).includes(p);
                return (
                  <td key={p} className="p-0.5">
                    <button
                      type="button"
                      onClick={() => toggle(day, p)}
                      className={`w-6 h-6 rounded text-[10px] transition-colors cursor-pointer ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/40 text-muted-foreground/50 hover:bg-muted"
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
      <p className="text-[10px] text-muted-foreground mt-1">בחר שעות סיום אפשריות לכל יום (למשל 6 ו-8)</p>
    </div>
  );
}

// Parse constraint parameters into grid format
function constraintToGrid(c: Constraint | undefined): Record<string, number[]> {
  if (!c) return {};
  const params = c.parameters ?? {};
  const pdp = params.per_day_periods as Record<string, number[]> | undefined;
  if (pdp) return { ...pdp };
  // Legacy
  const days = (params.days as string[]) ?? [];
  const ap = (params.allowed_periods as number[]) ?? (() => {
    const mn = params.min_period as number | undefined;
    const mx = params.max_period as number | undefined;
    return mn != null && mx != null ? Array.from({ length: mx - mn + 1 }, (_, i) => mn + i) : [];
  })();
  const g: Record<string, number[]> = {};
  for (const d of days) g[d] = [...ap];
  return g;
}

// ─── Grade End-of-Day Dialog ─────────────────────────────
function GradeEndOfDayDialog({
  open, onClose, grade, schoolId, constraint,
}: {
  open: boolean; onClose: () => void; grade: Grade; schoolId: number; constraint: Constraint | undefined;
}) {
  const qc = useQueryClient();
  const [grid, setGrid] = useState<Record<string, number[]>>({});

  useEffect(() => { if (open) setGrid(constraintToGrid(constraint)); }, [open, constraint]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const clean: Record<string, number[]> = {};
      for (const [d, ps] of Object.entries(grid)) if (ps.length > 0) clean[d] = ps;
      if (Object.keys(clean).length === 0) {
        if (constraint) await deleteConstraint(constraint.id);
        return;
      }
      const payload = {
        school_id: schoolId, name: `סוף יום — שכבה ${grade.name}`, description: null,
        category: "CLASS" as const, type: "HARD" as const, weight: 100,
        rule_type: "CLASS_END_TIME" as const,
        parameters: { per_day_periods: clean },
        target_type: "GRADE" as const, target_id: grade.id, is_active: true, notes: null,
      };
      if (constraint) await updateConstraint(constraint.id, payload);
      else await createConstraint(payload as Omit<Constraint, "id" | "created_at">);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["constraints", schoolId] }); toast.success("נשמר"); onClose(); },
    onError: () => toast.error("שגיאה"),
  });

  const removeMut = useMutation({
    mutationFn: () => deleteConstraint(constraint!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["constraints", schoolId] }); toast.success("הוסר"); onClose(); },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          סוף יום — שכבה {grade.name}
          {constraint && <span className="text-xs text-muted-foreground mr-2">#{constraint.id}</span>}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <EndOfDayGrid grid={grid} onChange={setGrid} />
        <DialogFooter>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "שומר..." : "שמור"}</Button>
          {constraint && <Button variant="destructive" onClick={() => removeMut.mutate()} disabled={removeMut.isPending}>הסר</Button>}
          <Button variant="outline" onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

// ─── Grade Form ──────────────────────────────────────────
function GradeFormDialog({ open, onClose, grade, schoolId }: { open: boolean; onClose: () => void; grade: Grade | null; schoolId: number }) {
  const qc = useQueryClient();
  const [name, setName] = useState(grade?.name ?? "");
  const [level, setLevel] = useState(grade?.level ?? 7);
  const createMut = useMutation({
    mutationFn: () => createGrade({ school_id: schoolId, name, level }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["grades", schoolId] }); toast.success("שכבה נוצרה"); onClose(); },
    onError: () => toast.error("שגיאה"),
  });
  const updateMut = useMutation({
    mutationFn: () => updateGrade(grade!.id, { name, level }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["grades", schoolId] }); toast.success("עודכנה"); onClose(); },
    onError: () => toast.error("שגיאה"),
  });
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader><DialogTitle>{grade ? "עריכת שכבה" : "שכבה חדשה"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); grade ? updateMut.mutate() : createMut.mutate(); }} className="space-y-4">
        <div><Label>שם</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder='ז' required /></div>
        <div><Label>רמה</Label><Input type="number" min={1} max={12} value={level} onChange={(e) => setLevel(Number(e.target.value))} required /></div>
        <DialogFooter>
          <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>{grade ? "עדכן" : "צור"}</Button>
          <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const DEFAULT_HOMEROOM_CONFIG: HomeroomConfig = {
  meet_hard_count: 4,
  meet_soft_weight: 80,
  open_sunday: true,
  open_sunday_type: "HARD",
  open_sunday_weight: 90,
  open_other: true,
  open_other_weight: 60,
};

// ─── Constraint row: checkbox + type toggle + weight slider ──────────
function ConstraintRow({
  label, enabled, onToggle, type, onTypeChange, weight, onWeightChange, softOnly,
}: {
  label: string; enabled: boolean; onToggle: (v: boolean) => void;
  type: "HARD" | "SOFT"; onTypeChange: (v: "HARD" | "SOFT") => void;
  weight: number; onWeightChange: (v: number) => void;
  softOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <label className="flex items-center gap-1.5 cursor-pointer min-w-[140px]">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="rounded border-border" />
        <span className="text-sm">{label}</span>
      </label>
      {enabled && (
        <>
          {!softOnly ? (
            <button
              type="button"
              onClick={() => onTypeChange(type === "HARD" ? "SOFT" : "HARD")}
              className="cursor-pointer"
            >
              <Badge variant={type === "HARD" ? "default" : "outline"} className="text-[10px]">
                {type === "HARD" ? "חובה" : "רך"}
              </Badge>
            </button>
          ) : (
            <Badge variant="outline" className="text-[10px]">רך</Badge>
          )}
          {(type === "SOFT" || softOnly) && (
            <div className="flex items-center gap-1">
              <input type="range" min={10} max={100} step={5} value={weight} onChange={(e) => onWeightChange(Number(e.target.value))} className="w-16 h-1" />
              <span className="text-[10px] text-muted-foreground w-6">{weight}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Class Form (with End-of-Day grid inside) ────────────
function ClassFormDialog({
  open, onClose, classGroup, grades, schoolId, eodConstraint, gradeEodConstraint, homeroomTeacher,
}: {
  open: boolean; onClose: () => void; classGroup: ClassGroup | null; grades: Grade[]; schoolId: number;
  eodConstraint: Constraint | undefined;
  gradeEodConstraint: Constraint | undefined;
  homeroomTeacher: Teacher | undefined;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(classGroup?.name ?? "");
  const [gradeId, setGradeId] = useState(classGroup?.grade_id ?? (grades[0]?.id ?? 0));
  const [hrCfg, setHrCfg] = useState<HomeroomConfig>(
    classGroup?.homeroom_config ?? DEFAULT_HOMEROOM_CONFIG,
  );
  const [eodGrid, setEodGrid] = useState<Record<string, number[]>>({});

  useEffect(() => {
    if (open) setEodGrid(constraintToGrid(eodConstraint));
  }, [open, eodConstraint]);

  // Compute teacher's effective work days (same logic as solver brain.py)
  const teacherWorkDays = useMemo(() => {
    if (!homeroomTeacher) return null;
    const t = homeroomTeacher;
    let max: number;
    if (t.max_work_days != null) {
      max = t.max_work_days;
    } else if (t.rubrica_hours != null && t.rubrica_hours > 0) {
      if (t.rubrica_hours > 27) max = 4;
      else if (t.rubrica_hours >= 20) max = 3;
      else max = 2;
    } else {
      max = 5;
    }
    return { max, min: t.min_work_days, name: t.name };
  }, [homeroomTeacher]);

  const updateCfg = <K extends keyof HomeroomConfig>(key: K, value: HomeroomConfig[K]) =>
    setHrCfg((prev) => ({ ...prev, [key]: value }));

  const saveMut = useMutation({
    mutationFn: async () => {
      let classId = classGroup?.id;
      if (classGroup) {
        await updateClass(classGroup.id, { name, grade_id: gradeId, homeroom_config: hrCfg });
      } else {
        const created = await createClass({ school_id: schoolId, name, grade_id: gradeId, homeroom_config: hrCfg });
        classId = created.id;
      }
      // Save end-of-day constraint
      const clean: Record<string, number[]> = {};
      for (const [d, ps] of Object.entries(eodGrid)) if (ps.length > 0) clean[d] = ps;
      if (Object.keys(clean).length === 0) {
        if (eodConstraint) await deleteConstraint(eodConstraint.id);
      } else {
        const payload = {
          school_id: schoolId, name: `סוף יום — ${name}`, description: null,
          category: "CLASS" as const, type: "HARD" as const, weight: 100,
          rule_type: "CLASS_END_TIME" as const,
          parameters: { per_day_periods: clean },
          target_type: "CLASS" as const, target_id: classId!, is_active: true, notes: null,
        };
        if (eodConstraint) await updateConstraint(eodConstraint.id, payload);
        else await createConstraint(payload as Omit<Constraint, "id" | "created_at">);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes", schoolId] });
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success(classGroup ? "כיתה עודכנה" : "כיתה נוצרה");
      onClose();
    },
    onError: () => toast.error("שגיאה"),
  });

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader><DialogTitle>{classGroup ? "עריכת כיתה" : "כיתה חדשה"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>שם</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder='ט1' required /></div>
          <div>
            <Label>שכבה</Label>
            <Select value={gradeId} onChange={(e) => setGradeId(Number(e.target.value))} required>
              <option value="">בחר</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </div>
        </div>

        {/* ── Homeroom config ── */}
        <div className="border-t pt-3 space-y-2">
          <Label className="text-sm font-semibold">אילוצי מחנכת</Label>

          {/* Meet days: hard count + soft remainder */}
          <div className="space-y-1.5">
            {teacherWorkDays && (
              <p className="text-[10px] text-muted-foreground">
                מחנכת: {teacherWorkDays.name} · עד {teacherWorkDays.max} ימי הוראה
              </p>
            )}
            <div className="flex items-center gap-3">
              <span className="text-sm min-w-[80px]">ימי מפגש</span>
              <input
                type="number" min={0} max={teacherWorkDays?.max ?? 5} value={hrCfg.meet_hard_count}
                onChange={(e) => updateCfg("meet_hard_count", Number(e.target.value))}
                className="w-12 h-7 text-center text-sm border rounded"
              />
              <Badge variant="default" className="text-[10px]">חובה</Badge>
              {teacherWorkDays && hrCfg.meet_hard_count < teacherWorkDays.max && (
                <>
                  <span className="text-xs text-muted-foreground">
                    השאר ({teacherWorkDays.max - hrCfg.meet_hard_count}) רך
                  </span>
                  <div className="flex items-center gap-1">
                    <input type="range" min={10} max={100} step={5} value={hrCfg.meet_soft_weight} onChange={(e) => updateCfg("meet_soft_weight", Number(e.target.value))} className="w-16 h-1" />
                    <span className="text-[10px] text-muted-foreground w-6">{hrCfg.meet_soft_weight}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sunday opening */}
          <ConstraintRow
            label="פתיחת בוקר ראשון"
            enabled={hrCfg.open_sunday}
            onToggle={(v) => updateCfg("open_sunday", v)}
            type={hrCfg.open_sunday_type}
            onTypeChange={(v) => updateCfg("open_sunday_type", v)}
            weight={hrCfg.open_sunday_weight}
            onWeightChange={(v) => updateCfg("open_sunday_weight", v)}
          />

          {/* Other days morning */}
          <ConstraintRow
            label="פתיחת בוקר שאר ימים"
            enabled={hrCfg.open_other}
            onToggle={(v) => updateCfg("open_other", v)}
            type="SOFT"
            onTypeChange={() => {}}
            weight={hrCfg.open_other_weight}
            onWeightChange={(v) => updateCfg("open_other_weight", v)}
            softOnly
          />
          {hrCfg.open_other && (
            <p className="text-[10px] text-muted-foreground mr-6">שעות 1-4, ניקוד יורד 25% לכל שעה רחוקה מהבוקר</p>
          )}
        </div>

        {/* End-of-Day Grid */}
        <div className="border-t pt-3">
          <div className="flex items-center gap-2 mb-2">
            <Label className="text-sm font-semibold">אילוץ סוף יום</Label>
            {eodConstraint && <span className="text-xs text-muted-foreground">#{eodConstraint.id}</span>}
            {!eodConstraint && gradeEodConstraint && (
              <Badge variant="outline" className="text-[10px] border-dashed text-muted-foreground">שכבתי — לחץ לדרוס</Badge>
            )}
          </div>
          {!eodConstraint && gradeEodConstraint && Object.keys(eodGrid).length === 0 ? (
            <div className="space-y-1">
              <div className="opacity-50 pointer-events-none">
                <EndOfDayGrid grid={constraintToGrid(gradeEodConstraint)} onChange={() => {}} />
              </div>
              <button
                type="button"
                className="text-xs text-primary hover:underline cursor-pointer"
                onClick={() => setEodGrid(constraintToGrid(gradeEodConstraint))}
              >
                צור אילוץ פרטני לכיתה (העתק מהשכבה)
              </button>
            </div>
          ) : (
            <EndOfDayGrid grid={eodGrid} onChange={setEodGrid} />
          )}
        </div>

        <DialogFooter>
          <Button type="submit" disabled={saveMut.isPending}>{saveMut.isPending ? "שומר..." : classGroup ? "עדכן" : "צור"}</Button>
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
  const [eodGrade, setEodGrade] = useState<Grade | null>(null);

  const { data: grades = [] } = useQuery({ queryKey: ["grades", schoolId], queryFn: () => fetchGrades(schoolId!), enabled: !!schoolId });
  const { data: classes = [] } = useQuery({ queryKey: ["classes", schoolId], queryFn: () => fetchClasses(schoolId!), enabled: !!schoolId });
  const { data: allRequirements = [] } = useQuery({ queryKey: ["requirements", schoolId, true], queryFn: () => fetchRequirements(schoolId!, true), enabled: !!schoolId });
  const { data: clusters = [] } = useQuery({ queryKey: ["grouping-clusters", schoolId], queryFn: () => fetchGroupingClusters(schoolId!), enabled: !!schoolId });
  const { data: constraints = [] } = useQuery({ queryKey: ["constraints", schoolId], queryFn: () => fetchConstraints(schoolId!), enabled: !!schoolId });
  const { data: teachers = [] } = useQuery({ queryKey: ["teachers", schoolId], queryFn: () => fetchTeachers(schoolId!), enabled: !!schoolId });

  const classHoursSummary = useMemo(() => computeAllClassHours(allRequirements, clusters), [allRequirements, clusters]);

  // End-of-day constraint lookups
  const eodByClass = useMemo(() => {
    const m: Record<number, Constraint> = {};
    for (const c of constraints) {
      if (c.rule_type === "CLASS_END_TIME" && c.is_active && c.target_type === "CLASS" && c.target_id)
        m[c.target_id] = c;
    }
    return m;
  }, [constraints]);

  const eodByGrade = useMemo(() => {
    const m: Record<number, Constraint> = {};
    for (const c of constraints) {
      if (c.rule_type === "CLASS_END_TIME" && c.is_active && c.target_type === "GRADE" && c.target_id)
        m[c.target_id] = c;
    }
    return m;
  }, [constraints]);


  const deleteMut = useMutation({
    mutationFn: () => deleteTarget!.type === "grade" ? deleteGrade(deleteTarget!.id) : deleteClass(deleteTarget!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [deleteTarget!.type === "grade" ? "grades" : "classes", schoolId] }); toast.success("נמחק"); setDeleteTarget(null); },
    onError: () => toast.error("שגיאה"),
  });

  if (!schoolId) return <div className="flex items-center justify-center h-full"><p className="text-muted-foreground">בחר בית ספר</p></div>;

  return (
    <div className="space-y-8">
      {grades.map((grade) => {
        const gradeClasses = classes.filter((c) => c.grade_id === grade.id);
        return (
          <section key={grade.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">שכבה {grade.name}</h2>
                <Badge variant="secondary">{gradeClasses.length} כיתות</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" title="אילוץ סוף יום לשכבה" onClick={() => setEodGrade(grade)}>
                  <Clock className="h-4 w-4 text-amber-600" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => { setEditingGrade(grade); setGradeDialogOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ type: "grade", id: grade.id, name: grade.name })}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-right p-2 font-medium">שם</th>
                    <th className="text-right p-2 font-medium">רגילות</th>
                    <th className="text-right p-2 font-medium">הקבצות</th>
                    <th className="text-right p-2 font-medium">משותפים</th>
                    <th className="text-right p-2 font-medium">סה״כ</th>
                    <th className="text-right p-2 font-medium">מפגש מחנכת</th>
                    <th className="text-right p-2 font-medium">פתיחת בוקר</th>
                    <th className="text-right p-2 font-medium">סוף יום</th>
                    <th className="text-right p-2 font-medium w-28">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {gradeClasses.map((c) => {
                    const s = classHoursSummary[c.id];
                    const eod = eodByClass[c.id];
                    const eodGradeConstraint = eodByGrade[c.grade_id];
                    const effectiveEod = eod ?? eodGradeConstraint;
                    const isInherited = !eod && !!eodGradeConstraint;
                    // Summary of end-of-day: show unique periods across all days
                    const eodSummary = effectiveEod ? (() => {
                      const pdp = effectiveEod.parameters?.per_day_periods as Record<string, number[]> | undefined;
                      if (pdp) {
                        const allP = new Set<number>();
                        Object.values(pdp).forEach((ps) => ps.forEach((p) => allP.add(p)));
                        return [...allP].sort((a, b) => a - b).join(",");
                      }
                      return null;
                    })() : null;

                    return (
                      <tr key={c.id} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-medium">{c.name}</td>
                        <td className="p-2">{s?.regular || "—"}</td>
                        <td className="p-2">{s?.grouped || "—"}</td>
                        <td className="p-2">{s?.shared || "—"}</td>
                        <td className="p-2">{s?.total ? <Badge variant="secondary" className="font-bold">{s.total}</Badge> : "—"}</td>
                        <td className="p-2">
                          {(() => {
                            const cfg = c.homeroom_config;
                            if (!cfg) return <span className="text-muted-foreground text-xs">—</span>;
                            const hard = cfg.meet_hard_count ?? 0;
                            const ht = teachers.find((t) => t.homeroom_class_id === c.id);
                            const teachDays = ht
                              ? (ht.max_work_days ?? (ht.rubrica_hours != null && ht.rubrica_hours > 0
                                ? (ht.rubrica_hours > 27 ? 4 : ht.rubrica_hours >= 20 ? 3 : 2)
                                : 5))
                              : 5;
                            const soft = teachDays - hard;
                            return (
                              <span className="text-[10px]">
                                <Badge variant="default" className="text-[10px]">{hard} חובה</Badge>
                                {soft > 0 && <Badge variant="outline" className="text-[10px] mr-1">{soft} רך {cfg.meet_soft_weight}</Badge>}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="p-2">
                          {(() => {
                            const cfg = c.homeroom_config;
                            if (!cfg) return <span className="text-muted-foreground text-xs">—</span>;
                            const parts: string[] = [];
                            if (cfg.open_sunday) parts.push(cfg.open_sunday_type === "HARD" ? "א׳ חובה" : `א׳ ${cfg.open_sunday_weight}`);
                            if (cfg.open_other) parts.push(`שאר ${cfg.open_other_weight}`);
                            return parts.length > 0
                              ? <Badge variant="outline" className="text-[10px]">{parts.join(" · ")}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>;
                          })()}
                        </td>
                        <td className="p-2">
                          {eodSummary ? (
                            isInherited ? (
                              <Badge variant="outline" className="text-xs border-dashed text-muted-foreground" title="נקבע ברמת השכבה">שכבתי</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">שעות {eodSummary}</Badge>
                            )
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" title="מערכת" onClick={() => navigate(`/results?view=class&id=${c.id}`)}>
                              <Calendar className="h-4 w-4 text-primary" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => { setEditingClass(c); setClassDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ type: "class", id: c.id, name: c.name })}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {gradeClasses.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">אין כיתות</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {grades.length === 0 && <div className="text-center py-12 text-muted-foreground">אין שכבות</div>}

      <div className="flex gap-3">
        <Button onClick={() => { setEditingGrade(null); setGradeDialogOpen(true); }}><Plus className="h-4 w-4" /> שכבה חדשה</Button>
        <Button onClick={() => { setEditingClass(null); setClassDialogOpen(true); }} disabled={grades.length === 0}><Plus className="h-4 w-4" /> כיתה חדשה</Button>
      </div>

      {/* Dialogs */}
      {gradeDialogOpen && <GradeFormDialog open={gradeDialogOpen} onClose={() => setGradeDialogOpen(false)} grade={editingGrade} schoolId={schoolId} />}
      {classDialogOpen && (
        <ClassFormDialog
          open={classDialogOpen} onClose={() => setClassDialogOpen(false)}
          classGroup={editingClass} grades={grades} schoolId={schoolId}
          eodConstraint={editingClass ? eodByClass[editingClass.id] : undefined}
          gradeEodConstraint={editingClass ? eodByGrade[editingClass.grade_id] : undefined}
          homeroomTeacher={editingClass ? teachers.find((t) => t.homeroom_class_id === editingClass.id) : undefined}
        />
      )}
      {eodGrade && (
        <GradeEndOfDayDialog
          open={!!eodGrade} onClose={() => setEodGrade(null)}
          grade={eodGrade} schoolId={schoolId} constraint={eodByGrade[eodGrade.id]}
        />
      )}
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה" message={`האם למחוק את "${deleteTarget?.name}"?`} loading={deleteMut.isPending} />
    </div>
  );
}
