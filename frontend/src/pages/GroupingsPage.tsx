import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ChevronDown, ChevronLeft, Undo2, X, Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  fetchGroupingClusters,
  createGroupingCluster,
  updateGroupingCluster,
  deleteGroupingCluster,
  fetchTracks,
  createTrack,
  createTrackFromRequirement,
  convertTrackToRequirement,
  updateTrack,
  deleteTrack,
  fetchTrackAvailableSlots,
  type ClusterResponse,
} from "@/api/groupings";
import {
  fetchSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  fetchRequirements,
  createRequirement,
  updateRequirement,
  deleteRequirement,
} from "@/api/subjects";
import { fetchClasses } from "@/api/classes";
import { fetchGrades } from "@/api/grades";
import { fetchTeachers } from "@/api/teachers";
import { Button } from "@/components/common/Button";
import { DataTable } from "@/components/common/DataTable";
import { ClassAccordion } from "@/components/common/ClassAccordion";
import { PinGrid } from "@/components/common/PinGrid";

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
import { Badge } from "@/components/common/Badge";
import { MultiClassPicker } from "@/components/common/MultiClassPicker";
import { InlineConstraints } from "@/components/common/InlineConstraints";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";
import type { Track, Subject, Teacher, Grade, ClassGroup, SubjectRequirement, PinnedSlot, BlockedSlot } from "@/types/models";
import { SUBJECT_COLORS, getSubjectColor } from "@/lib/subjectColors";

type TabId = "subjects" | "requirements" | "shared";

const TABS: { id: TabId; label: string }[] = [
  { id: "subjects", label: "מקצועות" },
  { id: "requirements", label: "דרישות" },
  { id: "shared", label: "שיעורים משותפים" },
];

