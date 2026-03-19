import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Shield,
  Feather,
  ChevronDown,
  ChevronLeft,
  AlertCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  fetchConstraints,
  createConstraint,
  updateConstraint,
  deleteConstraint,
  toggleConstraint,
  updateConstraintWeight,
} from "@/api/constraints";
import { fetchSubjects } from "@/api/subjects";
import { fetchTeachers } from "@/api/teachers";
import { fetchClasses } from "@/api/classes";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Label } from "@/components/common/Label";
import {
  RULE_TYPE_LABELS,
  DAY_LABELS,
  DAYS_ORDER,
} from "@/lib/constraints";
import type {
  Constraint,
  ConstraintCategory,
  ConstraintType as CType,
  RuleType,
} from "@/types/models";

const SUBJECT_RULES: { value: RuleType; label: string }[] = [
  { value: "MAX_PER_DAY", label: "מקסימום שעות ליום למקצוע" },
  { value: "MIN_DAYS_SPREAD", label: "פיזור מינימלי בימים" },
  { value: "NO_CONSECUTIVE_DAYS", label: "ללא ימים רצופים" },
  { value: "REQUIRE_CONSECUTIVE_PERIODS", label: "שעות רצופות (שעה כפולה)" },
  { value: "PREFER_TIME_RANGE", label: "העדפת טווח שעות" },
  { value: "AVOID_LAST_PERIOD", label: "הימנעות משעה אחרונה" },
];

const TEACHER_RULES: { value: RuleType; label: string }[] = [
  { value: "MAX_TEACHING_HOURS_PER_DAY", label: "מקסימום שעות הוראה ליום" },
  { value: "MAX_TEACHING_DAYS", label: "מקסימום ימי הוראה" },
  { value: "BALANCED_DAILY_LOAD", label: "עומס יומי מאוזן" },
  { value: "NO_GAPS", label: "ללא חלונות" },
  { value: "MAX_GAPS_PER_DAY", label: "מקסימום חלונות ליום" },
  { value: "AVOID_LAST_PERIOD", label: "הימנעות משעה אחרונה" },
];

const CLASS_RULES: { value: RuleType; label: string }[] = [
  { value: "NO_GAPS", label: "ללא חלונות" },
  { value: "MAX_GAPS_PER_DAY", label: "מקסימום חלונות ליום" },
  { value: "CLASS_DAY_LENGTH_LIMIT", label: "אורך יום מקסימלי" },
  { value: "COMPACT_SCHOOL_DAY", label: "יום רציף מלא (מתחיל בשעה 1, מינימום שעות)" },
];

const GROUPING_RULES: { value: RuleType; label: string }[] = [
  { value: "SECONDARY_TRACK_END_OF_DAY", label: "מגמה שניה בסוף יום (רצוף)" },
  { value: "GROUPING_EXTRA_AT_END", label: "שעות נוספות בהקבצה בסוף יום" },
];

