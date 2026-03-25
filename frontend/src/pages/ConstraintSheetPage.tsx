import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ToggleLeft, ToggleRight, Trash2, Shield, Feather } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  fetchConstraints,
  deleteConstraint,
  toggleConstraint,
} from "@/api/constraints";
import { fetchTeachers } from "@/api/teachers";
import { fetchSubjects } from "@/api/subjects";
import { fetchClasses } from "@/api/classes";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/common/Badge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/common/Button";
import { RULE_TYPE_LABELS, CATEGORY_LABELS, formatParams } from "@/lib/constraints";
import type { Constraint, ConstraintCategory, RuleType } from "@/types/models";


const CATEGORY_OPTIONS: { value: ConstraintCategory | ""; label: string }[] = [
  { value: "", label: "כל הקטגוריות" },
  { value: "TEACHER", label: "מורה" },
  { value: "SUBJECT", label: "מקצוע" },
  { value: "CLASS", label: "כיתה" },
  { value: "GROUPING", label: "הקבצה" },
  { value: "GLOBAL", label: "כללי" },
];

export default function ConstraintSheetPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState<ConstraintCategory | "">("");
  const [excludedRuleTypes, setExcludedRuleTypes] = useState<Set<RuleType>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Constraint | null>(null);

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId!),
    enabled: !!schoolId,
  });

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId!),
    enabled: !!schoolId,
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId!),
    enabled: !!schoolId,
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      toggleConstraint(id, active),
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

  const teacherMap = useMemo(
    () => Object.fromEntries(teachers.map((t) => [t.id, t.name])),
    [teachers],
  );
  const subjectMap = useMemo(
    () => Object.fromEntries(subjects.map((s) => [s.id, s.name])),
    [subjects],
  );
  const classMap = useMemo(
    () => Object.fromEntries(classes.map((c) => [c.id, c.name])),
    [classes],
  );

  const resolveTarget = (c: Constraint): string => {
    if (!c.target_id) return "כללי";
    switch (c.target_type) {
      case "TEACHER":
        return teacherMap[c.target_id] ?? `מורה #${c.target_id}`;
      case "SUBJECT":
        return subjectMap[c.target_id] ?? `מקצוע #${c.target_id}`;
      case "CLASS":
        return classMap[c.target_id] ?? `כיתה #${c.target_id}`;
      default:
        return String(c.target_id);
    }
  };

  // Collect unique rule types present in data
  const activeRuleTypes = useMemo(() => {
    const types = new Map<RuleType, number>();
    for (const c of constraints) {
      types.set(c.rule_type, (types.get(c.rule_type) ?? 0) + 1);
    }
    return types;
  }, [constraints]);

  const toggleRuleType = (rt: RuleType) => {
    setExcludedRuleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(rt)) next.delete(rt);
      else next.add(rt);
      return next;
    });
  };

  const filtered = useMemo(() => {
    return constraints.filter((c) => {
      if (categoryFilter && c.category !== categoryFilter) return false;
      if (excludedRuleTypes.has(c.rule_type)) return false;
      return true;
    });
  }, [constraints, categoryFilter, excludedRuleTypes]);

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">גליון אילוצים</h2>
        <p className="text-sm text-muted-foreground mt-1">
          כל האילוצים במערכת בתצוגה אחת
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ConstraintCategory | "")}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground self-center">
            {filtered.length} / {constraints.length} אילוצים
          </span>
          {excludedRuleTypes.size > 0 && (
            <button
              onClick={() => setExcludedRuleTypes(new Set())}
              className="text-xs text-primary hover:underline self-center"
            >
              הצג הכל
            </button>
          )}
        </div>

        {/* Rule type filter chips */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground self-center ml-1">סוגי כללים:</span>
          {[...activeRuleTypes.entries()].map(([rt, count]) => {
            const hidden = excludedRuleTypes.has(rt);
            return (
              <button
                key={rt}
                onClick={() => toggleRuleType(rt)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors cursor-pointer ${
                  hidden
                    ? "bg-muted text-muted-foreground line-through opacity-60"
                    : "bg-card border-border text-foreground hover:bg-accent"
                }`}
              >
                {RULE_TYPE_LABELS[rt] ?? rt}
                <span className="text-muted-foreground">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <DataTable<Constraint>
        compact
        searchable
        searchPlaceholder="חיפוש לפי שם..."
        keyField="id"
        data={filtered}
        columns={[
          {
            header: "פעיל",
            accessor: (c) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMut.mutate({ id: c.id, active: !c.is_active });
                }}
                className="cursor-pointer"
              >
                {c.is_active ? (
                  <ToggleRight className="h-5 w-5 text-primary" />
                ) : (
                  <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
            ),
            className: "w-14",
          },
          {
            header: "שם",
            accessor: "name",
            searchable: true,
          },
          {
            header: "קטגוריה",
            accessor: (c) => (
              <Badge variant="outline">
                {CATEGORY_LABELS[c.category]}
              </Badge>
            ),
            className: "w-24",
          },
          {
            header: "סוג",
            accessor: (c) =>
              c.type === "HARD" ? (
                <Badge variant="default">
                  <span className="flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    חובה
                  </span>
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <span className="flex items-center gap-1">
                    <Feather className="h-3 w-3" />
                    רך
                  </span>
                </Badge>
              ),
            className: "w-24",
          },
          {
            header: "כלל",
            accessor: (c) => RULE_TYPE_LABELS[c.rule_type] ?? c.rule_type,
          },
          {
            header: "יעד",
            accessor: (c) => resolveTarget(c),
          },
          {
            header: "משקל",
            accessor: (c) => (c.type === "SOFT" ? c.weight : "—"),
            className: "w-16",
          },
          {
            header: "פרמטרים",
            accessor: (c) => formatParams(c),
          },
          {
            header: "",
            accessor: (c) => (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(c);
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            ),
            className: "w-12",
          },
        ]}
        emptyMessage="אין אילוצים"
      />

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