// ─── Requirement Form ────────────────────────────────────
function RequirementFormDialog({
  open,
  onClose,
  requirement,
  schoolId,
  fixedClassGroupId,
}: {
  open: boolean;
  onClose: () => void;
  requirement: SubjectRequirement | null;
  schoolId: number;
  fixedClassGroupId?: number;
}) {
  const qc = useQueryClient();
  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId),
  });
  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId),
  });
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId),
  });

  const [classGroupId, setClassGroupId] = useState(
    requirement?.class_group_id ?? fixedClassGroupId ?? (classes[0]?.id ?? 0),
  );
  const [subjectId, setSubjectId] = useState(
    requirement?.subject_id ?? (subjects[0]?.id ?? 0),
  );
  const [teacherId, setTeacherId] = useState<number | "">(
    requirement?.teacher_id ?? "",
  );
  const [hours, setHours] = useState(requirement?.hours_per_week ?? 1);
  const [isExternal, setIsExternal] = useState(requirement?.is_external ?? false);
  const [pinnedSlots, setPinnedSlots] = useState<PinnedSlot[]>(
    requirement?.pinned_slots ?? [],
  );
  const [blockedSlots, setBlockedSlots] = useState<PinnedSlot[]>(
    requirement?.blocked_slots ?? [],
  );
  const [coTeacherIds, setCoTeacherIds] = useState<number[]>(
    requirement?.co_teacher_ids ?? [],
  );

  const classLocked = !!requirement || !!fixedClassGroupId;

  const createMut = useMutation({
    mutationFn: async () => {
      await autoAssignIfNeeded();
      return createRequirement({
        school_id: schoolId,
        class_group_id: classGroupId,
        subject_id: subjectId,
        teacher_id: teacherId === "" ? null : teacherId,
        hours_per_week: hours,
        is_grouped: false,
        grouping_cluster_id: null,
        is_external: isExternal,
        pinned_slots: pinnedSlots.length > 0 ? pinnedSlots : null,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        co_teacher_ids: coTeacherIds.length > 0 ? coTeacherIds : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      toast.success("דרישה נוספה");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת דרישה"),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      await autoAssignIfNeeded();
      return updateRequirement(requirement!.id, {
        teacher_id: teacherId === "" ? null : teacherId,
        hours_per_week: hours,
        is_external: isExternal,
        pinned_slots: pinnedSlots.length > 0 ? pinnedSlots : null,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        co_teacher_ids: coTeacherIds.length > 0 ? coTeacherIds : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      toast.success("דרישה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון דרישה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  // Filter teachers by selected subject — split into assigned and unassigned
  const cmpTeacher = (a: Teacher, b: Teacher) => a.name.localeCompare(b.name, "he");
  const assignedTeachers = teachers.filter((t) => t.subject_ids.includes(subjectId)).sort(cmpTeacher);
  const unassignedTeachers = teachers.filter((t) => !t.subject_ids.includes(subjectId)).sort(cmpTeacher);

  // Auto-assign teacher to subject if needed
  const autoAssignIfNeeded = async () => {
    const tid = teacherId === "" ? null : teacherId;
    if (tid && unassignedTeachers.some((t) => t.id === tid)) {
      const { updateTeacher } = await import("@/api/teachers");
      const teacher = teachers.find((t) => t.id === tid);
      if (teacher) {
        await updateTeacher(tid, { subject_ids: [...teacher.subject_ids, subjectId] });
        qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
      }
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          {requirement ? "עריכת דרישה" : "דרישה חדשה"}
        </DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          requirement ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="req-class">כיתה</Label>
          <Select
            id="req-class"
            value={classGroupId}
            onChange={(e) => setClassGroupId(Number(e.target.value))}
            disabled={classLocked}
            required
          >
            <option value="">בחר כיתה</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="req-subject">מקצוע</Label>
          <Select
            id="req-subject"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(Number(e.target.value));
              setTeacherId("");
            }}
            disabled={!!requirement}
            required
          >
            <option value="">בחר מקצוע</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="req-teacher">מורה</Label>
          <Select
            id="req-teacher"
            value={teacherId}
            onChange={(e) =>
              setTeacherId(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">לא הוקצה</option>
            {assignedTeachers.length > 0 && (
              <optgroup label="מורים של המקצוע">
                {assignedTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
            {unassignedTeachers.length > 0 && (
              <optgroup label="מורים אחרים (ישויכו למקצוע)">
                {unassignedTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div>
          <Label>מורים משותפים (co-teaching)</Label>
          <div className="space-y-1">
            {teachers
              .filter(
                (t) =>
                  t.id !== teacherId &&
                  !coTeacherIds.includes(t.id),
              )
              .length > 0 && (
              <Select
                value=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) setCoTeacherIds([...coTeacherIds, id]);
                }}
              >
                <option value="">+ הוסף מורה משותף</option>
                {teachers
                  .filter(
                    (t) =>
                      t.id !== teacherId &&
                      !coTeacherIds.includes(t.id),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            )}
            {coTeacherIds.map((tid) => {
              const t = teachers.find((t) => t.id === tid);
              return (
                <div key={tid} className="flex items-center gap-2 text-sm">
                  <span>{t?.name ?? `#${tid}`}</span>
                  <button
                    type="button"
                    className="text-destructive hover:underline text-xs"
                    onClick={() =>
                      setCoTeacherIds(coTeacherIds.filter((id) => id !== tid))
                    }
                  >
                    הסר
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <Label htmlFor="req-hours">שעות שבועיות</Label>
          <Input
            id="req-hours"
            type="number"
            min={1}
            max={20}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            required
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="req-external"
            type="checkbox"
            checked={isExternal}
            onChange={(e) => setIsExternal(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <Label htmlFor="req-external">מקצוע חוץ-לימודי (לא חוסם את הכיתה)</Label>
        </div>
        <div>
          <Label>נעילה / חסימה</Label>
          <PinGrid
            reqId={requirement?.id ?? 0}
            maxPins={hours}
            pinnedSlots={pinnedSlots}
            onChange={setPinnedSlots}
            blockedSlots={blockedSlots}
            onBlockedChange={setBlockedSlots}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : requirement ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Cluster Form ────────────────────────────────────────
function ClusterFormDialog({
  open,
  onClose,
  onSaved,
  cluster,
  schoolId,
  subjects,
  grades,
  currentTracks,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (clusterId: number) => void;
  cluster: ClusterResponse | null;
  schoolId: number;
  subjects: Subject[];
  grades: Grade[];
  currentTracks: Track[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(cluster?.name ?? "");
  const [subjectId, setSubjectId] = useState(
    cluster?.subject_id ?? (subjects[0]?.id ?? 0),
  );
  const [gradeId, setGradeId] = useState<number | "">(
    cluster?.grade_id ?? "",
  );
  const [trackCount, setTrackCount] = useState(
    cluster ? currentTracks.length : 1,
  );

  const saveMut = useMutation({
    mutationFn: async (): Promise<number> => {
      let clusterId: number;

      if (cluster) {
        // Update cluster
        await updateGroupingCluster(cluster.id, {
          name,
          subject_id: subjectId,
          grade_id: gradeId === "" ? undefined : gradeId,
        });
        clusterId = cluster.id;

        // Sync tracks: add or remove to match trackCount
        if (trackCount > currentTracks.length) {
          for (let i = currentTracks.length; i < trackCount; i++) {
            await createTrack({
              name: `רמה ${i + 1}`,
              cluster_id: clusterId,
              teacher_id: null,
              hours_per_week: 1,
            });
          }
        } else if (trackCount < currentTracks.length) {
          const toRemove = currentTracks.slice(trackCount);
          for (const t of toRemove) {
            await deleteTrack(t.id);
          }
        }
      } else {
        // Create cluster, then create tracks
        const created = await createGroupingCluster({
          school_id: schoolId,
          name,
          subject_id: subjectId,
          grade_id: gradeId === "" ? undefined : gradeId,
        });
        clusterId = created.id;

        for (let i = 0; i < trackCount; i++) {
          await createTrack({
            name: `רמה ${i + 1}`,
            cluster_id: clusterId,
            teacher_id: null,
            hours_per_week: 1,
          });
        }
      }

      return clusterId;
    },
    onSuccess: (clusterId) => {
      qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
      qc.invalidateQueries({ queryKey: ["tracks"] });
      toast.success(cluster ? "הקבצה עודכנה" : "הקבצה נוצרה בהצלחה");
      onSaved(clusterId);
    },
    onError: () =>
      toast.error(cluster ? "שגיאה בעדכון הקבצה" : "שגיאה ביצירת הקבצה"),
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          {cluster ? "עריכת הקבצה" : "הקבצה חדשה"}
        </DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="cluster-name">שם</Label>
          <Input
            id="cluster-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: הקבצת מתמטיקה ט'
            required
          />
        </div>
        <div>
          <Label htmlFor="cluster-subject">מקצוע</Label>
          <Select
            id="cluster-subject"
            value={subjectId}
            onChange={(e) => setSubjectId(Number(e.target.value))}
            required
          >
            <option value="">בחר מקצוע</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cluster-grade">שכבה</Label>
          <Select
            id="cluster-grade"
            value={gradeId}
            onChange={(e) => setGradeId(e.target.value ? Number(e.target.value) : "")}
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
        <div>
          <Label htmlFor="cluster-tracks">מספר רמות</Label>
          <Input
            id="cluster-tracks"
            type="number"
            min={1}
            max={10}
            value={trackCount}
            onChange={(e) => setTrackCount(Number(e.target.value))}
            required
          />
          {cluster && trackCount < currentTracks.length && (
            <p className="mt-1 text-xs text-destructive">
              {currentTracks.length - trackCount} רמות יימחקו
            </p>
          )}
          {cluster && trackCount > currentTracks.length && (
            <p className="mt-1 text-xs text-muted-foreground">
              {trackCount - currentTracks.length} רמות חדשות ייווצרו
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={saveMut.isPending}>
            {saveMut.isPending ? "שומר..." : cluster ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Track Form ──────────────────────────────────────────
function TrackFormDialog({
  open,
  onClose,
  track,
  clusterId,
  subjectId,
  teachers,
  schoolId,
  siblingTracks,
  sourceClasses,
}: {
  open: boolean;
  onClose: () => void;
  track: Track | null;
  clusterId: number;
  subjectId: number;
  teachers: Teacher[];
  schoolId: number;
  siblingTracks: Track[];
  sourceClasses: ClassGroup[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(track?.name ?? "");
  const [teacherId, setTeacherId] = useState<number | "">(
    track?.teacher_id ?? "",
  );
  const [hours, setHours] = useState(track?.hours_per_week ?? 1);
  const [linkGroup, setLinkGroup] = useState<number | "">(
    track?.link_group ?? "",
  );
  const [sourceClassId, setSourceClassId] = useState<number | "">(
    track?.source_class_id ?? "",
  );
  const [pinnedSlots, setPinnedSlots] = useState<{ day: string; period: number }[]>(
    track?.pinned_slots ?? [],
  );
  const [blockedSlots, setBlockedSlots] = useState<{ day: string; period: number }[]>(
    track?.blocked_slots ?? [],
  );

  const cmpT = (a: Teacher, b: Teacher) => a.name.localeCompare(b.name, "he");
  const assignedTeachers = teachers.filter((t) => t.subject_ids.includes(subjectId)).sort(cmpT);
  const unassignedTeachers = teachers.filter((t) => !t.subject_ids.includes(subjectId)).sort(cmpT);

  const autoAssignIfNeeded = async () => {
    const tid = teacherId === "" ? null : teacherId;
    if (tid && unassignedTeachers.some((t) => t.id === tid)) {
      const { updateTeacher } = await import("@/api/teachers");
      const teacher = teachers.find((t) => t.id === tid);
      if (teacher) {
        await updateTeacher(Number(tid), { subject_ids: [...teacher.subject_ids, subjectId] });
        qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
      }
    }
  };

  const createMut = useMutation({
    mutationFn: async () => {
      await autoAssignIfNeeded();
      return createTrack({
        name,
        cluster_id: clusterId,
        teacher_id: teacherId === "" ? null : teacherId,
        hours_per_week: hours,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
      toast.success("רמה נוספה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת רמה"),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      await autoAssignIfNeeded();
      return updateTrack(track!.id, {
        name,
        teacher_id: teacherId === "" ? null : teacherId,
        hours_per_week: hours,
        link_group: linkGroup === "" ? null : linkGroup,
        source_class_id: sourceClassId === "" ? null : sourceClassId,
        pinned_slots: pinnedSlots.length > 0 ? pinnedSlots : null,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      toast.success("רמה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון רמה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          {track ? "עריכת רמה" : "רמה חדשה"}
        </DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          track ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="track-name">שם</Label>
          <Input
            id="track-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: 5 יח'
            required
          />
        </div>
        <div>
          <Label htmlFor="track-teacher">מורה</Label>
          <Select
            id="track-teacher"
            value={teacherId}
            onChange={(e) =>
              setTeacherId(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">לא הוקצה</option>
            {assignedTeachers.length > 0 && (
              <optgroup label="מורים של המקצוע">
                {assignedTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
            {unassignedTeachers.length > 0 && (
              <optgroup label="מורים אחרים (ישויכו למקצוע)">
                {unassignedTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div>
          <Label htmlFor="track-hours">שעות שבועיות</Label>
          <Input
            id="track-hours"
            type="number"
            min={1}
            max={20}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            required
          />
        </div>
        {siblingTracks.length > 0 && (
          <div>
            <Label htmlFor="track-link-group">קישור רמות (אותם תלמידים)</Label>
            <Select
              id="track-link-group"
              value={linkGroup}
              onChange={(e) =>
                setLinkGroup(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">ללא קישור</option>
              {(() => {
                // Collect existing link_groups from siblings
                const existingGroups = new Set<number>();
                for (const s of siblingTracks) {
                  if (s.link_group != null && s.id !== track?.id) {
                    existingGroups.add(s.link_group);
                  }
                }
                // Also suggest a new group number
                const maxGroup = existingGroups.size > 0 ? Math.max(...existingGroups) : 0;
                const newGroupNum = maxGroup + 1;
                const options: { value: number; label: string }[] = [];
                for (const g of existingGroups) {
                  const members = siblingTracks
                    .filter((s) => s.link_group === g && s.id !== track?.id)
                    .map((s) => s.name);
                  options.push({
                    value: g,
                    label: `קבוצה ${g} (${members.join(", ")})`,
                  });
                }
                options.push({ value: newGroupNum, label: `קבוצה חדשה (${newGroupNum})` });
                return options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ));
              })()}
            </Select>
            <span className="text-xs text-muted-foreground">
              רמות מקושרות = אותם תלמידים, לא יתוזמנו בו-זמנית
            </span>
          </div>
        )}
        {sourceClasses.length > 0 && (
          <div>
            <Label htmlFor="track-source-class">כיתת מקור</Label>
            <Select
              id="track-source-class"
              value={sourceClassId}
              onChange={(e) =>
                setSourceClassId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">כל הכיתות (משותף)</option>
              {sourceClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <span className="text-xs text-muted-foreground">
              כיתה ספציפית = חוסם רק אותה בזמני הרמה
            </span>
          </div>
        )}
        {track && teacherId && (
          <div>
            <Label>נעילה / חסימה</Label>
            <PinGrid
              reqId={track.id}
              maxPins={hours}
              pinnedSlots={pinnedSlots}
              onChange={setPinnedSlots}
              blockedSlots={blockedSlots}
              onBlockedChange={setBlockedSlots}
              fetchSlots={fetchTrackAvailableSlots}
              queryKeyPrefix="track-available-slots"
            />
          </div>
        )}
        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : track ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Requirement Picker ─────────────────────────────────
function RequirementPickerDialog({
  open,
  onClose,
  clusterId,
  gradeId,
  schoolId,
  requirements,
  subjects,
  teachers,
  classes,
  grades,
  existingTracks,
}: {
  open: boolean;
  onClose: () => void;
  clusterId: number;
  gradeId: number | null;
  schoolId: number;
  requirements: SubjectRequirement[];
  subjects: Subject[];
  teachers: Teacher[];
  classes: ClassGroup[];
  grades: Grade[];
  existingTracks: Track[];
}) {
  const qc = useQueryClient();
  const subjectMap = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const teacherMap = Object.fromEntries(teachers.map((t) => [t.id, t.name]));
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c]));

  // Already-imported requirement IDs (from tracks in this cluster)
  const importedReqIds = new Set(
    existingTracks
      .filter((t) => t.requirement_id != null)
      .map((t) => t.requirement_id!),
  );

  // Available requirements: ungrouped, from the same grade, not already imported
  const gradeClassIds = gradeId
    ? new Set(classes.filter((c) => c.grade_id === gradeId).map((c) => c.id))
    : new Set(classes.map((c) => c.id));

  const available = requirements.filter(
    (r) =>
      !r.is_grouped &&
      gradeClassIds.has(r.class_group_id) &&
      !importedReqIds.has(r.id),
  );

  // Group by subject for easier browsing
  const bySubject = new Map<number, SubjectRequirement[]>();
  for (const r of available) {
    const list = bySubject.get(r.subject_id) ?? [];
    list.push(r);
    bySubject.set(r.subject_id, list);
  }

  const addMut = useMutation({
    mutationFn: (requirementId: number) =>
      createTrackFromRequirement({
        cluster_id: clusterId,
        requirement_id: requirementId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
      toast.success("דרישה נוספה כרמה בהקבצה");
    },
    onError: () => toast.error("שגיאה בהוספת דרישה"),
  });

  const gradeName = gradeId
    ? grades.find((g) => g.id === gradeId)?.name
    : null;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          הוסף דרישה קיימת כרמה
          {gradeName && ` — שכבה ${gradeName}`}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            אין דרישות זמינות להוספה (כולן כבר שייכות להקבצות)
          </p>
        ) : (
          [...bySubject.entries()].map(([subjectId, reqs]) => {
            const subject = subjectMap[subjectId];
            return (
              <div key={subjectId} className="space-y-1">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  {subject && (() => {
                    const sc = getSubjectColor(subject.color);
                    return (
                      <span
                        className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: sc.bg, color: sc.text }}
                      >
                        {sc.label}
                      </span>
                    );
                  })()}
                  {subject?.name ?? `מקצוע ${subjectId}`}
                </h4>
                {reqs.map((r) => {
                  const cls = classMap[r.class_group_id];
                  const teacherName = r.teacher_id
                    ? teacherMap[r.teacher_id] ?? "—"
                    : "לא הוקצה";
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-medium">{cls?.name ?? "—"}</span>
                        <span className="text-muted-foreground">
                          {teacherName}
                        </span>
                        <span className="text-muted-foreground">
                          {r.hours_per_week} שעות
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addMut.mutate(r.id)}
                        disabled={addMut.isPending}
                      >
                        <Plus className="h-3 w-3" />
                        הוסף
                      </Button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          סגור
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ─── Shared Lesson Form ─────────────────────────────────
function SharedLessonFormDialog({
  open,
  onClose,
  schoolId,
  subjects,
  teachers,
  grades,
  classes,
}: {
  open: boolean;
  onClose: () => void;
  schoolId: number;
  subjects: Subject[];
  teachers: Teacher[];
  grades: Grade[];
  classes: ClassGroup[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? 0);
  const [teacherId, setTeacherId] = useState<number | "">(  "");
  const [hours, setHours] = useState(1);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);

  const cmpT = (a: Teacher, b: Teacher) => a.name.localeCompare(b.name, "he");
  const assignedTeachers = teachers.filter((t) => t.subject_ids.includes(subjectId)).sort(cmpT);
  const unassignedTeachers = teachers.filter((t) => !t.subject_ids.includes(subjectId)).sort(cmpT);

  const saveMut = useMutation({
    mutationFn: async () => {
      // Auto-assign teacher to subject if needed
      if (teacherId !== "" && unassignedTeachers.some((t) => t.id === teacherId)) {
        const { updateTeacher } = await import("@/api/teachers");
        const teacher = teachers.find((t) => t.id === teacherId);
        if (teacher) {
          await updateTeacher(Number(teacherId), { subject_ids: [...teacher.subject_ids, subjectId] });
          qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
        }
      }
      return createGroupingCluster({
        school_id: schoolId,
        name,
        subject_id: subjectId,
        cluster_type: "SHARED_LESSON",
        teacher_id: teacherId === "" ? null : teacherId,
        hours_per_week: hours,
        source_class_ids: selectedClassIds,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
      qc.invalidateQueries({ queryKey: ["tracks"] });
      toast.success("שיעור משותף נוצר בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת שיעור משותף"),
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>שיעור משותף חדש</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="shared-name">שם</Label>
          <Input
            id="shared-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: קומי אורי ז1+ז2'
            required
          />
        </div>
        <div>
          <Label htmlFor="shared-subject">מקצוע</Label>
          <Select
            id="shared-subject"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(Number(e.target.value));
              setTeacherId("");
            }}
            required
          >
            <option value="">בחר מקצוע</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="shared-teacher">מורה</Label>
          <Select
            id="shared-teacher"
            value={teacherId}
            onChange={(e) =>
              setTeacherId(e.target.value ? Number(e.target.value) : "")
            }
            required
          >
            <option value="">בחר מורה</option>
            {assignedTeachers.length > 0 && (
              <optgroup label="מורים של המקצוע">
                {assignedTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
            {unassignedTeachers.length > 0 && (
              <optgroup label="מורים אחרים (ישויכו למקצוע)">
                {unassignedTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div>
          <Label htmlFor="shared-hours">שעות שבועיות</Label>
          <Input
            id="shared-hours"
            type="number"
            min={1}
            max={20}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            required
          />
        </div>
        <div>
          <Label>כיתות (לפחות 2)</Label>
          <MultiClassPicker
            grades={grades}
            classes={classes}
            selectedIds={selectedClassIds}
            onChange={setSelectedClassIds}
          />
          {selectedClassIds.length > 0 && selectedClassIds.length < 2 && (
            <p className="mt-1 text-xs text-destructive">
              יש לבחור לפחות 2 כיתות
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            disabled={saveMut.isPending || selectedClassIds.length < 2 || teacherId === ""}
          >
            {saveMut.isPending ? "שומר..." : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Cross-Grade Cluster Form ───────────────────────────
function CrossGradeFormDialog({
  open,
  onClose,
  onSaved,
  schoolId,
  subjects,
  grades,
  classes,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (clusterId: number) => void;
  schoolId: number;
  subjects: Subject[];
  grades: Grade[];
  classes: ClassGroup[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? 0);
  const [trackCount, setTrackCount] = useState(2);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);

  const saveMut = useMutation({
    mutationFn: async (): Promise<number> => {
      const created = await createGroupingCluster({
        school_id: schoolId,
        name,
        subject_id: subjectId,
        cluster_type: "CROSS_GRADE",
        source_class_ids: selectedClassIds,
      });
      for (let i = 0; i < trackCount; i++) {
        await createTrack({
          name: `רמה ${i + 1}`,
          cluster_id: created.id,
          teacher_id: null,
          hours_per_week: 1,
        });
      }
      return created.id;
    },
    onSuccess: (clusterId) => {
      qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
      qc.invalidateQueries({ queryKey: ["tracks"] });
      toast.success("הקבצה בין-שכבתית נוצרה בהצלחה");
      onSaved(clusterId);
    },
    onError: () => toast.error("שגיאה ביצירת הקבצה בין-שכבתית"),
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>הקבצה בין-שכבתית חדשה</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="cross-name">שם</Label>
          <Input
            id="cross-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: הקבצת אנגלית ח-ט'
            required
          />
        </div>
        <div>
          <Label htmlFor="cross-subject">מקצוע</Label>
          <Select
            id="cross-subject"
            value={subjectId}
            onChange={(e) => setSubjectId(Number(e.target.value))}
            required
          >
            <option value="">בחר מקצוע</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>כיתות (לפחות 2, ממספר שכבות)</Label>
          <MultiClassPicker
            grades={grades}
            classes={classes}
            selectedIds={selectedClassIds}
            onChange={setSelectedClassIds}
          />
          {selectedClassIds.length > 0 && selectedClassIds.length < 2 && (
            <p className="mt-1 text-xs text-destructive">
              יש לבחור לפחות 2 כיתות
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="cross-tracks">מספר רמות</Label>
          <Input
            id="cross-tracks"
            type="number"
            min={1}
            max={10}
            value={trackCount}
            onChange={(e) => setTrackCount(Number(e.target.value))}
            required
          />
        </div>
        <DialogFooter>
          <Button
            type="submit"
            disabled={saveMut.isPending || selectedClassIds.length < 2}
          >
            {saveMut.isPending ? "שומר..." : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Subject Form ────────────────────────────────────────
function SubjectFormDialog({
  open,
  onClose,
  subject,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(subject?.name ?? "");
  const [color, setColor] = useState(subject?.color ?? "blue");
  const [alwaysDouble, setAlwaysDouble] = useState(subject?.always_double ?? false);
  const [limitLastPeriods, setLimitLastPeriods] = useState(subject?.limit_last_periods ?? false);
  const [doublePriority, setDoublePriority] = useState<string>(
    subject?.double_priority != null ? String(subject.double_priority) : "",
  );
  const [morningPriority, setMorningPriority] = useState<string>(
    subject?.morning_priority != null ? String(subject.morning_priority) : "",
  );
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>(subject?.blocked_slots ?? []);
  const [blockDay, setBlockDay] = useState("");
  const [blockPeriod, setBlockPeriod] = useState("");
  const [linkGroup, setLinkGroup] = useState(subject?.link_group ?? "");
  const [linkGroupMaxPerDay, setLinkGroupMaxPerDay] = useState<string>(
    subject?.link_group_max_per_day != null ? String(subject.link_group_max_per_day) : "",
  );

  const addBlockedSlot = () => {
    if (!blockDay || !blockPeriod) return;
    const p = Number(blockPeriod);
    if (blockedSlots.some((s) => s.day === blockDay && s.period === p)) return;
    setBlockedSlots([...blockedSlots, { day: blockDay, period: p }]);
    setBlockPeriod("");
  };

  const removeBlockedSlot = (day: string, period: number) => {
    setBlockedSlots(blockedSlots.filter((s) => !(s.day === day && s.period === period)));
  };

  const createMut = useMutation({
    mutationFn: () =>
      createSubject({
        school_id: schoolId,
        name,
        color,
        double_priority: doublePriority !== "" ? Number(doublePriority) : null,
        morning_priority: morningPriority !== "" ? Number(morningPriority) : null,
        always_double: alwaysDouble,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        limit_last_periods: limitLastPeriods,
        link_group: linkGroup || null,
        link_group_max_per_day: linkGroupMaxPerDay !== "" ? Number(linkGroupMaxPerDay) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
      toast.success("מקצוע נוסף בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת מקצוע"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateSubject(subject!.id, {
        name,
        color,
        double_priority: doublePriority !== "" ? Number(doublePriority) : null,
        morning_priority: morningPriority !== "" ? Number(morningPriority) : null,
        always_double: alwaysDouble,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        limit_last_periods: limitLastPeriods,
        link_group: linkGroup || null,
        link_group_max_per_day: linkGroupMaxPerDay !== "" ? Number(linkGroupMaxPerDay) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
      toast.success("מקצוע עודכן");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון מקצוע"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{subject ? "עריכת מקצוע" : "מקצוע חדש"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          subject ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="subj-name">שם</Label>
          <Input id="subj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: מתמטיקה" required />
        </div>
        <div>
          <Label>צבע</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {SUBJECT_COLORS.map((sc) => (
              <button
                key={sc.key}
                type="button"
                onClick={() => setColor(sc.key)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer"
                style={{
                  backgroundColor: sc.bg,
                  color: sc.text,
                  border: color === sc.key ? `2px solid ${sc.text}` : "2px solid transparent",
                  transform: color === sc.key ? "scale(1.1)" : undefined,
                }}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input id="subj-always-double" type="checkbox" checked={alwaysDouble} onChange={(e) => setAlwaysDouble(e.target.checked)} className="h-4 w-4 accent-primary cursor-pointer" />
          <Label htmlFor="subj-always-double" className="cursor-pointer">הכרח כפולים</Label>
        </div>
        <div className="flex items-center gap-3">
          <input id="subj-limit-last" type="checkbox" checked={limitLastPeriods} onChange={(e) => setLimitLastPeriods(e.target.checked)} className="h-4 w-4 accent-primary cursor-pointer" />
          <Label htmlFor="subj-limit-last" className="cursor-pointer">הגבלה בשעות אחרונות</Label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="subj-link-group">קבוצת מקצועות מקושרים</Label>
            <Input id="subj-link-group" value={linkGroup} onChange={(e) => setLinkGroup(e.target.value)} placeholder='לדוגמה: תנ"ך' />
            <p className="text-xs text-muted-foreground mt-1">מקצועות עם אותה קבוצה נחשבים כאחד לחלוקה יומית</p>
          </div>
          <div>
            <Label htmlFor="subj-link-max">מקס׳ שעות ליום (קבוצה)</Label>
            <Input id="subj-link-max" type="number" min={1} max={6} value={linkGroupMaxPerDay} onChange={(e) => setLinkGroupMaxPerDay(e.target.value)} placeholder="2" />
          </div>
        </div>
        <div>
          <Label htmlFor="subj-double-priority">עדיפות שיעורים כפולים (0–100)</Label>
          <Input id="subj-double-priority" type="number" min={0} max={100} value={doublePriority} onChange={(e) => setDoublePriority(e.target.value)} placeholder="אוטומטי" />
        </div>
        <div>
          <Label htmlFor="subj-morning-priority">חשיבות תחילת יום (0–100)</Label>
          <Input id="subj-morning-priority" type="number" min={0} max={100} value={morningPriority} onChange={(e) => setMorningPriority(e.target.value)} placeholder="לא מוגדר" />
        </div>
        <div>
          <Label>חסימת שעות למקצוע</Label>
          <div className="flex gap-2 mb-2">
            <Select value={blockDay} onChange={(e) => setBlockDay(e.target.value)} className="flex-1">
              <option value="">בחר יום</option>
              {DAYS_ORDER.map((d) => (<option key={d} value={d}>{DAY_LABELS[d]}</option>))}
            </Select>
            <Input type="number" min={1} max={10} placeholder="שעה" value={blockPeriod} onChange={(e) => setBlockPeriod(e.target.value)} className="w-20" />
            <Button type="button" variant="outline" size="sm" onClick={addBlockedSlot}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
          {blockedSlots.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {blockedSlots.sort((a, b) => DAYS_ORDER.indexOf(a.day) - DAYS_ORDER.indexOf(b.day) || a.period - b.period).map((s) => (
                <Badge key={`${s.day}-${s.period}`} variant="secondary" className="gap-1">
                  {DAY_LABELS[s.day]} שעה {s.period}
                  <button type="button" onClick={() => removeBlockedSlot(s.day, s.period)} className="cursor-pointer"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          )}
        </div>
        {subject && (
          <InlineConstraints schoolId={schoolId} category="SUBJECT" targetId={subject.id} targetName={subject.name} />
        )}
        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading ? "שומר..." : subject ? "עדכן" : "צור"}</Button>
          <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function GroupingsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabId>("subjects");

  // Subjects state
  const [subjectFormOpen, setSubjectFormOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [deleteSubjectTarget, setDeleteSubjectTarget] = useState<{ id: number; name: string } | null>(null);

  // Groupings state
  const [expandedGradeId, setExpandedGradeId] = useState<number | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<number | null>(
    null,
  );
  const [clusterFormOpen, setClusterFormOpen] = useState(false);
  const [editingCluster, setEditingCluster] =
    useState<ClusterResponse | null>(null);
  const [trackFormOpen, setTrackFormOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [trackClusterId, setTrackClusterId] = useState<number>(0);
  const [trackSubjectId, setTrackSubjectId] = useState<number>(0);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "cluster" | "track" | "requirement";
    id: number;
    name: string;
  } | null>(null);

  // Shared tab state
  const [sharedFormOpen, setSharedFormOpen] = useState(false);
  const [crossGradeFormOpen, setCrossGradeFormOpen] = useState(false);
  const [expandedSharedClusterId, setExpandedSharedClusterId] = useState<number | null>(null);

  // Requirement picker state
  const [reqPickerCluster, setReqPickerCluster] = useState<ClusterResponse | null>(null);

  // Requirements state
  const [reqFormOpen, setReqFormOpen] = useState(false);
  const [editingReq, setEditingReq] = useState<SubjectRequirement | null>(null);
  const [reqFixedClassId, setReqFixedClassId] = useState<number | undefined>();
  const [expandedClassId, setExpandedClassId] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ type: "class"; id: number } | { type: "cluster"; id: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ reqId: number; field: "hours" | "teacher" | "class" } | null>(null);
  const [editingClusterTrackTeacher, setEditingClusterTrackTeacher] = useState<number | null>(null);

  const { data: clusters = [] } = useQuery({
    queryKey: ["groupingClusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: !!schoolId,
  });

  const { data: tracks = [] } = useQuery({
    queryKey: ["tracks"],
    queryFn: () => fetchTracks(),
    enabled: !!schoolId,
  });

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId!),
    enabled: !!schoolId,
  });

  // All requirements (including grouped) — for hours calculation in subjects table
  const { data: allRequirements = [] } = useQuery({
    queryKey: ["requirements", schoolId, "all"],
    queryFn: () => fetchRequirements(schoolId!, true),
    enabled: !!schoolId,
  });

  // Standalone only (excluding grouped) — for requirements tab
  const { data: requirements = [] } = useQuery({
    queryKey: ["requirements", schoolId, "standalone"],
    queryFn: () => fetchRequirements(schoolId!, false),
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

  const deleteSubjectMut = useMutation({
    mutationFn: () => deleteSubject(deleteSubjectTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
      toast.success("מקצוע נמחק");
      setDeleteSubjectTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקת מקצוע"),
  });

  const toggleDoubleMut = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      updateSubject(id, { always_double: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
    },
  });

  const deleteClusterOrTrackMut = useMutation({
    mutationFn: () =>
      deleteTarget!.type === "cluster"
        ? deleteGroupingCluster(deleteTarget!.id)
        : deleteTarget!.type === "track"
          ? deleteTrack(deleteTarget!.id)
          : deleteRequirement(deleteTarget!.id),
    onSuccess: () => {
      if (deleteTarget!.type === "cluster") {
        qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
        qc.invalidateQueries({ queryKey: ["tracks"] });
      } else if (deleteTarget!.type === "track") {
        qc.invalidateQueries({ queryKey: ["tracks"] });
      } else {
        qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      }
      toast.success("נמחק בהצלחה");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  // Track → Requirement conversion
  const [toReqTrack, setToReqTrack] = useState<Track | null>(null);
  const [toReqClassId, setToReqClassId] = useState<number | "">("" );

  const toRequirementMut = useMutation({
    mutationFn: (params: { trackId: number; classGroupId?: number }) =>
      convertTrackToRequirement(params.trackId, params.classGroupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
      toast.success("רמה הוחזרה לדרישה עצמאית");
      setToReqTrack(null);
      setToReqClassId("");
    },
    onError: () => toast.error("שגיאה בהמרה לדרישה"),
  });

  // Requirement → Cluster (link to grouping)
  const [linkReqId, setLinkReqId] = useState<number | null>(null);
  const [linkReqSubjectId, setLinkReqSubjectId] = useState<number | null>(null);
  const [linkReqClassId, setLinkReqClassId] = useState<number | null>(null);
  const [linkTargetReqId, setLinkTargetReqId] = useState<number | "">("" );

  const linkToClusterMut = useMutation({
    mutationFn: async (params: { reqId: number; partnerReqId: number }) => {
      // Create a new cluster, then add both requirements as tracks
      const req1 = allRequirements.find((r) => r.id === params.reqId);
      const req2 = allRequirements.find((r) => r.id === params.partnerReqId);
      if (!req1 || !req2) throw new Error("דרישות לא נמצאו");
      const subj = subjectMap[req1.subject_id];
      const cls1 = classes.find((c) => c.id === req1.class_group_id);
      const cls2 = classes.find((c) => c.id === req2.class_group_id);
      // Determine grade
      const gradeId = cls1?.grade_id ?? cls2?.grade_id ?? null;
      const cluster = await createGroupingCluster({
        school_id: schoolId!,
        name: `הקבצת ${subj?.name ?? "מקצוע"}`,
        subject_id: req1.subject_id,
        grade_id: gradeId,
        source_class_ids: [req1.class_group_id, req2.class_group_id],
      });
      // Add both requirements as tracks
      await createTrackFromRequirement({ cluster_id: cluster.id, requirement_id: params.reqId });
      await createTrackFromRequirement({ cluster_id: cluster.id, requirement_id: params.partnerReqId });
      return cluster;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      qc.invalidateQueries({ queryKey: ["groupingClusters", schoolId] });
      toast.success("נוצרה הקבצה חדשה");
      setLinkReqId(null);
      setLinkTargetReqId("");
    },
    onError: () => toast.error("שגיאה ביצירת הקבצה"),
  });

  const handleToRequirement = (track: Track) => {
    if (track.requirement_id) {
      // Track was imported from a requirement — direct conversion, no class needed
      toRequirementMut.mutate({ trackId: track.id });
    } else if (track.source_class_id) {
      // Has source class — use it directly
      toRequirementMut.mutate({ trackId: track.id, classGroupId: track.source_class_id });
    } else {
      // Need to pick a class
      setToReqTrack(track);
      setToReqClassId("");
    }
  };

  const handleClassToggle = async (
    cluster: ClusterResponse,
    classId: number,
    checked: boolean,
  ) => {
    const newIds = checked
      ? [...cluster.source_class_ids, classId]
      : cluster.source_class_ids.filter((id) => id !== classId);
    try {
      await updateGroupingCluster(cluster.id, { source_class_ids: newIds });
      qc.invalidateQueries({ queryKey: ["grouping-clusters"] });
    } catch {
      toast.error("שגיאה בעדכון כיתות");
    }
  };

  const subjectMap = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const teacherMap = Object.fromEntries(teachers.map((t) => [t.id, t.name]));
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c]));

  // Separate clusters by type
  const sharedLessons = clusters.filter(
    (c) => c.cluster_type === "SHARED_LESSON",
  );
  const crossGradeClusters = clusters.filter(
    (c) => c.cluster_type === "CROSS_GRADE",
  );
  const regularClusters = clusters.filter(
    (c) => !c.cluster_type || c.cluster_type === "REGULAR",
  );

  // Auto-select first class on data load
  useEffect(() => {
    if (selectedItem) return;
    if (grades.length > 0 && classes.length > 0) {
      const sorted = [...grades].sort((a, b) => a.level - b.level);
      const firstClass = classes.find((c) => c.grade_id === sorted[0].id);
      if (firstClass) {
        setSelectedItem({ type: "class", id: firstClass.id });
        setExpandedGradeId(sorted[0].id);
      }
    }
  }, [grades, classes, selectedItem]);

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  const openTrackForm = (
    cluster: ClusterResponse,
    track: Track | null,
  ) => {
    setTrackClusterId(cluster.id);
    setTrackSubjectId(cluster.subject_id);
    setEditingTrack(track);
    setTrackFormOpen(true);
  };

  const openReqForm = (classGroupId?: number, req?: SubjectRequirement) => {
    setEditingReq(req ?? null);
    setReqFixedClassId(classGroupId);
    setReqFormOpen(true);
  };

  const sortedGrades = [...grades].sort((a, b) => a.level - b.level);

  // Build per-subject hours by grade for subject table (uses ALL requirements)
  const classToGrade: Record<number, number> = {};
  for (const c of classes) classToGrade[c.id] = c.grade_id;
  const subjectGradeHours: Record<number, Record<number, number>> = {};
  const subjectTotalHours: Record<number, number> = {};
  for (const r of allRequirements) {
    if (!subjectGradeHours[r.subject_id]) subjectGradeHours[r.subject_id] = {};
    if (!subjectTotalHours[r.subject_id]) subjectTotalHours[r.subject_id] = 0;
    const gradeId = classToGrade[r.class_group_id];
    if (gradeId != null) {
      subjectGradeHours[r.subject_id][gradeId] =
        (subjectGradeHours[r.subject_id][gradeId] ?? 0) + r.hours_per_week;
    }
    subjectTotalHours[r.subject_id] += r.hours_per_week;
  }

  return (
    <div className="space-y-6">
      {/* ── Tab Bar ── */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Subjects (מקצועות) ── */}
      {activeTab === "subjects" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">מקצועות</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const toUpdate = subjects.filter((s) => s.morning_priority == null);
                  for (const s of toUpdate) {
                    await updateSubject(s.id, { morning_priority: 70 });
                  }
                  qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
                  toast.success(`הוגדר תעדוף בוקר ל-${toUpdate.length} מקצועות`);
                }}
                disabled={subjects.every((s) => s.morning_priority != null)}
                title="הגדר תעדוף בוקר (70) לכל מקצוע שעדיין לא מוגדר"
              >
                תעדוף בוקר אוטומטי
              </Button>
              <Button size="sm" onClick={() => { setEditingSubject(null); setSubjectFormOpen(true); }}>
                <Plus className="h-4 w-4" />
                מקצוע חדש
              </Button>
            </div>
          </div>
          <DataTable
            compact
            searchable
            searchPlaceholder="חיפוש מקצוע..."
            keyField="id"
            data={subjects}
            columns={[
              {
                header: "צבע",
                accessor: (s: Subject) => {
                  const sc = getSubjectColor(s.color);
                  return (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: sc.bg, color: sc.text }}
                    >
                      {sc.label}
                    </span>
                  );
                },
                className: "w-20",
              },
              {
                header: "שם",
                accessor: (s: Subject) => (
                  <span className={s.is_hidden ? "line-through text-muted-foreground" : ""}>
                    {s.name}
                  </span>
                ),
              },
              {
                header: "סה״כ",
                accessor: (s: Subject) => {
                  const total = subjectTotalHours[s.id];
                  return total ? <span className="font-medium">{total}</span> : "—";
                },
                className: "w-16 text-center",
              },
              ...sortedGrades.map((g) => ({
                header: g.name,
                accessor: (s: Subject) => {
                  const hours = subjectGradeHours[s.id]?.[g.id];
                  return hours ? String(hours) : "";
                },
                className: "w-16 text-center",
              })),
              {
                header: "כפולים",
                accessor: (s: Subject) => (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await updateSubject(s.id, { always_double: !s.always_double });
                      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
                    }}
                    className={`cursor-pointer hover:opacity-70 font-bold ${s.always_double ? "text-green-600" : "text-muted-foreground hover:text-green-600"}`}
                    title={s.always_double ? "לחץ לביטול כפולים" : "לחץ להפעלת כפולים"}
                  >
                    {s.always_double ? "✓" : "—"}
                  </button>
                ),
                className: "w-16 text-center",
              },
              {
                header: "בוקר",
                accessor: (s: Subject) => {
                  const val = s.morning_priority;
                  return (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await updateSubject(s.id, { morning_priority: val ? null : 70 });
                        qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
                      }}
                      className={`cursor-pointer hover:opacity-70 font-bold ${val ? "text-amber-600" : "text-muted-foreground hover:text-amber-600"}`}
                      title={val ? `תעדוף בוקר: ${val}. לחץ לביטול` : "לחץ להגדרת תעדוף בוקר (70)"}
                    >
                      {val ? val : "—"}
                    </button>
                  );
                },
                className: "w-16 text-center",
              },
              {
                header: "פעולות",
                accessor: (s: Subject) => (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={s.is_hidden ? "הצג בסולבר" : "הסתר מהסולבר"}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await updateSubject(s.id, { is_hidden: !s.is_hidden });
                        qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
                        toast.success(s.is_hidden ? "מקצוע הוצג" : "מקצוע הוסתר מהסולבר");
                      }}
                    >
                      {s.is_hidden
                        ? <EyeOff className="h-4 w-4 text-orange-400" />
                        : <Eye className="h-4 w-4 text-muted-foreground" />
                      }
                    </Button>
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditingSubject(s); setSubjectFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDeleteSubjectTarget({ id: s.id, name: s.name }); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ),
                className: "w-32",
              },
            ]}
            emptyMessage="אין מקצועות — הוסף מקצוע חדש"
          />
        </section>
      )}

      {/* ── Tab: Requirements (דרישות) ── */}
      {activeTab === "requirements" && (
        <section>
          <div className="flex gap-6" style={{ minHeight: "calc(100vh - 220px)" }}>
            {/* ── Right: Navigation Tree ── */}
            <div className="w-56 shrink-0 space-y-1 border-e pe-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-muted-foreground">ניווט</h3>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" title="דרישה חדשה" onClick={() => openReqForm(selectedItem?.type === "class" ? selectedItem.id : undefined)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {sortedGrades.map((grade) => {
                const gradeClasses = classes.filter((c) => c.grade_id === grade.id);
                const gradeClusters = regularClusters.filter((c) => c.grade_id === grade.id);
                if (gradeClasses.length === 0 && gradeClusters.length === 0) return null;
                const isExpanded = expandedGradeId === grade.id;
                return (
                  <div key={grade.id} className="mb-1">
                    <button
                      onClick={() => setExpandedGradeId(isExpanded ? null : grade.id)}
                      className="w-full flex items-center gap-1 text-xs font-bold text-muted-foreground px-2 py-1.5 rounded-md hover:bg-muted transition-colors"
                    >
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
                      שכבה {grade.name}
                    </button>
                    {isExpanded && gradeClasses.map((cls) => {
                      const isSelected = selectedItem?.type === "class" && selectedItem.id === cls.id;
                      const classReqs = requirements.filter((r) => r.class_group_id === cls.id);
                      const totalHours = classReqs.reduce((sum, r) => sum + r.hours_per_week, 0);
                      return (
                        <button
                          key={cls.id}
                          onClick={() => setSelectedItem({ type: "class", id: cls.id })}
                          className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm transition-colors ${
                            isSelected
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <span>{cls.name}</span>
                          {totalHours > 0 && (
                            <span className="text-xs text-muted-foreground">{totalHours}ש</span>
                          )}
                        </button>
                      );
                    })}
                    {/* Clusters under this grade */}
                    {isExpanded && gradeClusters.length > 0 && (
                      <div className="mt-1 me-2 border-e-2 border-primary/20">
                        {gradeClusters.map((cluster) => {
                          const isSelected = selectedItem?.type === "cluster" && selectedItem.id === cluster.id;
                          const subject = subjectMap[cluster.subject_id];
                          const clusterTracks = tracks.filter((t) => t.cluster_id === cluster.id);
                          return (
                            <button
                              key={cluster.id}
                              onClick={() => setSelectedItem({ type: "cluster", id: cluster.id })}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                                isSelected
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-foreground hover:bg-muted"
                              }`}
                            >
                              {subject && (
                                <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: getSubjectColor(subject.color).bg }} />
                              )}
                              <span className="truncate">{cluster.name}</span>
                              <span className="text-xs text-muted-foreground ms-auto shrink-0">{clusterTracks.length} רמות</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Add cluster button */}
              <div className="pt-2 border-t mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => { setEditingCluster(null); setClusterFormOpen(true); }}
                  disabled={subjects.length === 0}
                >
                  <Plus className="h-3.5 w-3.5" />
                  הקבצה חדשה
                </Button>
              </div>
            </div>

            {/* ── Left: Content Panel ── */}
            <div className="flex-1 min-w-0">
              {!selectedItem && (
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  בחר כיתה או הקבצה מהתפריט
                </div>
              )}

              {/* Class content */}
              {selectedItem?.type === "class" && (() => {
                const cls = classes.find((c) => c.id === selectedItem.id);
                if (!cls) return null;
                const classReqs = requirements.filter((r) => r.class_group_id === cls.id);
                const classClusters = clusters.filter((c) => c.source_class_ids.includes(cls.id));
                type ReqRow = {
                  _key: string;
                  subject_id: number;
                  teacher_id: number | null;
                  co_teacher_ids?: number[];
                  hours_per_week: number;
                  is_grouped: boolean;
                  is_external: boolean;
                  grouping_cluster_id: number | null;
                  _isTrack: boolean;
                  _trackName?: string;
                  _reqId?: number;
                  _isPinned: boolean;
                  _isHidden: boolean;
                };
                const rows: ReqRow[] = classReqs.map((r) => ({
                  _key: `req-${r.id}`,
                  subject_id: r.subject_id,
                  teacher_id: r.teacher_id,
                  co_teacher_ids: r.co_teacher_ids ?? [],
                  hours_per_week: r.hours_per_week,
                  is_grouped: r.is_grouped,
                  is_external: r.is_external,
                  grouping_cluster_id: r.grouping_cluster_id,
                  _isTrack: false,
                  _reqId: r.id,
                  _isPinned: (r.pinned_slots ?? []).length > 0,
                  _isHidden: r.is_hidden ?? false,
                }));
                const reqIds = new Set(classReqs.map((r) => r.id));
                for (const cluster of classClusters) {
                  for (const track of cluster.tracks) {
                    if (track.requirement_id && reqIds.has(track.requirement_id)) continue;
                    if (track.source_class_id !== null && track.source_class_id !== cls.id) continue;
                    rows.push({
                      _key: `track-${track.id}`,
                      subject_id: cluster.subject_id,
                      teacher_id: track.teacher_id,
                      hours_per_week: track.hours_per_week,
                      is_grouped: true,
                      is_external: false,
                      grouping_cluster_id: cluster.id,
                      _isTrack: true,
                      _trackName: track.name,
                      _isPinned: (track.pinned_slots ?? []).length > 0,
                      _isHidden: false,
                    });
                  }
                }
                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold">דרישות — {cls.name}</h2>
                      <Button size="sm" variant="outline" onClick={() => openReqForm(cls.id)} disabled={subjects.length === 0}>
                        <Plus className="h-3 w-3" />
                        דרישה חדשה
                      </Button>
                    </div>
                    <DataTable
                      compact
                      keyField="_key"
                      data={rows}
                      rowClassName={(r: ReqRow) =>
                        r._isHidden ? "opacity-40 line-through"
                        : r._isPinned ? "bg-yellow-50 dark:bg-yellow-950/20"
                        : undefined
                      }
                      columns={[
                        {
                          header: "מקצוע",
                          accessor: (r: ReqRow) => {
                            const s = subjectMap[r.subject_id];
                            return (
                              <span className="flex items-center gap-2">
                                {s && <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: getSubjectColor(s.color).bg }} />}
                                {r._isTrack ? r._trackName : (s?.name ?? r.subject_id)}
                              </span>
                            );
                          },
                        },
                        {
                          header: "מורה",
                          accessor: (r: ReqRow) => {
                            const co = (r.co_teacher_ids ?? []).map((id: number) => teacherMap[id]).filter(Boolean);
                            if (!r._isTrack && r._reqId && editingCell?.reqId === r._reqId && editingCell.field === "teacher") {
                              return (
                                <select
                                  autoFocus
                                  className="border rounded px-1 py-0.5 text-sm bg-white dark:bg-gray-800 w-full"
                                  value={r.teacher_id ?? ""}
                                  onChange={async (e) => {
                                    const val = e.target.value ? Number(e.target.value) : null;
                                    setEditingCell(null);
                                    await updateRequirement(r._reqId!, { teacher_id: val });
                                    qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
                                    toast.success("מורה עודכן");
                                  }}
                                  onBlur={() => setEditingCell(null)}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <option value="">לא הוקצה</option>
                                  {teachers.map((t) => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                  ))}
                                </select>
                              );
                            }
                            const primary = r.teacher_id ? teacherMap[r.teacher_id] ?? "—" : "לא הוקצה";
                            const display = co.length > 0 ? `${primary} + ${co.join(", ")}` : primary;
                            if (r._isTrack) return display;
                            return (
                              <span
                                className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-1 py-0.5 -mx-1"
                                onClick={(e) => { e.stopPropagation(); setEditingCell({ reqId: r._reqId!, field: "teacher" }); }}
                              >
                                {display}
                              </span>
                            );
                          },
                        },
                        {
                          header: "שעות",
                          accessor: (r: ReqRow) => {
                            if (!r._isTrack && r._reqId && editingCell?.reqId === r._reqId && editingCell.field === "hours") {
                              return (
                                <input
                                  type="number"
                                  autoFocus
                                  min={1}
                                  max={20}
                                  className="border rounded px-1 py-0.5 text-sm w-16 bg-white dark:bg-gray-800"
                                  defaultValue={r.hours_per_week}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={async (e) => {
                                    const val = Number(e.target.value);
                                    setEditingCell(null);
                                    if (val > 0 && val !== r.hours_per_week) {
                                      await updateRequirement(r._reqId!, { hours_per_week: val });
                                      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
                                      toast.success("שעות עודכנו");
                                    }
                                  }}
                                  onKeyDown={async (e) => {
                                    if (e.key === "Enter") {
                                      (e.target as HTMLInputElement).blur();
                                    } else if (e.key === "Escape") {
                                      setEditingCell(null);
                                    }
                                  }}
                                />
                              );
                            }
                            if (r._isTrack) return r.hours_per_week;
                            return (
                              <span
                                className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-1 py-0.5 -mx-1"
                                onClick={(e) => { e.stopPropagation(); setEditingCell({ reqId: r._reqId!, field: "hours" }); }}
                              >
                                {r.hours_per_week}
                              </span>
                            );
                          },
                        },
                        {
                          header: "סוג",
                          accessor: (r: ReqRow) => (
                            <div className="flex gap-1 flex-wrap">
                              {r.is_grouped && (
                                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                                  {clusters.find((c) => c.id === r.grouping_cluster_id)?.name ?? "הקבצה"}
                                </span>
                              )}
                              {r.is_external && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                  חוץ-לימודי
                                </span>
                              )}
                            </div>
                          ),
                        },
                        {
                          header: "פעולות",
                          accessor: (r: ReqRow) =>
                            r._isTrack ? null : (
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={r._isHidden ? "הצג בסולבר" : "הסתר מהסולבר"}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await updateRequirement(r._reqId!, { is_hidden: !r._isHidden });
                                    qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
                                    toast.success(r._isHidden ? "דרישה הוצגה" : "דרישה הוסתרה מהסולבר");
                                  }}
                                >
                                  {r._isHidden
                                    ? <EyeOff className="h-4 w-4 text-orange-400" />
                                    : <Eye className="h-4 w-4 text-muted-foreground" />
                                  }
                                </Button>
                                {!r.is_grouped && (
                                  <Button variant="ghost" size="icon" title="חבר להקבצה" onClick={(e) => {
                                    e.stopPropagation();
                                    setLinkReqId(r._reqId!);
                                    setLinkReqSubjectId(r.subject_id);
                                    setLinkReqClassId(cls.id);
                                    setLinkTargetReqId("");
                                  }}>
                                    <Plus className="h-4 w-4 text-blue-500" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" onClick={(e) => {
                                  e.stopPropagation();
                                  const orig = classReqs.find((rq) => rq.id === r._reqId);
                                  if (orig) openReqForm(cls.id, orig);
                                }}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" onClick={(e) => {
                                  e.stopPropagation();
                                  const sName = subjectMap[r.subject_id]?.name ?? "מקצוע";
                                  setDeleteTarget({ type: "requirement", id: r._reqId!, name: `${sName} – ${cls.name}` });
                                }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
                            ),
                          className: "w-32",
                        },
                      ]}
                      emptyMessage="אין דרישות לכיתה זו"
                    />
                    {/* Summary */}
                    {(() => {
                      const standaloneHours = rows.filter((r) => !r.is_grouped && !r._isTrack && !r._isHidden).reduce((s, r) => s + r.hours_per_week, 0);
                      const groupedHours = rows.filter((r) => (r.is_grouped || r._isTrack) && !r._isHidden).reduce((s, r) => s + r.hours_per_week, 0);
                      // Effective cluster hours: max track hours per cluster (synced tracks share slots)
                      const clusterMaxHours: Record<number, number> = {};
                      for (const r of rows) {
                        if ((r.is_grouped || r._isTrack) && r.grouping_cluster_id && !r._isHidden) {
                          const cur = clusterMaxHours[r.grouping_cluster_id] ?? 0;
                          if (r.hours_per_week > cur) clusterMaxHours[r.grouping_cluster_id] = r.hours_per_week;
                        }
                      }
                      // Split by cluster type
                      let regularClusterHours = 0;
                      let sharedClusterHours = 0;
                      for (const [cid, hrs] of Object.entries(clusterMaxHours)) {
                        const cl = clusters.find((c) => c.id === Number(cid));
                        if (cl?.cluster_type === "SHARED_LESSON") {
                          sharedClusterHours += hrs;
                        } else {
                          regularClusterHours += hrs;
                        }
                      }
                      const effectiveTotal = standaloneHours + regularClusterHours + sharedClusterHours;
                      const isOver = effectiveTotal > 40;
                      return (
                        <div className={`mt-3 p-3 rounded-md text-sm border ${isOver ? "bg-destructive/10 border-destructive/30" : "bg-muted/30 border-border"}`}>
                          <div className="flex gap-6 flex-wrap">
                            <span>שעות כיתה: <strong>{standaloneHours}</strong></span>
                            <span>הקבצות: <strong>{regularClusterHours}</strong></span>
                            {sharedClusterHours > 0 && <span>משותפים: <strong>{sharedClusterHours}</strong></span>}
                            <span className={isOver ? "text-destructive font-bold" : "font-bold"}>
                              סה״כ: {effectiveTotal} / 40
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* Cluster content */}
              {selectedItem?.type === "cluster" && (() => {
                const cluster = clusters.find((c) => c.id === selectedItem.id);
                if (!cluster) return null;
                const clusterTracks = tracks.filter((t) => t.cluster_id === cluster.id);
                const subject = subjectMap[cluster.subject_id];
                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold">{cluster.name}</h2>
                        {subject && (
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: getSubjectColor(subject.color).bg }} />
                            {subject.name}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setEditingCluster(cluster); setClusterFormOpen(true); }}>
                          <Pencil className="h-3 w-3" />
                          עריכה
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setReqPickerCluster(cluster)}>
                          <Plus className="h-3 w-3" />
                          הוסף מדרישה
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openTrackForm(cluster, null)}>
                          <Plus className="h-3 w-3" />
                          רמה חדשה
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setDeleteTarget({ type: "cluster", id: cluster.id, name: cluster.name })}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <DataTable
                      compact
                      keyField="id"
                      data={clusterTracks}
                      rowClassName={(t: Track) =>
                        (t.pinned_slots ?? []).length > 0 ? "bg-yellow-50 dark:bg-yellow-950/20" : undefined
                      }
                      columns={[
                        { header: "שם רמה", accessor: "name" as keyof Track },
                        {
                          header: "מורה",
                          accessor: (t: Track) => {
                            if (editingClusterTrackTeacher === t.id) {
                              const subjectId = cluster.subject_id;
                              const cmp = (a: typeof teachers[0], b: typeof teachers[0]) => a.name.localeCompare(b.name, "he");
                              const assigned = teachers.filter((tc) => tc.subject_ids.includes(subjectId)).sort(cmp);
                              const unassigned = teachers.filter((tc) => !tc.subject_ids.includes(subjectId)).sort(cmp);
                              return (
                                <div className="flex items-center gap-1">
                                  <select
                                    defaultValue={t.teacher_id ?? ""}
                                    onChange={async (e) => {
                                      const val = e.target.value ? Number(e.target.value) : null;
                                      if (val && unassigned.some((tc) => tc.id === val)) {
                                        const tc = teachers.find((x) => x.id === val);
                                        if (tc) {
                                          const { updateTeacher } = await import("@/api/teachers");
                                          await updateTeacher(val, { subject_ids: [...tc.subject_ids, subjectId] });
                                          qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
                                        }
                                      }
                                      await updateTrack(t.id, { teacher_id: val });
                                      qc.invalidateQueries({ queryKey: ["grouping-clusters", schoolId] });
                                      toast.success("מורה עודכן");
                                      setEditingClusterTrackTeacher(null);
                                    }}
                                    className="rounded border border-input bg-background px-1 py-0.5 text-sm max-w-[200px]"
                                    autoFocus
                                    onBlur={() => setEditingClusterTrackTeacher(null)}
                                  >
                                    <option value="">לא הוקצה</option>
                                    {assigned.length > 0 && (
                                      <optgroup label="מורים של המקצוע">
                                        {assigned.map((tc) => (
                                          <option key={tc.id} value={tc.id}>{tc.name}</option>
                                        ))}
                                      </optgroup>
                                    )}
                                    {unassigned.length > 0 && (
                                      <optgroup label="מורים אחרים (ישויכו למקצוע)">
                                        {unassigned.map((tc) => (
                                          <option key={tc.id} value={tc.id}>{tc.name}</option>
                                        ))}
                                      </optgroup>
                                    )}
                                  </select>
                                  <button onClick={() => setEditingClusterTrackTeacher(null)} className="text-red-500 hover:text-red-600">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              );
                            }
                            const teacher = t.teacher_id ? teachers.find((tc) => tc.id === t.teacher_id) : null;
                            return (
                              <span
                                className="cursor-pointer hover:text-primary transition-colors flex items-center gap-1.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingClusterTrackTeacher(t.id);
                                }}
                              >
                                {teacher ? teacher.name : "לא הוקצה"}
                                {teacher?.blocked_slots && teacher.blocked_slots.length > 0 && (
                                  <Badge variant="outline" className="text-xs text-amber-600">{teacher.blocked_slots.length} חסימות</Badge>
                                )}
                              </span>
                            );
                          },
                        },
                        {
                          header: "שעות",
                          accessor: (t: Track) => {
                            if (!t.teacher_id) return t.hours_per_week;
                            const teacher = teachers.find((tc) => tc.id === t.teacher_id);
                            if (!teacher) return t.hours_per_week;
                            return (
                              <span className="flex items-center gap-1.5">
                                {t.hours_per_week}
                                <span className="text-xs text-muted-foreground">/ {teacher.max_hours_per_week}</span>
                              </span>
                            );
                          },
                        },
                        {
                          header: "קבוצה",
                          accessor: (t: Track) => {
                            if (t.link_group == null) return "";
                            // Find other tracks with same link_group
                            const partners = clusterTracks.filter(
                              (other) => other.link_group === t.link_group && other.id !== t.id,
                            );
                            return (
                              <Badge variant="secondary" className="text-xs" title={
                                partners.length > 0
                                  ? `קבוצה ${t.link_group}: ${partners.map((p) => p.name).join(", ")}`
                                  : `קבוצה ${t.link_group}`
                              }>
                                קב׳ {t.link_group}
                              </Badge>
                            );
                          },
                          className: "w-16",
                        },
                        {
                          header: "פעולות",
                          accessor: (t: Track) => (
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" title="הוצא לדרישה" onClick={(e) => { e.stopPropagation(); handleToRequirement(t); }}>
                                <Undo2 className="h-4 w-4 text-blue-500" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openTrackForm(cluster, t); }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: "track", id: t.id, name: t.name }); }}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ),
                          className: "w-32",
                        },
                      ]}
                      emptyMessage="אין רמות — הוסף רמה חדשה"
                    />
                  </div>
                );
              })()}
            </div>
          </div>
        </section>
      )}

      {/* ── Tab: Shared (משותפים) ── */}
      {activeTab === "shared" && (
        <section className="space-y-4">
          {/* ── Shared Lessons ── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">שיעורים משותפים</h2>
              <Button
                size="sm"
                onClick={() => setSharedFormOpen(true)}
                disabled={subjects.length === 0 || teachers.length === 0}
              >
                <Plus className="h-4 w-4" />
                שיעור משותף חדש
              </Button>
            </div>
            {sharedLessons.length === 0 ? (
              <div className="rounded-md border px-4 py-8 text-center text-muted-foreground">
                אין שיעורים משותפים
              </div>
            ) : (
              <div className="space-y-2">
                {sharedLessons.map((cluster) => {
                  const isExpanded = expandedSharedClusterId === cluster.id;
                  const clusterTracks = tracks.filter(
                    (t) => t.cluster_id === cluster.id,
                  );
                  const subject = subjectMap[cluster.subject_id];
                  const sourceNames = cluster.source_class_ids
                    .map((id) => classMap[id]?.name)
                    .filter(Boolean)
                    .join(", ");
                  const firstTrack = clusterTracks[0];

                  return (
                    <div key={cluster.id} className="rounded-md border">
                      <div
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() =>
                          setExpandedSharedClusterId(
                            isExpanded ? null : cluster.id,
                          )
                        }
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex-1 flex items-center gap-4 text-sm">
                          {subject && (
                            <span
                              className="inline-block h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: getSubjectColor(subject.color).bg }}
                            />
                          )}
                          <span className="font-medium">{cluster.name}</span>
                          <span className="text-muted-foreground">
                            {subject?.name ?? "—"}
                          </span>
                          <span className="text-muted-foreground">
                            {firstTrack?.hours_per_week ?? "—"} שעות
                          </span>
                          <span className="text-muted-foreground">
                            {clusterTracks.length} מורים
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({sourceNames})
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCluster(cluster);
                              setClusterFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget({
                                type: "cluster",
                                id: cluster.id,
                                name: cluster.name,
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium">מורים משובצים</h3>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openTrackForm(cluster, null)}
                            >
                              <Plus className="h-3 w-3" />
                              הוסף מורה
                            </Button>
                          </div>
                          <DataTable
                            compact
                            keyField="id"
                            data={clusterTracks}
                            rowClassName={(t: Track) =>
                              (t.pinned_slots ?? []).length > 0 ? "bg-yellow-50 dark:bg-yellow-950/20" : undefined
                            }
                            columns={[
                              {
                                header: "שם",
                                accessor: "name",
                              },
                              {
                                header: "מורה",
                                accessor: (t: Track) => {
                                  if (editingClusterTrackTeacher === t.id) {
                                    const subjectId = cluster.subject_id;
                                    const cmpT = (a: Teacher, b: Teacher) => a.name.localeCompare(b.name, "he");
                                    const assigned = teachers.filter((tc) => tc.subject_ids.includes(subjectId)).sort(cmpT);
                                    const unassigned = teachers.filter((tc) => !tc.subject_ids.includes(subjectId)).sort(cmpT);
                                    return (
                                      <div className="flex items-center gap-1">
                                        <select
                                          defaultValue={t.teacher_id ?? ""}
                                          onChange={async (e) => {
                                            const val = e.target.value ? Number(e.target.value) : null;
                                            if (val && unassigned.some((tc) => tc.id === val)) {
                                              const { updateTeacher } = await import("@/api/teachers");
                                              const tc = teachers.find((x) => x.id === val);
                                              if (tc) {
                                                await updateTeacher(val, { subject_ids: [...tc.subject_ids, subjectId] });
                                                qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
                                              }
                                            }
                                            await updateTrack(t.id, { teacher_id: val });
                                            qc.invalidateQueries({ queryKey: ["grouping-clusters", schoolId] });
                                            toast.success("מורה עודכן");
                                            setEditingClusterTrackTeacher(null);
                                          }}
                                          className="rounded border border-input bg-background px-1 py-0.5 text-sm max-w-[200px]"
                                          autoFocus
                                          onBlur={() => setEditingClusterTrackTeacher(null)}
                                        >
                                          <option value="">לא הוקצה</option>
                                          {assigned.length > 0 && (
                                            <optgroup label="מורים של המקצוע">
                                              {assigned.map((tc) => (
                                                <option key={tc.id} value={tc.id}>{tc.name}</option>
                                              ))}
                                            </optgroup>
                                          )}
                                          {unassigned.length > 0 && (
                                            <optgroup label="מורים אחרים (ישויכו למקצוע)">
                                              {unassigned.map((tc) => (
                                                <option key={tc.id} value={tc.id}>{tc.name}</option>
                                              ))}
                                            </optgroup>
                                          )}
                                        </select>
                                        <button onClick={() => setEditingClusterTrackTeacher(null)} className="text-red-500 hover:text-red-600">
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    );
                                  }
                                  const tName = t.teacher_id ? (teacherMap[t.teacher_id] ?? "—") : "לא הוקצה";
                                  return (
                                    <span
                                      className="cursor-pointer hover:text-primary transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingClusterTrackTeacher(t.id);
                                      }}
                                    >
                                      {tName}
                                    </span>
                                  );
                                },
                              },
                              {
                                header: "שעות",
                                accessor: "hours_per_week",
                              },
                              {
                                header: "נעילה",
                                accessor: (t: Track) => {
                                  const pinned = t.pinned_slots ?? [];
                                  if (pinned.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
                                  return (
                                    <div className="flex items-center gap-1">
                                      <Badge variant="secondary" className="text-xs">
                                        <Lock className="h-3 w-3 ml-1" />
                                        {pinned.length} נעולים
                                      </Badge>
                                      <button
                                        className="text-red-500 hover:text-red-600 cursor-pointer"
                                        title="שחרר נעילה"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          await updateTrack(t.id, { pinned_slots: null });
                                          qc.invalidateQueries({ queryKey: ["grouping-clusters", schoolId] });
                                          toast.success("נעילה שוחררה");
                                        }}
                                      >
                                        <LockOpen className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  );
                                },
                                className: "w-28",
                              },
                              {
                                header: "פעולות",
                                accessor: (t) => (
                                  <div className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openTrackForm(cluster, t);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTarget({
                                          type: "track",
                                          id: t.id,
                                          name: t.name,
                                        });
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>
                                ),
                                className: "w-24",
                              },
                            ]}
                            emptyMessage="אין מורים — הוסף מורה"
                          />
                          <div className="pt-2 border-t">
                            <h3 className="text-sm font-medium mb-2">כיתות</h3>
                            <div className="flex flex-wrap gap-3">
                              {classes.map((cls) => (
                                <label key={cls.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="rounded"
                                    checked={cluster.source_class_ids.includes(cls.id)}
                                    onChange={(e) => handleClassToggle(cluster, cls.id, e.target.checked)}
                                  />
                                  {cls.name}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Dialogs */}
      {clusterFormOpen && (
        <ClusterFormDialog
          key={editingCluster?.id ?? "new"}
          open={clusterFormOpen}
          onClose={() => setClusterFormOpen(false)}
          onSaved={(clusterId) => {
            setClusterFormOpen(false);
            setExpandedClusterId(clusterId);
          }}
          cluster={editingCluster}
          schoolId={schoolId}
          subjects={subjects}
          grades={grades}
          currentTracks={
            editingCluster
              ? tracks.filter((t) => t.cluster_id === editingCluster.id)
              : []
          }
        />
      )}

      {trackFormOpen && (
        <TrackFormDialog
          key={editingTrack?.id ?? "new"}
          open={trackFormOpen}
          onClose={() => setTrackFormOpen(false)}
          track={editingTrack}
          clusterId={trackClusterId}
          subjectId={trackSubjectId}
          teachers={teachers}
          schoolId={schoolId}
          siblingTracks={tracks.filter((t) => t.cluster_id === trackClusterId)}
          sourceClasses={(() => {
            const cl = clusters.find((c) => c.id === trackClusterId);
            if (!cl) return [];
            const ids = new Set(cl.source_class_ids);
            return classes.filter((c) => ids.has(c.id));
          })()}
        />
      )}

      {reqFormOpen && (
        <RequirementFormDialog
          key={editingReq?.id ?? `new-${reqFixedClassId}`}
          open={reqFormOpen}
          onClose={() => setReqFormOpen(false)}
          requirement={editingReq}
          schoolId={schoolId}
          fixedClassGroupId={reqFixedClassId}
        />
      )}

      {sharedFormOpen && (
        <SharedLessonFormDialog
          open={sharedFormOpen}
          onClose={() => setSharedFormOpen(false)}
          schoolId={schoolId}
          subjects={subjects}
          teachers={teachers}
          grades={grades}
          classes={classes}
        />
      )}

      {subjectFormOpen && (
        <SubjectFormDialog
          open={subjectFormOpen}
          onClose={() => setSubjectFormOpen(false)}
          subject={editingSubject}
          schoolId={schoolId}
        />
      )}

      <ConfirmDialog
        open={!!deleteSubjectTarget}
        onClose={() => setDeleteSubjectTarget(null)}
        onConfirm={() => deleteSubjectMut.mutate()}
        title="אישור מחיקה"
        message={`האם למחוק את "${deleteSubjectTarget?.name}"? פעולה זו לא ניתנת לביטול.`}
        loading={deleteSubjectMut.isPending}
      />

      {reqPickerCluster && (
        <RequirementPickerDialog
          key={reqPickerCluster.id}
          open={!!reqPickerCluster}
          onClose={() => setReqPickerCluster(null)}
          clusterId={reqPickerCluster.id}
          gradeId={reqPickerCluster.grade_id}
          schoolId={schoolId}
          requirements={requirements}
          subjects={subjects}
          teachers={teachers}
          classes={classes}
          grades={grades}
          existingTracks={tracks.filter(
            (t) => t.cluster_id === reqPickerCluster.id,
          )}
        />
      )}

      {linkReqId != null && (() => {
        const sourceReq = allRequirements.find((r) => r.id === linkReqId);
        const sourceSubj = linkReqSubjectId ? subjectMap[linkReqSubjectId] : null;
        // Find similar requirements from other classes (same subject, standalone)
        const candidates = requirements.filter((r) =>
          r.id !== linkReqId
          && r.subject_id === linkReqSubjectId
          && !r.is_grouped
          && r.class_group_id !== linkReqClassId
        );
        return (
          <Dialog open onClose={() => setLinkReqId(null)}>
            <DialogHeader>
              <DialogTitle>חבר להקבצה — {sourceSubj?.name}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (linkTargetReqId !== "") {
                  linkToClusterMut.mutate({ reqId: linkReqId, partnerReqId: Number(linkTargetReqId) });
                }
              }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                בחר דרישה דומה מכיתה אחרת ליצירת הקבצה משותפת:
              </p>
              <div>
                <Label>דרישה לחיבור</Label>
                <Select
                  value={linkTargetReqId}
                  onChange={(e) => setLinkTargetReqId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  <option value="">בחר דרישה...</option>
                  {candidates.map((r) => {
                    const cls = classes.find((c) => c.id === r.class_group_id);
                    const teacher = r.teacher_id ? teacherMap[r.teacher_id] : "—";
                    return (
                      <option key={r.id} value={r.id}>
                        {cls?.name ?? "?"} — {teacher} — {r.hours_per_week} ש׳
                      </option>
                    );
                  })}
                </Select>
                {candidates.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    לא נמצאו דרישות דומות (אותו מקצוע, עצמאיות) בכיתות אחרות
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={linkToClusterMut.isPending || linkTargetReqId === "" || candidates.length === 0}>
                  {linkToClusterMut.isPending ? "יוצר הקבצה..." : "צור הקבצה"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setLinkReqId(null)}>ביטול</Button>
              </DialogFooter>
            </form>
          </Dialog>
        );
      })()}

      {toReqTrack && (
        <Dialog open={!!toReqTrack} onClose={() => { setToReqTrack(null); setToReqClassId(""); }}>
          <DialogHeader>
            <DialogTitle>הוצא רמה לדרישה</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (toReqClassId !== "") {
                toRequirementMut.mutate({
                  trackId: toReqTrack.id,
                  classGroupId: Number(toReqClassId),
                });
              }
            }}
            className="space-y-4"
          >
            <p className="text-sm text-muted-foreground">
              רמה &quot;{toReqTrack.name}&quot; לא נוצרה מדרישה קיימת.
              בחר כיתה ליצירת דרישה חדשה:
            </p>
            <div>
              <Label htmlFor="to-req-class">כיתה</Label>
              <Select
                id="to-req-class"
                value={toReqClassId}
                onChange={(e) => setToReqClassId(e.target.value ? Number(e.target.value) : "")}
                required
              >
                <option value="">בחר כיתה</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={toRequirementMut.isPending || toReqClassId === ""}>
                {toRequirementMut.isPending ? "ממיר..." : "הוצא לדרישה"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setToReqTrack(null); setToReqClassId(""); }}>
                ביטול
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteClusterOrTrackMut.mutate()}
        title="אישור מחיקה"
        message={`האם למחוק את "${deleteTarget?.name}"? פעולה זו לא ניתנת לביטול.`}
        loading={deleteClusterOrTrackMut.isPending}
      />
    </div>
  );
}
