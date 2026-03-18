import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Shield,
  Feather,
  ChevronDown,
  ChevronUp,
  Globe,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  fetchConstraints,
  createConstraint,
  deleteConstraint,
  toggleConstraint,
  updateConstraintWeight,
} from "@/api/constraints";
import { fetchSubjects } from "@/api/subjects";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Label } from "@/components/common/Label";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RULE_TYPE_LABELS, DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";
import type {
  Constraint,
  ConstraintCategory,
  ConstraintType as CType,
  RuleType,
} from "@/types/models";

const TEACHER_RULES: { value: RuleType; label: string }[] = [
  { value: "TEACHER_DAY_END_LIMIT", label: "מגבלת סיום יום" },
  { value: "TEACHER_PREFERRED_FREE_DAY", label: "בחירת יום חופשי" },
];

const SUBJECT_RULES: { value: RuleType; label: string }[] = [
  { value: "MAX_PER_DAY", label: "מקסימום ליום" },
  { value: "MIN_DAYS_SPREAD", label: "פיזור מינימלי בימים" },
  { value: "NO_CONSECUTIVE_DAYS", label: "ללא ימים רצופים" },
  { value: "REQUIRE_CONSECUTIVE_PERIODS", label: "שעות רצופות (שעה כפולה)" },
  { value: "SAME_DAY_GROUPING", label: "קיבוץ באותו יום" },
  { value: "NOT_SAME_DAY_AS", label: "לא באותו יום כמו" },
  { value: "PREFER_TIME_RANGE", label: "העדפת טווח שעות" },
  { value: "AVOID_LAST_PERIOD", label: "הימנעות משעה אחרונה" },
];

interface InlineConstraintsProps {
  schoolId: number;
  category: "TEACHER" | "SUBJECT";
  targetId: number;
  targetName: string;
}

