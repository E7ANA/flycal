import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Calendar } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  fetchTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
} from "@/api/teachers";
import { fetchSubjects } from "@/api/subjects";
import { fetchClasses } from "@/api/classes";
import { fetchSchool } from "@/api/schools";
import { Button } from "@/components/common/Button";
import { DataTable } from "@/components/common/DataTable";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/common/Input";
import { Label } from "@/components/common/Label";
import { Badge } from "@/components/common/Badge";
import { InlineConstraints } from "@/components/common/InlineConstraints";
import type { Teacher, BlockedSlot } from "@/types/models";
import { getSubjectColor } from "@/lib/subjectColors";

const DAY_ORDER = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const DAY_LABELS: Record<string, string> = {
  SUNDAY: "א׳",
  MONDAY: "ב׳",
  TUESDAY: "ג׳",
  WEDNESDAY: "ד׳",
  THURSDAY: "ה׳",
  FRIDAY: "ו׳",
};

// ─── Availability Grid ──────────────────────────────────
function AvailabilityGrid({
  blockedSlots,
  onChange,
  days,
  periodsPerDay,
}: {
  blockedSlots: BlockedSlot[];
  onChange: (slots: BlockedSlot[]) => void;
  days: string[];
  periodsPerDay: Record<string, number>;
}) {
  const maxPeriods = Math.max(...Object.values(periodsPerDay), 0);
  const isBlocked = (day: string, period: number) =>
    blockedSlots.some((s) => s.day === day && s.period === period);

  const toggle = (day: string, period: number) => {
    if (isBlocked(day, period)) {
      onChange(blockedSlots.filter((s) => !(s.day === day && s.period === period)));
    } else {
      onChange([...blockedSlots, { day, period }]);
    }
  };

  const toggleDay = (day: string) => {
    const periods = periodsPerDay[day] ?? maxPeriods;
    const allBlocked = Array.from({ length: periods }, (_, i) => i + 1).every((p) =>
      isBlocked(day, p),
    );
    if (allBlocked) {
      onChange(blockedSlots.filter((s) => s.day !== day));
    } else {
      const remaining = blockedSlots.filter((s) => s.day !== day);
      const newSlots = Array.from({ length: periods }, (_, i) => ({
        day,
        period: i + 1,
      }));
      onChange([...remaining, ...newSlots]);
    }
  };

  if (days.length === 0 || maxPeriods === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        אין נתוני בית ספר — הגדר בית ספר קודם
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-center text-xs">
        <thead>
          <tr>
            <th className="p-1 w-10" />
            {days.map((day) => (
              <th key={day} className="p-1 min-w-[40px]">
                <button
                  type="button"
                  onClick={() => toggleDay(day)}
                  className="cursor-pointer hover:text-primary font-medium"
                >
                  {DAY_LABELS[day] ?? day}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxPeriods }, (_, i) => i + 1).map((period) => (
            <tr key={period}>
              <td className="p-1 font-medium text-muted-foreground">{period}</td>
              {days.map((day) => {
                const periods = periodsPerDay[day] ?? maxPeriods;
                if (period > periods) {
                  return <td key={day} className="p-1" />;
                }
                const blocked = isBlocked(day, period);
                return (
                  <td key={day} className="p-0.5">
                    <button
                      type="button"
                      onClick={() => toggle(day, period)}
                      className={`w-8 h-7 rounded border transition-colors cursor-pointer ${
                        blocked
                          ? "bg-destructive/20 border-destructive/40 text-destructive"
                          : "bg-green-50 border-green-200 hover:bg-green-100 dark:bg-green-950/30 dark:border-green-800"
                      }`}
                      title={
                        blocked
                          ? `${DAY_LABELS[day]} שעה ${period} — חסום`
                          : `${DAY_LABELS[day]} שעה ${period} — פנוי`
                      }
                    >
                      {blocked ? "✕" : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground mt-1">
        לחץ על תא כדי לחסום/לשחרר. לחץ על יום כדי לחסום/לשחרר יום שלם.
      </p>
    </div>
  );
}

// ─── Teacher Form ────────────────────────────────────────
function TeacherFormDialog({
  open,
  onClose,
  teacher,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  teacher: Teacher | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId),
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId),
  });
  const { data: school } = useQuery({
    queryKey: ["school", schoolId],
    queryFn: () => fetchSchool(schoolId),
  });

  const [name, setName] = useState(teacher?.name ?? "");
  const [maxHours, setMaxHours] = useState(teacher?.max_hours_per_week ?? 40);
  const [minHours, setMinHours] = useState(teacher?.min_hours_per_week ?? 0);
  const [rubricaHours, setRubricaHours] = useState<string>(
    teacher?.rubrica_hours != null ? String(teacher.rubrica_hours) : "",
  );
  const [maxWorkDays, setMaxWorkDays] = useState<string>(
    teacher?.max_work_days != null ? String(teacher.max_work_days) : "",
  );
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<number[]>(
    teacher?.subject_ids ?? [],
  );
  const [isCoordinator, setIsCoordinator] = useState(
    teacher?.is_coordinator ?? false,
  );
  const [homeroomClassId, setHomeroomClassId] = useState<number | null>(
    teacher?.homeroom_class_id ?? null,
  );
  const [isManagement, setIsManagement] = useState(
    teacher?.is_management ?? false,
  );
  const [isCounselor, setIsCounselor] = useState(
    teacher?.is_counselor ?? false,
  );
  const [isPrincipal, setIsPrincipal] = useState(
    teacher?.is_principal ?? false,
  );
  const [isPedagogicalCoordinator, setIsPedagogicalCoordinator] = useState(
    teacher?.is_pedagogical_coordinator ?? false,
  );
  const [isDirector, setIsDirector] = useState(
    teacher?.is_director ?? false,
  );
  const [transportPriority, setTransportPriority] = useState<string>(
    teacher?.transport_priority != null ? String(teacher.transport_priority) : "",
  );
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>(
    teacher?.blocked_slots ?? [],
  );

  // Build days and periods from school config
  const schoolDays = school
    ? DAY_ORDER.slice(0, school.days_per_week + (school.week_start_day === "SUNDAY" ? 1 : 0)).filter(
        (d) => DAY_ORDER.indexOf(d) < (school.week_start_day === "SUNDAY" ? 6 : school.days_per_week),
      )
    : [];
  const activeDays = school
    ? (() => {
        const start = DAY_ORDER.indexOf(school.week_start_day);
        const days: string[] = [];
        for (let i = 0; i < school.days_per_week; i++) {
          days.push(DAY_ORDER[(start + i) % DAY_ORDER.length]);
        }
        return days;
      })()
    : [];
  const periodsPerDay: Record<string, number> = {};
  if (school) {
    for (const day of activeDays) {
      periodsPerDay[day] = school.periods_per_day_map?.[day] ?? school.periods_per_day;
    }
  }

  const createMut = useMutation({
    mutationFn: () =>
      createTeacher({
        school_id: schoolId,
        name,
        max_hours_per_week: maxHours,
        min_hours_per_week: minHours || null,
        rubrica_hours: rubricaHours !== "" ? Number(rubricaHours) : null,
        max_work_days: maxWorkDays !== "" ? Number(maxWorkDays) : null,
        subject_ids: selectedSubjectIds,
        is_coordinator: isCoordinator,
        homeroom_class_id: homeroomClassId,
        is_management: isManagement,
        is_counselor: isCounselor,
        is_principal: isPrincipal,
        is_pedagogical_coordinator: isPedagogicalCoordinator,
        is_director: isDirector,
        transport_priority: transportPriority !== "" ? Number(transportPriority) : null,
        blocked_slots: blockedSlots,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
      toast.success("מורה נוסף/ה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת מורה"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateTeacher(teacher!.id, {
        name,
        max_hours_per_week: maxHours,
        min_hours_per_week: minHours || null,
        rubrica_hours: rubricaHours !== "" ? Number(rubricaHours) : null,
        max_work_days: maxWorkDays !== "" ? Number(maxWorkDays) : null,
        subject_ids: selectedSubjectIds,
        is_coordinator: isCoordinator,
        homeroom_class_id: homeroomClassId,
        is_management: isManagement,
        is_counselor: isCounselor,
        is_principal: isPrincipal,
        is_pedagogical_coordinator: isPedagogicalCoordinator,
        is_director: isDirector,
        transport_priority: transportPriority !== "" ? Number(transportPriority) : null,
        blocked_slots: blockedSlots,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
      toast.success("מורה עודכן/ה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון מורה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  const toggleSubject = (sid: number) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid],
    );
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{teacher ? "עריכת מורה" : "מורה חדש/ה"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          teacher ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="teacher-name">שם</Label>
          <Input
            id="teacher-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="שם המורה"
            required
          />
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label htmlFor="max-hours">ש׳ פרונטליות</Label>
            <Input
              id="max-hours"
              type="number"
              min={0}
              value={maxHours}
              onChange={(e) => setMaxHours(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="min-hours">מינ׳ שעות</Label>
            <Input
              id="min-hours"
              type="number"
              min={0}
              value={minHours}
              onChange={(e) => setMinHours(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="rubrica-hours">שעות משרה</Label>
            <Input
              id="rubrica-hours"
              type="number"
              min={0}
              step={0.5}
              value={rubricaHours}
              onChange={(e) => setRubricaHours(e.target.value)}
              placeholder="שעות"
            />
            {maxWorkDays === "" && (
              <p className="text-xs text-muted-foreground mt-1">
                {rubricaHours !== "" && Number(rubricaHours) > 0
                  ? Number(rubricaHours) > 27
                    ? "→ עד 4 ימי עבודה"
                    : Number(rubricaHours) >= 20
                      ? "→ עד 3 ימי עבודה"
                      : "→ עד 2 ימי עבודה"
                  : "לא הוגדרו — ימי עבודה ייקבעו לפי שעות משרה"}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="max-work-days">ימי עבודה (ידני)</Label>
            <Input
              id="max-work-days"
              type="number"
              min={1}
              max={6}
              value={maxWorkDays}
              onChange={(e) => setMaxWorkDays(e.target.value)}
              placeholder="אוטומטי"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {maxWorkDays !== ""
                ? `→ ${maxWorkDays} ימי עבודה (גובר על חישוב אוטומטי)`
                : "ריק = חישוב אוטומטי לפי שעות משרה"}
            </p>
          </div>
        </div>

        <div>
          <Label>תפקידים</Label>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isCoordinator}
                onChange={(e) => setIsCoordinator(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">רכז/ת מקצוע</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isManagement}
                onChange={(e) => setIsManagement(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">צוות ניהולי</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isCounselor}
                onChange={(e) => setIsCounselor(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">יועצת</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrincipal}
                onChange={(e) => setIsPrincipal(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">מנהלת ב״ס</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPedagogicalCoordinator}
                onChange={(e) => setIsPedagogicalCoordinator(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">רכזת פדגוגית</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isDirector}
                onChange={(e) => setIsDirector(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">מנהלת</span>
            </label>
            <div>
              <Label htmlFor="transport-priority">עדיפות יום מוקדם (1-100, ריק = ללא)</Label>
              <Input
                id="transport-priority"
                type="number"
                min={0}
                max={100}
                value={transportPriority}
                onChange={(e) => setTransportPriority(e.target.value)}
                placeholder="ללא"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={homeroomClassId !== null}
                  onChange={(e) =>
                    setHomeroomClassId(e.target.checked ? (classes[0]?.id ?? null) : null)
                  }
                  className="rounded border-border"
                />
                <span className="text-sm">מחנך/ת כיתה</span>
              </label>
              {homeroomClassId !== null && (
                <select
                  value={homeroomClassId ?? ""}
                  onChange={(e) => setHomeroomClassId(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        <div>
          <Label>מקצועות</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {subjects.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSubject(s.id)}
                className={`px-3 py-1 text-sm rounded-full border transition-colors cursor-pointer ${
                  selectedSubjectIds.includes(s.id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {s.name}
              </button>
            ))}
            {subjects.length === 0 && (
              <p className="text-sm text-muted-foreground">
                אין מקצועות — הוסף מקצועות קודם
              </p>
            )}
          </div>
        </div>

        <div>
          <Label>
            שעות חסומות
            {blockedSlots.length > 0 && (
              <span className="text-muted-foreground font-normal ms-2">
                ({blockedSlots.length} חסומות)
              </span>
            )}
          </Label>
          <div className="mt-2">
            <AvailabilityGrid
              blockedSlots={blockedSlots}
              onChange={setBlockedSlots}
              days={activeDays}
              periodsPerDay={periodsPerDay}
            />
          </div>
        </div>

        {teacher && (
          <InlineConstraints
            schoolId={schoolId}
            category="TEACHER"
            targetId={teacher.id}
            targetName={teacher.name}
          />
        )}

        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : teacher ? "עדכן" : "צור"}
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
export default function TeachersPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);
  const [blocksTarget, setBlocksTarget] = useState<Teacher | null>(null);

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

  const { data: school } = useQuery({
    queryKey: ["school", schoolId],
    queryFn: () => fetchSchool(schoolId!),
    enabled: !!schoolId,
  });



  const deleteMut = useMutation({
    mutationFn: () => deleteTeacher(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
      toast.success("מורה נמחק/ה");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  const saveBlocksMut = useMutation({
    mutationFn: (params: { id: number; blocked_slots: BlockedSlot[] }) =>
      updateTeacher(params.id, { blocked_slots: params.blocked_slots }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
      toast.success("חסימות עודכנו");
      setBlocksTarget(null);
    },
    onError: () => toast.error("שגיאה בעדכון חסימות"),
  });

  // School days for blocked-slots grid
  const activeDays = school
    ? (() => {
        const start = DAY_ORDER.indexOf(school.week_start_day);
        const days: string[] = [];
        for (let i = 0; i < school.days_per_week; i++) {
          days.push(DAY_ORDER[(start + i) % DAY_ORDER.length]);
        }
        return days;
      })()
    : [];
  const periodsPerDay: Record<string, number> = {};
  if (school) {
    for (const day of activeDays) {
      periodsPerDay[day] = school.periods_per_day_map?.[day] ?? school.periods_per_day;
    }
  }

  const subjectMap = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]));

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
        <h2 className="text-2xl font-bold">מורים</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          מורה חדש/ה
        </Button>
      </div>

      <DataTable
        compact
        searchable
        searchPlaceholder="חיפוש מורה..."
        keyField="id"
        data={[...teachers].sort((a, b) => a.name.localeCompare(b.name, "he"))}
        columns={[
          { header: "שם", accessor: "name" },
          {
            header: "ש׳ פרונטליות",
            accessor: (t) =>
              t.min_hours_per_week
                ? `${t.min_hours_per_week}–${t.max_hours_per_week}`
                : String(t.max_hours_per_week),
          },
          {
            header: "שעות משרה",
            accessor: (t) =>
              t.rubrica_hours != null
                ? String(t.rubrica_hours)
                : "—",
            className: "w-20",
          },
          {
            header: "ימי עבודה",
            accessor: (t) => {
              if (t.max_work_days != null) {
                return (
                  <span className="font-medium" title="הוגדר ידנית">
                    {t.max_work_days} ימים
                  </span>
                );
              }
              const rubrica = t.rubrica_hours;
              let maxDays: number | null = null;
              if (rubrica != null && rubrica > 0) {
                if (rubrica > 27) maxDays = 4;
                else if (rubrica >= 20) maxDays = 3;
                else maxDays = 2;
              }
              return maxDays != null ? (
                <span className="text-muted-foreground" title="לפי שעות משרה">
                  {maxDays} ימים
                </span>
              ) : "—";
            },
            className: "w-24",
          },
          {
            header: "תפקידים",
            accessor: (t) => (
              <div className="flex flex-wrap gap-1">
                {t.is_coordinator && <Badge variant="default">רכז מקצוע</Badge>}
                {t.homeroom_class_id != null && (
                  <Badge variant="secondary">
                    מחנך/ת {classMap[t.homeroom_class_id] ?? ""}
                  </Badge>
                )}
                {t.is_management && <Badge variant="outline">צוות ניהולי</Badge>}
                {t.is_counselor && <Badge variant="outline">יועצת</Badge>}
                {t.is_principal && <Badge variant="outline">מנהלת ב״ס</Badge>}
                {t.is_pedagogical_coordinator && <Badge variant="outline">רכזת פדגוגית</Badge>}
                {t.is_director && <Badge variant="outline">מנהלת</Badge>}
                {t.transport_priority != null && t.transport_priority > 0 && (
                  <Badge variant="outline">יום מוקדם</Badge>
                )}
              </div>
            ),
          },
          {
            header: "חסימות",
            accessor: (t) => {
              const slots = t.blocked_slots ?? [];
              if (slots.length === 0) {
                return <span className="text-muted-foreground text-sm">—</span>;
              }

              // Group blocked slots by day
              const daySlots: Record<string, number[]> = {};
              for (const s of slots) {
                if (!daySlots[s.day]) daySlots[s.day] = [];
                daySlots[s.day].push(s.period);
              }

              return (
                <div className="flex flex-wrap gap-1 items-center">
                  {DAY_ORDER.filter((d) => daySlots[d]).map((day) => {
                    const periods = daySlots[day].sort((a, b) => a - b);
                    const maxPeriods = periodsPerDay[day] ?? school?.periods_per_day ?? 8;
                    const isFullDay = periods.length >= maxPeriods;
                    return (
                      <Badge
                        key={day}
                        variant={isFullDay ? "destructive" : "outline"}
                        className="text-[10px] px-1.5 py-0"
                        title={isFullDay
                          ? `${DAY_LABELS[day]} — יום חסום`
                          : `${DAY_LABELS[day]} — שעות ${periods.join(",")}`
                        }
                      >
                        {DAY_LABELS[day]}
                        {!isFullDay && (
                          <span className="text-muted-foreground mr-0.5">
                            ({periods.length})
                          </span>
                        )}
                      </Badge>
                    );
                  })}
                </div>
              );
            },
          },
          {
            header: "מקצועות",
            accessor: (t) => (
              <div className="flex flex-wrap gap-1">
                {t.subject_ids.map((sid) => {
                  const sc = getSubjectColor(subjectMap[sid]?.color);
                  return (
                    <Badge
                      key={sid}
                      variant="secondary"
                      style={{
                        backgroundColor: sc.bg,
                        color: sc.text,
                      }}
                    >
                      {subjectMap[sid]?.name ?? sid}
                    </Badge>
                  );
                })}
              </div>
            ),
          },
          {
            header: "יום מוקדם",
            accessor: (t) => {
              const val = t.transport_priority;
              return (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {val != null && val > 0 ? (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="w-12 rounded border bg-background px-1 py-0.5 text-sm text-center"
                      value={val}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateTeacher(t.id, {
                          transport_priority: v !== "" && Number(v) > 0 ? Number(v) : null,
                        }).then(() =>
                          qc.invalidateQueries({ queryKey: ["teachers", schoolId] }),
                        );
                      }}
                    />
                  ) : (
                    <button
                      className="text-xs text-primary hover:underline cursor-pointer"
                      onClick={() => {
                        updateTeacher(t.id, { transport_priority: 70 }).then(() =>
                          qc.invalidateQueries({ queryKey: ["teachers", schoolId] }),
                        );
                      }}
                    >
                      + הוסף
                    </button>
                  )}
                </div>
              );
            },
            className: "w-20",
          },
          {
            header: "פעולות",
            accessor: (t) => (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="צפה במערכת"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/results?view=teacher&id=${t.id}`);
                  }}
                >
                  <Calendar className="h-4 w-4 text-primary" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="עריכה"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(t);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="מחיקה"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(t);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
            className: "w-28",
          },
        ]}
        emptyMessage="אין מורים — הוסף מורה חדש/ה"
      />

      {formOpen && (
        <TeacherFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          teacher={editing}
          schoolId={schoolId}
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

      {blocksTarget && (
        <BlockedSlotsDialog
          teacher={blocksTarget}
          onClose={() => setBlocksTarget(null)}
          onSave={(slots) => saveBlocksMut.mutate({ id: blocksTarget.id, blocked_slots: slots })}
          saving={saveBlocksMut.isPending}
          days={activeDays}
          periodsPerDay={periodsPerDay}
        />
      )}
    </div>
  );
}

// ─── Quick Blocked Slots Dialog ──────────────────────────
function BlockedSlotsDialog({
  teacher,
  onClose,
  onSave,
  saving,
  days,
  periodsPerDay,
}: {
  teacher: Teacher;
  onClose: () => void;
  onSave: (slots: BlockedSlot[]) => void;
  saving: boolean;
  days: string[];
  periodsPerDay: Record<string, number>;
}) {
  const [slots, setSlots] = useState<BlockedSlot[]>(teacher.blocked_slots ?? []);

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>חסימות — {teacher.name}</DialogTitle>
      </DialogHeader>
      <div className="py-2">
        <AvailabilityGrid
          blockedSlots={slots}
          onChange={setSlots}
          days={days}
          periodsPerDay={periodsPerDay}
        />
      </div>
      <DialogFooter>
        <Button onClick={() => onSave(slots)} disabled={saving}>
          {saving ? "שומר..." : "שמור"}
        </Button>
        <Button variant="outline" onClick={onClose}>ביטול</Button>
      </DialogFooter>
    </Dialog>
  );
}