// ─── Add / Edit Form ─────────────────────────────────────
function GlobalConstraintForm({
  open,
  onClose,
  constraint,
  schoolId,
  category,
}: {
  open: boolean;
  onClose: () => void;
  constraint: Constraint | null;
  schoolId: number;
  category: ConstraintCategory;
}) {
  const qc = useQueryClient();
  const rules =
    category === "SUBJECT"
      ? SUBJECT_RULES
      : category === "TEACHER"
        ? TEACHER_RULES
        : category === "GROUPING"
          ? GROUPING_RULES
          : CLASS_RULES;

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId),
  });

  const [ruleType, setRuleType] = useState<RuleType>(
    constraint?.rule_type ?? rules[0].value,
  );
  const [type, setType] = useState<CType>(
    (constraint?.type as CType) ?? "SOFT",
  );
  const [weight, setWeight] = useState(constraint?.weight ?? 70);
  const [params, setParams] = useState<Record<string, unknown>>(
    constraint?.parameters ?? {},
  );
  const [name, setName] = useState(
    constraint?.name ?? "",
  );

  const setParam = (key: string, value: unknown) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  const autoName =
    name ||
    `ברירת מחדל — ${rules.find((r) => r.value === ruleType)?.label ?? ruleType}`;

  const createMut = useMutation({
    mutationFn: () =>
      createConstraint({
        school_id: schoolId,
        name: autoName,
        description: null,
        category,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: ruleType,
        parameters: params,
        target_type: category,
        target_id: null,
        is_active: true,
        notes: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ כללי נוצר");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת אילוץ"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateConstraint(constraint!.id, {
        name: autoName,
        category,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: ruleType,
        parameters: params,
        target_type: category,
        target_id: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ עודכן");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {constraint ? "עריכת אילוץ כללי" : "אילוץ כללי חדש"}
        </DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          constraint ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="gc-name">שם (אופציונלי)</Label>
          <Input
            id="gc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={autoName}
          />
        </div>

        <div>
          <Label htmlFor="gc-rule">סוג כלל</Label>
          <Select
            id="gc-rule"
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value as RuleType);
              setParams({});
            }}
          >
            {rules.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="gc-type">סוג</Label>
            <Select
              id="gc-type"
              value={type}
              onChange={(e) => setType(e.target.value as CType)}
            >
              <option value="HARD">חובה (HARD)</option>
              <option value="SOFT">רך (SOFT)</option>
            </Select>
          </div>
          {type === "SOFT" && (
            <div>
              <Label htmlFor="gc-weight">משקל ({weight})</Label>
              <input
                id="gc-weight"
                type="range"
                min={1}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="w-full mt-2"
              />
            </div>
          )}
        </div>

        <ParameterFields
          ruleType={ruleType}
          params={params}
          setParam={setParam}
          subjects={subjects}
        />

        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : constraint ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Parameter Fields ────────────────────────────────────
function ParameterFields({
  ruleType,
  params,
  setParam,
  subjects,
}: {
  ruleType: RuleType;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
  subjects: { id: number; name: string }[];
}) {
  const daySelect = (key: string, allowAll = false) => (
    <div>
      <Label className="text-xs">יום</Label>
      <Select
        value={(params[key] as string) ?? (allowAll ? "ALL" : "")}
        onChange={(e) => setParam(key, e.target.value)}
      >
        {allowAll && <option value="ALL">כל הימים</option>}
        {!allowAll && <option value="">בחר יום</option>}
        {DAYS_ORDER.map((d) => (
          <option key={d} value={d}>
            {DAY_LABELS[d]}
          </option>
        ))}
      </Select>
    </div>
  );

  const numberInput = (key: string, label: string, min = 0) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        value={(params[key] as number) ?? ""}
        onChange={(e) => setParam(key, Number(e.target.value))}
      />
    </div>
  );

  switch (ruleType) {
    case "MAX_PER_DAY":
      return numberInput("max", "מקסימום שעות ליום", 1);
    case "MIN_DAYS_SPREAD":
      return numberInput("min_days", "מינימום ימים", 1);
    case "REQUIRE_CONSECUTIVE_PERIODS":
      return numberInput("consecutive_count", "מספר שעות רצופות", 2);
    case "PREFER_TIME_RANGE":
      return (
        <div className="grid grid-cols-3 gap-2">
          {daySelect("day", true)}
          {numberInput("from_period", "משעה", 1)}
          {numberInput("to_period", "עד שעה", 1)}
        </div>
      );
    case "MAX_TEACHING_HOURS_PER_DAY":
      return numberInput("max", "מקסימום שעות", 1);
    case "MAX_TEACHING_DAYS":
      return numberInput("max_days", "מקסימום ימים", 1);
    case "BALANCED_DAILY_LOAD":
      return numberInput("max_difference", "הפרש מקסימלי", 1);
    case "MAX_GAPS_PER_DAY":
      return numberInput("max", "מקסימום חלונות", 0);
    case "CLASS_DAY_LENGTH_LIMIT":
      return (
        <div className="grid grid-cols-2 gap-2">
          {numberInput("max_periods", "מקסימום שעות", 1)}
          {daySelect("day", true)}
        </div>
      );
    case "COMPACT_SCHOOL_DAY":
      return numberInput("min_periods", "מינימום שעות ביום", 1);
    case "NO_GAPS":
    case "NO_CONSECUTIVE_DAYS":
    case "AVOID_LAST_PERIOD":
      return null;
    default:
      return null;
  }
}

// ─── Category Section ────────────────────────────────────
function CategorySection({
  title,
  category,
  globals,
  overrides,
  schoolId,
}: {
  title: string;
  category: ConstraintCategory;
  globals: Constraint[];
  overrides: Constraint[];
  schoolId: number;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Constraint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Constraint | null>(null);

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId),
    enabled: category === "SUBJECT",
  });
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId),
    enabled: category === "TEACHER",
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId),
    enabled: category === "CLASS",
  });

  const entityMap: Record<number, string> =
    category === "SUBJECT"
      ? Object.fromEntries(subjects.map((s) => [s.id, s.name]))
      : category === "TEACHER"
        ? Object.fromEntries(teachers.map((t) => [t.id, t.name]))
        : Object.fromEntries(classes.map((c) => [c.id, c.name]));

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      toggleConstraint(id, active),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] }),
  });

  const weightMut = useMutation({
    mutationFn: ({ id, weight }: { id: number; weight: number }) =>
      updateConstraintWeight(id, weight),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteConstraint(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ נמחק");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  // Group overrides by rule_type for display
  const overridesByRule = new Map<string, Constraint[]>();
  for (const o of overrides) {
    const list = overridesByRule.get(o.rule_type) ?? [];
    list.push(o);
    overridesByRule.set(o.rule_type, list);
  }

  return (
    <section className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 bg-card hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          )}
          <h3 className="font-semibold text-lg">{title}</h3>
          {globals.length > 0 && (
            <Badge variant="secondary">{globals.length}</Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          הוסף
        </Button>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-3">
          {globals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              אין אילוצים כלליים — לחץ "הוסף" להגדרת ברירת מחדל
            </p>
          ) : (
            globals.map((c) => {
              const ruleOverrides = overridesByRule.get(c.rule_type) ?? [];
              return (
                <div key={c.id} className="space-y-1">
                  <div
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      c.is_active ? "bg-card" : "bg-muted/50 opacity-60"
                    }`}
                  >
                    <button
                      onClick={() =>
                        toggleMut.mutate({ id: c.id, active: !c.is_active })
                      }
                      className="shrink-0 cursor-pointer"
                    >
                      {c.is_active ? (
                        <ToggleRight className="h-5 w-5 text-primary" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          <span className="text-xs text-muted-foreground font-mono">#{c.id}</span>{" "}
                          {c.name}
                        </span>
                        <Badge
                          variant={c.type === "HARD" ? "default" : "secondary"}
                          className="shrink-0"
                        >
                          {c.type === "HARD" ? (
                            <span className="flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              חובה
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <Feather className="h-3 w-3" />
                              רך
                            </span>
                          )}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {RULE_TYPE_LABELS[c.rule_type]} • {formatParams(c)}
                      </p>
                    </div>

                    {c.type === "SOFT" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground w-6 text-center">
                          {c.weight}
                        </span>
                        <input
                          type="range"
                          min={1}
                          max={100}
                          value={c.weight}
                          onChange={(e) =>
                            weightMut.mutate({
                              id: c.id,
                              weight: Number(e.target.value),
                            })
                          }
                          className="w-20"
                        />
                      </div>
                    )}

                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditing(c);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Show overrides for this rule */}
                  {ruleOverrides.length > 0 && (
                    <div className="mr-8 flex flex-wrap gap-1.5">
                      <span className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        דריסות:
                      </span>
                      {ruleOverrides.map((o) => (
                        <Badge
                          key={o.id}
                          variant="outline"
                          className="text-xs border-amber-300 text-amber-700"
                        >
                          {entityMap[o.target_id!] ?? o.target_id} —{" "}
                          {formatParams(o)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {formOpen && (
        <GlobalConstraintForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          constraint={editing}
          schoolId={schoolId}
          category={category}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה"
        message={`האם למחוק את האילוץ "${deleteTarget?.name}"?`}
        loading={deleteMut.isPending}
      />
    </section>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function GlobalConstraintsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  // Global defaults: target_id is null
  const globalSubject = constraints.filter(
    (c) => c.target_id === null && c.category === "SUBJECT",
  );
  const globalTeacher = constraints.filter(
    (c) => c.target_id === null && c.category === "TEACHER",
  );
  const globalClass = constraints.filter(
    (c) => c.target_id === null && c.category === "CLASS",
  );
  const globalGrouping = constraints.filter(
    (c) => c.target_id === null && c.category === "GROUPING",
  );

  // Specific overrides (target_id set)
  const overridesSubject = constraints.filter(
    (c) => c.target_id !== null && c.category === "SUBJECT",
  );
  const overridesTeacher = constraints.filter(
    (c) => c.target_id !== null && c.category === "TEACHER",
  );
  const overridesClass = constraints.filter(
    (c) => c.target_id !== null && c.category === "CLASS",
  );
  const overridesGrouping = constraints.filter(
    (c) => c.target_id !== null && c.category === "GROUPING",
  );

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">אילוצים כלליים</h2>
        <p className="text-sm text-muted-foreground mt-1">
          אילוצים שחלים על כל המקצועות / המורים / הכיתות — אלא אם יש דריסה
          ספציפית (דרך עמוד המקצוע או המורה)
        </p>
      </div>

      <CategorySection
        title="מקצועות"
        category="SUBJECT"
        globals={globalSubject}
        overrides={overridesSubject}
        schoolId={schoolId}
      />

      <CategorySection
        title="מורים"
        category="TEACHER"
        globals={globalTeacher}
        overrides={overridesTeacher}
        schoolId={schoolId}
      />

      <CategorySection
        title="כיתות"
        category="CLASS"
        globals={globalClass}
        overrides={overridesClass}
        schoolId={schoolId}
      />

      <CategorySection
        title="הקבצות"
        category="GROUPING"
        globals={globalGrouping}
        overrides={overridesGrouping}
        schoolId={schoolId}
      />
    </div>
  );
}

// ─── Helper ──────────────────────────────────────────────
function formatParams(c: Constraint): string {
  const p = c.parameters;
  const parts: string[] = [];
  if (p.day && p.day !== "ALL")
    parts.push(DAY_LABELS[p.day as string] ?? String(p.day));
  if (p.day === "ALL") parts.push("כל הימים");
  if (p.period) parts.push(`שעה ${p.period}`);
  if (p.from_period && p.to_period)
    parts.push(`שעות ${p.from_period}–${p.to_period}`);
  if (p.max) parts.push(`מקס׳ ${p.max}`);
  if (p.min) parts.push(`מינ׳ ${p.min}`);
  if (p.max_days) parts.push(`${p.max_days} ימים`);
  if (p.min_days) parts.push(`${p.min_days} ימים`);
  if (p.max_periods) parts.push(`${p.max_periods} שעות`);
  if (p.consecutive_count) parts.push(`${p.consecutive_count} רצופות`);
  if (p.max_difference) parts.push(`הפרש ${p.max_difference}`);
  return parts.join(" | ") || "—";
}
