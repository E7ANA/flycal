import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchRequirements, updateRequirement } from "@/api/subjects";
import { fetchSubjects } from "@/api/subjects";
import { fetchClasses } from "@/api/classes";
import { fetchGrades } from "@/api/grades";
import { fetchTeachers } from "@/api/teachers";
import { fetchGroupingClusters } from "@/api/groupings";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/common/Badge";
import type { SubjectRequirement, Subject, ClassGroup, Grade, Teacher } from "@/types/models";

function InlineSelect({
  value,
  options,
  onSave,
  onCancel,
}: {
  value: string | number;
  options: { value: string | number; label: string }[];
  onSave: (val: string | number) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(value);
  return (
    <div className="flex items-center gap-1">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded border border-input bg-background px-1 py-0.5 text-sm"
        autoFocus
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button onClick={() => onSave(selected)} className="text-green-600 hover:text-green-700">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={onCancel} className="text-red-500 hover:text-red-600">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function InlineNumber({
  value,
  onSave,
  onCancel,
}: {
  value: number;
  onSave: (val: number) => void;
  onCancel: () => void;
}) {
  const [num, setNum] = useState(value);
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={1}
        max={20}
        value={num}
        onChange={(e) => setNum(Number(e.target.value))}
        className="w-14 rounded border border-input bg-background px-1 py-0.5 text-sm"
        autoFocus
      />
      <button onClick={() => onSave(num)} className="text-green-600 hover:text-green-700">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={onCancel} className="text-red-500 hover:text-red-600">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function GalionPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  // Filters
  const [gradeFilter, setGradeFilter] = useState<number | "">("");
  const [classFilter, setClassFilter] = useState<number | "">("");
  const [subjectFilter, setSubjectFilter] = useState<number | "">("");
  const [teacherFilter, setTeacherFilter] = useState<number | "">("");

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{
    id: number;
    field: "teacher_id" | "hours_per_week" | "morning_priority";
  } | null>(null);

  const { data: requirements = [] } = useQuery({
    queryKey: ["requirements", schoolId],
    queryFn: () => fetchRequirements(schoolId!),
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

  const { data: grades = [] } = useQuery({
    queryKey: ["grades", schoolId],
    queryFn: () => fetchGrades(schoolId!),
    enabled: !!schoolId,
  });

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId!),
    enabled: !!schoolId,
  });

  const { data: clusters = [] } = useQuery({
    queryKey: ["grouping-clusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: !!schoolId,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SubjectRequirement> }) =>
      updateRequirement(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      toast.success("עודכן");
      setEditingCell(null);
    },
    onError: () => toast.error("שגיאה בעדכון"),
  });

  const subjectMap = useMemo(
    () => Object.fromEntries(subjects.map((s) => [s.id, s])),
    [subjects],
  );
  const classMap = useMemo(
    () => Object.fromEntries(classes.map((c) => [c.id, c])),
    [classes],
  );
  const gradeMap = useMemo(
    () => Object.fromEntries(grades.map((g) => [g.id, g])),
    [grades],
  );
  const teacherMap = useMemo(
    () => Object.fromEntries(teachers.map((t) => [t.id, t])),
    [teachers],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries(clusters.map((c) => [c.id, c])),
    [clusters],
  );

  // Filter requirements: show non-grouped + one representative per cluster.
  // Also add virtual rows for clusters that have NO grouped requirements
  // (e.g. English groupings defined only via tracks).
  const filteredReqs = useMemo(() => {
    const seenClusters = new Set<number>();
    const rows: SubjectRequirement[] = requirements
      .filter((r) => {
        if (r.is_grouped) {
          if (!r.grouping_cluster_id || seenClusters.has(r.grouping_cluster_id))
            return false;
          seenClusters.add(r.grouping_cluster_id);
        }
        if (gradeFilter !== "") {
          const cls = classMap[r.class_group_id];
          if (!cls || cls.grade_id !== gradeFilter) return false;
        }
        if (classFilter !== "" && !r.is_grouped && r.class_group_id !== classFilter) return false;
        if (subjectFilter !== "" && r.subject_id !== subjectFilter) return false;
        if (teacherFilter !== "" && r.teacher_id !== teacherFilter) return false;
        return true;
      });

    // Add virtual rows for clusters not yet represented
    for (const cluster of clusters) {
      if (seenClusters.has(cluster.id)) continue;
      // Apply grade filter
      if (gradeFilter !== "" && cluster.grade_id !== gradeFilter) continue;
      // Apply subject filter
      if (subjectFilter !== "" && cluster.subject_id !== subjectFilter) continue;
      // Apply teacher filter — check if any track has this teacher
      if (teacherFilter !== "") {
        const hasTeacher = cluster.tracks.some((t) => t.teacher_id === teacherFilter);
        if (!hasTeacher) continue;
      }
      // Use first source class for grade lookup
      const firstClassId = cluster.source_class_ids[0];
      const maxHours = cluster.tracks.length > 0
        ? Math.max(...cluster.tracks.map((t) => t.hours_per_week))
        : 0;
      rows.push({
        id: -cluster.id, // negative to distinguish from real requirements
        school_id: cluster.school_id,
        class_group_id: firstClassId ?? 0,
        subject_id: cluster.subject_id,
        teacher_id: null,
        hours_per_week: maxHours,
        is_grouped: true,
        grouping_cluster_id: cluster.id,
        is_external: false,
        pinned_slots: null,
        co_teacher_ids: null,
        always_double: false,
        morning_priority: null,
      } as SubjectRequirement);
      seenClusters.add(cluster.id);
    }

    return rows.sort((a, b) => {
      // Grouped reqs go after regular ones
      if (a.is_grouped !== b.is_grouped) return a.is_grouped ? 1 : -1;
      const gradeA = classMap[a.class_group_id]?.grade_id ?? 0;
      const gradeB = classMap[b.class_group_id]?.grade_id ?? 0;
      if (gradeA !== gradeB) return gradeA - gradeB;
      const classA = classMap[a.class_group_id]?.name ?? "";
      const classB = classMap[b.class_group_id]?.name ?? "";
      if (classA !== classB) return classA.localeCompare(classB, "he");
      return (subjectMap[a.subject_id]?.name ?? "").localeCompare(
        subjectMap[b.subject_id]?.name ?? "",
        "he",
      );
    });
  }, [requirements, clusters, gradeFilter, classFilter, subjectFilter, teacherFilter, classMap, subjectMap]);

  const totalHours = filteredReqs.reduce((sum, r) => sum + r.hours_per_week, 0);

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">גליון</h2>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={gradeFilter}
          onChange={(e) => {
            setGradeFilter(e.target.value ? Number(e.target.value) : "");
            setClassFilter("");
          }}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <option value="">כל השכבות</option>
          {grades
            .sort((a, b) => a.level - b.level)
            .map((g) => (
              <option key={g.id} value={g.id}>
                שכבה {g.name}
              </option>
            ))}
        </select>

        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value ? Number(e.target.value) : "")}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <option value="">כל הכיתות</option>
          {classes
            .filter((c) => gradeFilter === "" || c.grade_id === gradeFilter)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>

        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value ? Number(e.target.value) : "")}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <option value="">כל המקצועות</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          value={teacherFilter}
          onChange={(e) => setTeacherFilter(e.target.value ? Number(e.target.value) : "")}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <option value="">כל המורים</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable<SubjectRequirement>
        compact
        searchable
        searchPlaceholder="חיפוש..."
        keyField="id"
        data={filteredReqs}
        columns={[
          {
            header: "שכבה",
            accessor: (r) => {
              const cls = classMap[r.class_group_id];
              const grade = cls ? gradeMap[cls.grade_id] : null;
              return grade?.name ?? "—";
            },
          },
          {
            header: "כיתה",
            accessor: (r) => {
              if (r.is_grouped && r.grouping_cluster_id) {
                const cluster = clusterMap[r.grouping_cluster_id];
                return (
                  <span className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">הקבצה</Badge>
                    {cluster?.name ?? "—"}
                  </span>
                );
              }
              return classMap[r.class_group_id]?.name ?? "—";
            },
          },
          {
            header: "מקצוע",
            accessor: (r) => {
              const subj = subjectMap[r.subject_id];
              if (!subj) return "—";
              return (
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: subj.color ?? "#ccc" }}
                  />
                  {subj.name}
                </span>
              );
            },
          },
          {
            header: "מורה",
            accessor: (r) => {
              // Grouped: show track teachers from cluster
              if (r.is_grouped && r.grouping_cluster_id) {
                const cluster = clusterMap[r.grouping_cluster_id];
                if (!cluster) return "—";
                const names = cluster.tracks
                  .map((t) => t.teacher_id ? teacherMap[t.teacher_id]?.name : null)
                  .filter(Boolean);
                return (
                  <span className="text-muted-foreground text-xs">
                    {names.length > 0 ? names.join(", ") : "—"}
                  </span>
                );
              }
              if (editingCell?.id === r.id && editingCell.field === "teacher_id") {
                return (
                  <InlineSelect
                    value={r.teacher_id ?? ""}
                    options={[
                      { value: "", label: "לא הוקצה" },
                      ...teachers.map((t) => ({ value: t.id, label: t.name })),
                    ]}
                    onSave={(val) =>
                      updateMut.mutate({
                        id: r.id,
                        payload: { teacher_id: val ? Number(val) : null },
                      })
                    }
                    onCancel={() => setEditingCell(null)}
                  />
                );
              }
              const name = r.teacher_id ? teacherMap[r.teacher_id]?.name : null;
              const coNames = (r.co_teacher_ids ?? [])
                .map((id) => teacherMap[id]?.name)
                .filter(Boolean);
              const display = coNames.length > 0
                ? `${name ?? "לא הוקצה"} + ${coNames.join(", ")}`
                : (name ?? "לא הוקצה");
              return (
                <span
                  className="cursor-pointer hover:text-primary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCell({ id: r.id, field: "teacher_id" });
                  }}
                >
                  {display}
                </span>
              );
            },
          },
          {
            header: "שעות",
            accessor: (r) => {
              if (editingCell?.id === r.id && editingCell.field === "hours_per_week") {
                return (
                  <InlineNumber
                    value={r.hours_per_week}
                    onSave={(val) =>
                      updateMut.mutate({
                        id: r.id,
                        payload: { hours_per_week: val },
                      })
                    }
                    onCancel={() => setEditingCell(null)}
                  />
                );
              }
              return (
                <span
                  className="cursor-pointer hover:text-primary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCell({ id: r.id, field: "hours_per_week" });
                  }}
                >
                  {r.hours_per_week}
                </span>
              );
            },
            className: "w-20",
          },
          {
            header: "סוג",
            accessor: (r) =>
              r.is_external ? (
                <Badge variant="secondary">חיצוני</Badge>
              ) : (
                <Badge variant="default">רגיל</Badge>
              ),
            className: "w-20",
          },
          {
            header: "שעה כפולה",
            accessor: (r) => (
              <input
                type="checkbox"
                checked={r.always_double}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (r.is_grouped && r.grouping_cluster_id) {
                    // Update ALL grouped reqs in this cluster
                    const siblings = requirements.filter(
                      (req) => req.grouping_cluster_id === r.grouping_cluster_id,
                    );
                    for (const sib of siblings) {
                      updateMut.mutate({
                        id: sib.id,
                        payload: { always_double: checked },
                      });
                    }
                  } else {
                    updateMut.mutate({
                      id: r.id,
                      payload: { always_double: checked },
                    });
                  }
                }}
                className="h-4 w-4 accent-primary cursor-pointer"
                title={r.always_double ? "תמיד בשעה כפולה" : "ללא הגבלה"}
              />
            ),
            className: "w-24 text-center",
          },
          {
            header: "חשיבות בוקר",
            accessor: (r) => {
              const subj = subjectMap[r.subject_id];
              const effective = r.morning_priority ?? subj?.morning_priority ?? null;
              if (editingCell?.id === r.id && editingCell.field === "morning_priority") {
                return (
                  <InlineNumber
                    value={r.morning_priority ?? 0}
                    onSave={(val) =>
                      updateMut.mutate({
                        id: r.id,
                        payload: { morning_priority: val || null },
                      })
                    }
                    onCancel={() => setEditingCell(null)}
                  />
                );
              }
              return (
                <span
                  className="cursor-pointer hover:text-primary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCell({ id: r.id, field: "morning_priority" });
                  }}
                  title={
                    r.morning_priority != null
                      ? `דרישה: ${r.morning_priority}`
                      : subj?.morning_priority != null
                        ? `ירושה ממקצוע: ${subj.morning_priority}`
                        : "לא מוגדר"
                  }
                >
                  {effective != null ? (
                    <Badge variant={r.morning_priority != null ? "default" : "secondary"}>
                      {effective}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              );
            },
            className: "w-28",
          },
        ]}
        emptyMessage="אין דרישות מקצועות"
      />

      {/* Summary */}
      <div className="flex gap-6 text-sm text-muted-foreground">
        <span>סה״כ דרישות: {filteredReqs.length}</span>
        <span>סה״כ שעות: {totalHours}</span>
      </div>
    </div>
  );
}
