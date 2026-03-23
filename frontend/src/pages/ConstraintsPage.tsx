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
  Globe,
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
  fetchTemplates,
  createFromTemplate,
  type ConstraintTemplate,
} from "@/api/constraints";
import { fetchTeachers } from "@/api/teachers";
import { fetchSubjects } from "@/api/subjects";
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
  CATEGORY_LABELS,
  RULE_TYPE_LABELS,
  DAY_LABELS,
  DAYS_ORDER,
} from "@/lib/constraints";
import type {
  Constraint,
  ConstraintCategory,
  ConstraintType as CType,
  RuleType,
  TargetType,
} from "@/types/models";

// ─── Constraint Form ─────────────────────────────────────
function ConstraintFormDialog({
  open,
  onClose,
  constraint,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  constraint: Constraint | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId),
  });
  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId),
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId),
  });

  const [name, setName] = useState(constraint?.name ?? "");
  const [category, setCategory] = useState<ConstraintCategory>(
    constraint?.category ?? "TEACHER",
  );
  const [type, setType] = useState<CType>(constraint?.type ?? "HARD");
  const [weight, setWeight] = useState(constraint?.weight ?? 50);
  const [ruleType, setRuleType] = useState<RuleType>(
    constraint?.rule_type ?? "BLOCK_DAY",
  );
  const [targetType, setTargetType] = useState<TargetType>(
    constraint?.target_type ?? "TEACHER",
  );
  const [targetId, setTargetId] = useState<number | "">(
    constraint?.target_id ?? "",
  );
  const [params, setParams] = useState<Record<string, unknown>>(
    constraint?.parameters ?? {},
  );

  const setParam = (key: string, value: unknown) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  const createMut = useMutation({
    mutationFn: () =>
      createConstraint({
        school_id: schoolId,
        name,
        description: null,
        category,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: ruleType,
        parameters: params,
        target_type: targetType,
        target_id: targetId === "" ? null : targetId,
        is_active: true,
        notes: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ נוצר בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת אילוץ"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateConstraint(constraint!.id, {
        name,
        category,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: ruleType,
        parameters: params,
        target_type: targetType,
        target_id: targetId === "" ? null : targetId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ עודכן");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון אילוץ"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  // Get target options based on targetType
  const targetOptions = (() => {
    switch (targetType) {
      case "TEACHER":
        return teachers.map((t) => ({ id: t.id, name: t.name }));
      case "SUBJECT":
        return subjects.map((s) => ({ id: s.id, name: s.name }));
      case "CLASS":
        return classes.map((c) => ({ id: c.id, name: c.name }));
      default:
        return [];
    }
  })();

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {constraint ? "עריכת אילוץ" : "אילוץ חדש"}
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
          <Label htmlFor="c-name">שם</Label>
          <Input
            id="c-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="שם האילוץ"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="c-category">קטגוריה</Label>
            <Select
              id="c-category"
              value={category}
              onChange={(e) => {
                const cat = e.target.value as ConstraintCategory;
                setCategory(cat);
                // Auto-set target_type
                if (cat === "TEACHER") setTargetType("TEACHER");
                else if (cat === "SUBJECT") setTargetType("SUBJECT");
                else if (cat === "CLASS") setTargetType("CLASS");
                else if (cat === "GLOBAL") {
                  setTargetType("ALL");
                  setTargetId("");
                }
              }}
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="c-type">סוג</Label>
            <Select
              id="c-type"
              value={type}
              onChange={(e) => setType(e.target.value as CType)}
            >
              <option value="HARD">חובה (HARD)</option>
              <option value="SOFT">רך (SOFT)</option>
            </Select>
          </div>
        </div>

        {type === "SOFT" && (
          <div>
            <Label htmlFor="c-weight">משקל ({weight})</Label>
            <input
              id="c-weight"
              type="range"
              min={1}
              max={100}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="w-full"
            />
          </div>
        )}

        <div>
          <Label htmlFor="c-rule">סוג כלל</Label>
          <Select
            id="c-rule"
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value as RuleType);
              setParams({});
            }}
          >
            {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>

        {/* Target */}
        {targetType !== "ALL" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-target-type">יעד</Label>
              <Select
                id="c-target-type"
                value={targetType}
                onChange={(e) => {
                  setTargetType(e.target.value as TargetType);
                  setTargetId("");
                }}
              >
                <option value="TEACHER">מורה</option>
                <option value="SUBJECT">מקצוע</option>
                <option value="CLASS">כיתה</option>
                <option value="GRADE">שכבה</option>
                <option value="ALL">הכל</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="c-target-id">בחר</Label>
              <Select
                id="c-target-id"
                value={targetId}
                onChange={(e) =>
                  setTargetId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">כל ה{targetType === "TEACHER" ? "מורים" : targetType === "CLASS" ? "כיתות" : "מקצועות"}</option>
                {targetOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {/* Dynamic Parameters */}
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
      <Label>יום</Label>
      <Select
        value={(params[key] as string) ?? ""}
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
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        value={(params[key] as number) ?? ""}
        onChange={(e) => setParam(key, Number(e.target.value))}
      />
    </div>
  );

  switch (ruleType) {
    case "BLOCK_TIMESLOT":
    case "PREFER_TIMESLOT":
      return (
        <div className="grid grid-cols-2 gap-3">
          {daySelect("day")}
          {numberInput("period", "שעה", 1)}
        </div>
      );

    case "BLOCK_DAY":
      return daySelect("day");

    case "BLOCK_TIME_RANGE":
    case "PREFER_TIME_RANGE":
      return (
        <div className="grid grid-cols-3 gap-3">
          {daySelect("day", true)}
          {numberInput("from_period", "משעה", 1)}
          {numberInput("to_period", "עד שעה", 1)}
        </div>
      );

    case "MAX_PER_DAY":
      return numberInput("max", "מקסימום", 1);

    case "MIN_DAYS_SPREAD":
      return numberInput("min_days", "מינימום ימים", 1);

    case "REQUIRE_CONSECUTIVE_PERIODS":
      return numberInput("consecutive_count", "מספר שעות רצופות", 2);

    case "MAX_TEACHING_HOURS_PER_DAY":
      return numberInput("max", "מקסימום שעות", 1);

    case "MIN_TEACHING_HOURS_PER_DAY":
      return numberInput("min", "מינימום שעות", 1);

    case "MAX_TEACHING_DAYS":
      return numberInput("max_days", "מקסימום ימים", 1);

    case "MIN_FREE_DAYS":
      return numberInput("min_days", "מינימום ימים חופשיים", 1);

    case "BALANCED_DAILY_LOAD":
      return numberInput("max_difference", "הפרש מקסימלי", 1);

    case "MAX_GAPS_PER_DAY":
      return numberInput("max", "מקסימום חלונות", 0);

    case "MAX_GAPS_PER_WEEK":
      return numberInput("max", "מקסימום חלונות", 0);

    case "NOT_SAME_DAY_AS":
      return (
        <div>
          <Label>מקצוע אחר</Label>
          <Select
            value={(params["other_subject_id"] as number) ?? ""}
            onChange={(e) =>
              setParam("other_subject_id", Number(e.target.value))
            }
          >
            <option value="">בחר מקצוע</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      );

    case "CLASS_DAY_LENGTH_LIMIT":
      return (
        <div className="grid grid-cols-2 gap-3">
          {numberInput("max_periods", "מקסימום שעות", 1)}
          {daySelect("day", true)}
        </div>
      );

    case "TEACHER_FIRST_LAST_PREFERENCE":
      return (
        <div>
          <Label>העדפה</Label>
          <Select
            value={(params["prefer"] as string) ?? ""}
            onChange={(e) => setParam("prefer", e.target.value)}
          >
            <option value="FIRST">שעה ראשונה</option>
            <option value="LAST">שעה אחרונה</option>
            <option value="NOT_FIRST">לא שעה ראשונה</option>
            <option value="NOT_LAST">לא שעה אחרונה</option>
          </Select>
        </div>
      );

    case "CLASS_END_TIME":
      return (
        <div className="space-y-2">
          <div>
            <Label>ימים</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {DAYS_ORDER.map((d) => {
                const selected = ((params.days as string[]) ?? []).includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`px-2 py-1 text-xs rounded border cursor-pointer ${selected ? "bg-primary text-white" : "bg-muted"}`}
                    onClick={() => {
                      const current = ((params.days as string[]) ?? []);
                      setParam("days", selected ? current.filter((x: string) => x !== d) : [...current, d]);
                    }}
                  >
                    {DAY_LABELS[d]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {numberInput("min_period", "משעה (מינימום)", 1)}
            {numberInput("max_period", "עד שעה (מקסימום)", 1)}
          </div>
        </div>
      );

    case "GROUPING_EXTRA_AT_END":
      return null;

    default:
      return null;
  }
}

// ─── Template Dialog ─────────────────────────────────────
function TemplateDialog({
  open,
  onClose,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ["constraint-templates"],
    queryFn: fetchTemplates,
  });

  const createMut = useMutation({
    mutationFn: (index: number) => createFromTemplate(index, schoolId, null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ נוצר מתבנית");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירה מתבנית"),
  });

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>בחר תבנית</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        {templates.map((t: ConstraintTemplate) => (
          <button
            key={t.index}
            onClick={() => createMut.mutate(t.index)}
            disabled={createMut.isPending}
            className="w-full flex items-center justify-between p-3 rounded-md border hover:bg-muted transition-colors text-start cursor-pointer"
          >
            <div>
              <p className="font-medium text-sm">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {RULE_TYPE_LABELS[t.rule_type as RuleType] ?? t.rule_type} •{" "}
                {t.default_type}
              </p>
            </div>
            <Badge variant={t.default_type === "HARD" ? "default" : "secondary"}>
              {t.default_type === "HARD" ? "חובה" : "רך"}
            </Badge>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function ConstraintsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Constraint | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Constraint | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("ALL");

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      toggleConstraint(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
    },
    onError: () => toast.error("שגיאה בשינוי סטטוס"),
  });

  const weightMut = useMutation({
    mutationFn: ({ id, weight }: { id: number; weight: number }) =>
      updateConstraintWeight(id, weight),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
    },
    onError: () => toast.error("שגיאה בעדכון משקל"),
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

  // Split into global defaults and specific constraints
  const globalDefaults = constraints.filter(
    (c) =>
      c.target_id === null &&
      ["SUBJECT", "TEACHER", "CLASS"].includes(c.category),
  );
  const specificConstraints = constraints.filter(
    (c) =>
      c.target_id !== null ||
      !["SUBJECT", "TEACHER", "CLASS"].includes(c.category),
  );

  const filtered =
    filterCategory === "ALL"
      ? specificConstraints
      : specificConstraints.filter((c) => c.category === filterCategory);

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">אילוצים</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTemplateOpen(true)}
          >
            תבניות
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            אילוץ חדש
          </Button>
        </div>
      </div>

      {/* Global Defaults Section */}
      <div className="border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">ברירות מחדל כלליות</h3>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            הוסף ברירת מחדל
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          חל על כל המקצועות / המורים / הכיתות, אלא אם יש דריסה ספציפית
        </p>

        {globalDefaults.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            אין ברירות מחדל — הוסף אילוץ עם יעד "הכל"
          </p>
        ) : (
          <div className="space-y-2">
            {globalDefaults.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${
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
                    <span className="font-medium text-sm truncate">
                      <span className="text-xs text-muted-foreground font-mono">#{c.id}</span>{" "}
                      {c.name}
                    </span>
                    <Badge
                      variant={c.type === "HARD" ? "default" : "secondary"}
                      className="shrink-0"
                    >
                      {c.type === "HARD" ? "חובה" : "רך"}
                    </Badge>
                    <Badge variant="outline" className="shrink-0">
                      כל ה
                      {c.category === "SUBJECT"
                        ? "מקצועות"
                        : c.category === "TEACHER"
                          ? "מורים"
                          : "כיתות"}
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
            ))}
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {["ALL", ...Object.keys(CATEGORY_LABELS)].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors cursor-pointer ${
              filterCategory === cat
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted"
            }`}
          >
            {cat === "ALL"
              ? `הכל (${specificConstraints.length})`
              : `${CATEGORY_LABELS[cat as ConstraintCategory]} (${specificConstraints.filter((c) => c.category === cat).length})`}
          </button>
        ))}
      </div>

      {/* Constraints List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center py-8 text-muted-foreground">
            אין אילוצים — הוסף אילוץ חדש או בחר מתבנית
          </p>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              c.is_active ? "bg-card" : "bg-muted/50 opacity-60"
            }`}
          >
            {/* Toggle */}
            <button
              onClick={() =>
                toggleMut.mutate({ id: c.id, active: !c.is_active })
              }
              className="shrink-0 cursor-pointer"
            >
              {c.is_active ? (
                <ToggleRight className="h-6 w-6 text-primary" />
              ) : (
                <ToggleLeft className="h-6 w-6 text-muted-foreground" />
              )}
            </button>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">
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
                <Badge variant="outline" className="shrink-0">
                  {CATEGORY_LABELS[c.category]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {RULE_TYPE_LABELS[c.rule_type]} • {formatParams(c)}
              </p>
            </div>

            {/* Weight slider for SOFT */}
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

            {/* Actions */}
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
        ))}
      </div>

      {/* Dialogs */}
      {formOpen && (
        <ConstraintFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          constraint={editing}
          schoolId={schoolId}
        />
      )}

      {templateOpen && (
        <TemplateDialog
          open={templateOpen}
          onClose={() => setTemplateOpen(false)}
          schoolId={schoolId}
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
    </div>
  );
}

// ─── Helper ──────────────────────────────────────────────
function formatParams(c: Constraint): string {
  const p = c.parameters;
  const parts: string[] = [];
  if (p.day && p.day !== "ALL") parts.push(DAY_LABELS[p.day as string] ?? String(p.day));
  if (p.day === "ALL") parts.push("כל הימים");
  if (p.period) parts.push(`שעה ${p.period}`);
  if (p.from_period && p.to_period) parts.push(`שעות ${p.from_period}–${p.to_period}`);
  if (p.max) parts.push(`מקס׳ ${p.max}`);
  if (p.min) parts.push(`מינ׳ ${p.min}`);
  if (p.max_days) parts.push(`${p.max_days} ימים`);
  if (p.min_days) parts.push(`${p.min_days} ימים`);
  if (p.consecutive_count) parts.push(`${p.consecutive_count} רצופות`);
  return parts.join(" | ") || "—";
}
