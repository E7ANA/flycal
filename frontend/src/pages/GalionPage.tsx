import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchRequirements, updateRequirement } from "@/api/subjects";
import { fetchSubjects } from "@/api/subjects";
import { fetchClasses } from "@/api/classes";
import { fetchGrades } from "@/api/grades";
import { fetchTeachers, updateTeacher } from "@/api/teachers";
import { fetchGroupingClusters, updateGroupingCluster, updateTrack } from "@/api/groupings";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/common/Badge";
import { computeAllClassHours } from "@/lib/classHours";
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

function TeacherSelect({
  value,
  subjectId,
  teachers,
  onSave,
  onCancel,
}: {
  value: number | null;
  subjectId: number;
  teachers: Teacher[];
  onSave: (teacherId: number | null, needsSubjectAssign: boolean) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string>(value != null ? String(value) : "");
  const cmp = (a: Teacher, b: Teacher) => a.name.localeCompare(b.name, "he");
  const assigned = teachers.filter((t) => t.subject_ids.includes(subjectId)).sort(cmp);
  const unassigned = teachers.filter((t) => !t.subject_ids.includes(subjectId)).sort(cmp);

  const handleSave = () => {
    const tid = selected ? Number(selected) : null;
    const needsAssign = tid != null && unassigned.some((t) => t.id === tid);
    onSave(tid, needsAssign);
  };

  return (
    <div className="flex items-center gap-1">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded border border-input bg-background px-1 py-0.5 text-sm max-w-[200px]"
        autoFocus
      >
        <option value="">לא הוקצה</option>
        {assigned.length > 0 && (
          <optgroup label="מורים של המקצוע">
            {assigned.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        )}
        {unassigned.length > 0 && (
          <optgroup label="מורים אחרים (ישויכו למקצוע)">
            {unassigned.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <button onClick={handleSave} className="text-green-600 hover:text-green-700">
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
    field: "teacher_id" | "hours_per_week" | "morning_priority" | "class_group_id";
  } | null>(null);

  // Inline editing for track teacher within a cluster
  const [editingTrackTeacher, setEditingTrackTeacher] = useState<{
    trackId: number;
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

  const updateTrackMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { teacher_id: number | null } }) =>
      updateTrack(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grouping-clusters", schoolId] });
      toast.success("מורה עודכן");
      setEditingTrackTeacher(null);
    },
    onError: () => toast.error("שגיאה בעדכון"),
  });

  const updateClusterMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      updateGroupingCluster(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clusters", schoolId] });
      toast.success("עודכן");
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
        consecutive_count: cluster.consecutive_count ?? null,
        consecutive_mode: cluster.consecutive_mode ?? null,
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

  // Per-class hours summary (deduplicated)
  const classHoursSummary = useMemo(
    () => computeAllClassHours(requirements, clusters),
    [requirements, clusters],
  );

  // Build summary rows sorted by grade then class name
  const classSummaryRows = useMemo(() => {
    return classes
      .map((c) => ({
        ...c,
        grade: gradeMap[c.grade_id],
        hours: classHoursSummary[c.id] ?? { regular: 0, grouped: 0, shared: 0, total: 0 },
      }))
      .filter((c) => c.hours.total > 0)
      .filter((c) => gradeFilter === "" || c.grade_id === gradeFilter)
      .filter((c) => classFilter === "" || c.id === classFilter)
      .sort((a, b) => {
        const gl = (a.grade?.level ?? 0) - (b.grade?.level ?? 0);
        if (gl !== 0) return gl;
        return a.name.localeCompare(b.name, "he");
      });
  }, [classes, classHoursSummary, gradeMap, gradeFilter, classFilter]);

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
              if (editingCell?.id === r.id && editingCell.field === "class_group_id") {
                return (
                  <InlineSelect
                    value={r.class_group_id}
                    options={classes.map((c) => {
                      const g = gradeMap[c.grade_id];
                      return { value: c.id, label: `${g?.name ?? ""} ${c.name}` };
                    })}
                    onSave={(val) =>
                      updateMut.mutate({
                        id: r.id,
                        payload: { class_group_id: Number(val) },
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
                    setEditingCell({ id: r.id, field: "class_group_id" });
                  }}
                >
                  {classMap[r.class_group_id]?.name ?? "—"}
                </span>
              );
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
              // Grouped: show track teachers from cluster — each clickable
              if (r.is_grouped && r.grouping_cluster_id) {
                const cluster = clusterMap[r.grouping_cluster_id];
                if (!cluster) return "—";
                const tracksWithTeacher = cluster.tracks.filter((t) => t.teacher_id !== null || true);
                if (tracksWithTeacher.length === 0) return "—";
                return (
                  <div className="flex flex-wrap gap-1">
                    {tracksWithTeacher.map((track) => {
                      if (editingTrackTeacher?.trackId === track.id) {
                        return (
                          <TeacherSelect
                            key={track.id}
                            value={track.teacher_id}
                            subjectId={cluster.subject_id}
                            teachers={teachers}
                            onSave={async (tid, needsAssign) => {
                              if (needsAssign && tid != null) {
                                const teacher = teachers.find((t) => t.id === tid);
                                if (teacher) {
                                  await updateTeacher(tid, { subject_ids: [...teacher.subject_ids, cluster.subject_id] });
                                  qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
                                }
                              }
                              updateTrackMut.mutate({ id: track.id, payload: { teacher_id: tid } });
                            }}
                            onCancel={() => setEditingTrackTeacher(null)}
                          />
                        );
                      }
                      const tName = track.teacher_id ? teacherMap[track.teacher_id]?.name : null;
                      return (
                        <span
                          key={track.id}
                          className="cursor-pointer hover:text-primary transition-colors text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTrackTeacher({ trackId: track.id });
                          }}
                          title={`${track.name} — לחץ להחלפת מורה`}
                        >
                          {tName ?? "לא הוקצה"}
                        </span>
                      );
                    })}
                  </div>
                );
              }
              if (editingCell?.id === r.id && editingCell.field === "teacher_id") {
                return (
                  <TeacherSelect
                    value={r.teacher_id}
                    subjectId={r.subject_id}
                    teachers={teachers}
                    onSave={async (tid, needsAssign) => {
                      if (needsAssign && tid != null) {
                        const teacher = teachers.find((t) => t.id === tid);
                        if (teacher) {
                          await updateTeacher(tid, { subject_ids: [...teacher.subject_ids, r.subject_id] });
                          qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
                        }
                      }
                      updateMut.mutate({ id: r.id, payload: { teacher_id: tid } });
                    }}
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
            header: "רציפות",
            accessor: (r) => {
              // Derive current value: requirement fields > cluster fields > always_double
              let currentVal = "";
              if (r.consecutive_count && r.consecutive_mode) {
                currentVal = `${r.consecutive_mode}_${r.consecutive_count}`;
              } else if (r.is_grouped && r.grouping_cluster_id) {
                const cluster = clusterMap[r.grouping_cluster_id];
                if (cluster?.consecutive_count && cluster?.consecutive_mode) {
                  currentVal = `${cluster.consecutive_mode}_${cluster.consecutive_count}`;
                }
              }
              if (!currentVal && r.always_double) {
                currentVal = "hard_2";
              }

              const handleChange = (val: string) => {
                const consecPayload: Record<string, unknown> = val === ""
                  ? { consecutive_count: null, consecutive_mode: null }
                  : { consecutive_count: Number(val.split("_")[1]), consecutive_mode: val.split("_")[0] };

                if (r.is_grouped && r.grouping_cluster_id) {
                  // Always update the cluster itself
                  updateClusterMut.mutate({
                    id: r.grouping_cluster_id,
                    payload: consecPayload,
                  });
                  // Also update any existing grouped requirements
                  const siblings = requirements.filter(
                    (req) => req.grouping_cluster_id === r.grouping_cluster_id,
                  );
                  for (const sib of siblings) {
                    updateMut.mutate({
                      id: sib.id,
                      payload: { ...consecPayload, always_double: false },
                    });
                  }
                } else {
                  updateMut.mutate({
                    id: r.id,
                    payload: { ...consecPayload, always_double: false },
                  });
                }
              };

              return (
                <select
                  value={currentVal}
                  onChange={(e) => handleChange(e.target.value)}
                  className="text-xs border rounded px-1 py-0.5 bg-white cursor-pointer"
                >
                  <option value="">ללא</option>
                  <option value="soft_2">העדפה 2</option>
                  <option value="hard_2">חובה 2</option>
                  <option value="soft_3">העדפה 3</option>
                  <option value="hard_3">חובה 3</option>
                </select>
              );
            },
            className: "w-28 text-center",
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

      {/* Per-class hours breakdown */}
      {classSummaryRows.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-bold mb-3">שעות לפי כיתה</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="px-3 py-2 text-start">שכבה</th>
                  <th className="px-3 py-2 text-start">כיתה</th>
                  <th className="px-3 py-2 text-center">שעות רגילות</th>
                  <th className="px-3 py-2 text-center">שעות הקבצות</th>
                  <th className="px-3 py-2 text-center">שעות משותפים</th>
                  <th className="px-3 py-2 text-center font-bold">סה״כ</th>
                </tr>
              </thead>
              <tbody>
                {classSummaryRows.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5">{c.grade?.name ?? "—"}</td>
                    <td className="px-3 py-1.5 font-medium">{c.name}</td>
                    <td className="px-3 py-1.5 text-center">{c.hours.regular || "—"}</td>
                    <td className="px-3 py-1.5 text-center">{c.hours.grouped || "—"}</td>
                    <td className="px-3 py-1.5 text-center">{c.hours.shared || "—"}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Badge variant="secondary" className="font-bold">{c.hours.total}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