export function InlineConstraints({
  schoolId,
  category,
  targetId,
  targetName,
}: InlineConstraintsProps) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Constraint | null>(null);
  const [overrideSource, setOverrideSource] = useState<Constraint | null>(null);

  const { data: allConstraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId),
  });

  const constraints = allConstraints.filter(
    (c) =>
      c.category === category &&
      c.target_type === category &&
      c.target_id === targetId,
  );

  // Find global defaults for this category (target_id === null)
  const globalDefaults = allConstraints.filter(
    (c) =>
      c.category === category &&
      c.target_id === null &&
      c.is_active,
  );

  // Which global defaults are overridden by a specific constraint for this entity?
  const overriddenRuleTypes = new Set(
    constraints.map((c) => c.rule_type),
  );

  const activeGlobalDefaults = globalDefaults.filter(
    (g) => !overriddenRuleTypes.has(g.rule_type),
  );

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      toggleConstraint(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
    },
  });

  const weightMut = useMutation({
    mutationFn: ({ id, weight }: { id: number; weight: number }) =>
      updateConstraintWeight(id, weight),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
    },
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

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <span className="text-sm font-medium flex items-center gap-2">
          אילוצים
          {(constraints.length > 0 || activeGlobalDefaults.length > 0) && (
            <Badge variant="secondary">
              {constraints.length + activeGlobalDefaults.length}
            </Badge>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t p-3 space-y-2">
          {/* Active global defaults */}
          {activeGlobalDefaults.map((g) => (
            <div
              key={`global-${g.id}`}
              className="flex items-center gap-2 p-2 rounded border border-dashed border-primary/30 text-sm bg-primary/5"
            >
              <Globe className="h-4 w-4 text-primary/60 shrink-0" />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-muted-foreground">
                    {g.name}
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                    ברירת מחדל
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {RULE_TYPE_LABELS[g.rule_type]} • {formatParams(g)}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 text-xs h-7"
                onClick={() => {
                  setOverrideSource(g);
                  setAddingNew(true);
                }}
              >
                דרוס
              </Button>
            </div>
          ))}

          {constraints.length === 0 &&
            activeGlobalDefaults.length === 0 &&
            !addingNew && (
              <p className="text-sm text-muted-foreground text-center py-2">
                אין אילוצים — הוסף אילוץ חדש
              </p>
            )}

          {constraints.map((c) => {
            const isOverride = globalDefaults.some(
              (g) => g.rule_type === c.rule_type,
            );
            return (
              <div
                key={c.id}
                className={`flex items-center gap-2 p-2 rounded border text-sm ${
                  c.is_active ? "bg-card" : "bg-muted/50 opacity-60"
                }`}
              >
                <button
                  type="button"
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
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.type === "HARD" ? (
                      <Shield className="h-3 w-3 text-primary shrink-0" />
                    ) : (
                      <Feather className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    {isOverride && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 shrink-0 border-amber-400 text-amber-600"
                      >
                        דורס ברירת מחדל
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {RULE_TYPE_LABELS[c.rule_type]} • {formatParams(c)}
                  </p>
                </div>

                {c.type === "SOFT" && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground w-5 text-center">
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
                      className="w-16"
                    />
                  </div>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-7 w-7"
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            );
          })}

          {addingNew && (
            <AddConstraintForm
              schoolId={schoolId}
              category={category}
              targetId={targetId}
              targetName={targetName}
              overrideSource={overrideSource}
              onClose={() => {
                setAddingNew(false);
                setOverrideSource(null);
              }}
            />
          )}

          {!addingNew && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setAddingNew(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              הוסף אילוץ
            </Button>
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
      )}
    </div>
  );
}

// ─── Add Constraint Form (inline) ─────────────────────────
function AddConstraintForm({
  schoolId,
  category,
  targetId,
  targetName,
  overrideSource,
  onClose,
}: {
  schoolId: number;
  category: "TEACHER" | "SUBJECT";
  targetId: number;
  targetName: string;
  overrideSource?: Constraint | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const rules = category === "TEACHER" ? TEACHER_RULES : SUBJECT_RULES;

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId),
    enabled: category === "SUBJECT",
  });

  const [ruleType, setRuleType] = useState<RuleType>(
    overrideSource?.rule_type ?? rules[0].value,
  );
  const [type, setType] = useState<CType>(
    (overrideSource?.type as CType) ?? "HARD",
  );
  const [weight, setWeight] = useState(overrideSource?.weight ?? 50);
  const [params, setParams] = useState<Record<string, unknown>>(
    overrideSource?.parameters ?? {},
  );

  const setParam = (key: string, value: unknown) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  const createMut = useMutation({
    mutationFn: () =>
      createConstraint({
        school_id: schoolId,
        name: `${targetName} — ${RULE_TYPE_LABELS[ruleType]}`,
        description: null,
        category: category as ConstraintCategory,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: ruleType,
        parameters: params,
        target_type: category,
        target_id: targetId,
        is_active: true,
        notes: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ נוסף");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת אילוץ"),
  });

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">סוג כלל</Label>
          <Select
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value as RuleType);
              setParams({});
            }}
            className="text-sm"
          >
            {rules.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">סוג</Label>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as CType)}
            className="text-sm"
          >
            <option value="HARD">חובה</option>
            <option value="SOFT">רך</option>
          </Select>
        </div>
      </div>

      {type === "SOFT" && (
        <div>
          <Label className="text-xs">משקל ({weight})</Label>
          <input
            type="range"
            min={1}
            max={100}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="w-full"
          />
        </div>
      )}

      <ParameterFields
        ruleType={ruleType}
        params={params}
        setParam={setParam}
        subjects={subjects}
      />

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
        >
          {createMut.isPending ? "שומר..." : "הוסף"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

// ─── Parameter Fields ─────────────────────────────────────
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
        value={(params[key] as string) ?? ""}
        onChange={(e) => setParam(key, e.target.value)}
        className="text-sm"
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
        className="text-sm"
      />
    </div>
  );

  switch (ruleType) {
    case "BLOCK_TIMESLOT":
    case "PREFER_TIMESLOT":
      return (
        <div className="grid grid-cols-2 gap-2">
          {daySelect("day")}
          {numberInput("period", "שעה", 1)}
        </div>
      );

    case "BLOCK_DAY":
      return daySelect("day");

    case "BLOCK_TIME_RANGE":
    case "PREFER_TIME_RANGE":
      return (
        <div className="grid grid-cols-3 gap-2">
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
          <Label className="text-xs">מקצוע אחר</Label>
          <Select
            value={(params["other_subject_id"] as number) ?? ""}
            onChange={(e) =>
              setParam("other_subject_id", Number(e.target.value))
            }
            className="text-sm"
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

    case "TEACHER_FIRST_LAST_PREFERENCE":
      return (
        <div>
          <Label className="text-xs">העדפה</Label>
          <Select
            value={(params["prefer"] as string) ?? ""}
            onChange={(e) => setParam("prefer", e.target.value)}
            className="text-sm"
          >
            <option value="FIRST">שעה ראשונה</option>
            <option value="LAST">שעה אחרונה</option>
            <option value="NOT_FIRST">לא שעה ראשונה</option>
            <option value="NOT_LAST">לא שעה אחרונה</option>
          </Select>
        </div>
      );

    case "TEACHER_DAY_END_LIMIT":
      return (
        <>
          {numberInput("num_days", "כמה ימים", 1)}
          {numberInput("end_period", "לסיים עד שעה", 1)}
        </>
      );

    case "TEACHER_PREFERRED_FREE_DAY": {
      const selected = ((params["preferred_days"] as string[]) ?? []);
      return (
        <div>
          <Label className="text-xs">ימים אפשריים לחופשי</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {DAYS_ORDER.map((d) => (
              <label key={d} className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(d)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, d]
                      : selected.filter((x: string) => x !== d);
                    setParam("preferred_days", next);
                  }}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {DAY_LABELS[d]}
              </label>
            ))}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

// ─── Helper ───────────────────────────────────────────────
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
  if (p.consecutive_count) parts.push(`${p.consecutive_count} רצופות`);
  if (p.num_days && p.end_period) parts.push(`${p.num_days} ימים לסיים עד שעה ${p.end_period}`);
  if (p.preferred_days && Array.isArray(p.preferred_days))
    parts.push((p.preferred_days as string[]).map((d) => DAY_LABELS[d] ?? d).join(", "));
  return parts.join(" | ") || "—";
}
