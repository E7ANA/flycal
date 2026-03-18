import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, RefreshCw, RotateCcw, Calendar, Lock, LockOpen, Users } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  fetchMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  refreshMeetingTeachers,
} from "@/api/meetings";
import { fetchTeachers } from "@/api/teachers";
import { fetchSchool, updateSchool } from "@/api/schools";
import { PinGrid } from "@/components/common/PinGrid";
import { fetchMeetingAvailableSlots } from "@/api/meetings";
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
import type { Meeting, MeetingType, Teacher } from "@/types/models";

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  HOMEROOM: "מחנכות",
  COORDINATORS: "רכזים",
  MANAGEMENT: "ניהול",
  CUSTOM: "מותאם אישית",
  PLENARY: "מליאה",
};

const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string }[] = [
  { value: "HOMEROOM", label: "מחנכות" },
  { value: "COORDINATORS", label: "רכזים" },
  { value: "MANAGEMENT", label: "ניהול" },
  { value: "CUSTOM", label: "מותאם אישית" },
];

const ROLE_FILTERS: { value: string; label: string }[] = [
  { value: "HOMEROOM", label: "מחנכ/ת" },
  { value: "COORDINATORS", label: "רכז/ת" },
  { value: "MANAGEMENT", label: "ניהול" },
  { value: "COUNSELOR", label: "יועצ/ת" },
];

function getTeachersByRole(teachers: Teacher[], role: string): number[] {
  switch (role) {
    case "HOMEROOM":
      return teachers
        .filter((t) => t.homeroom_class_id != null)
        .map((t) => t.id);
    case "COORDINATORS":
      return teachers.filter((t) => t.is_coordinator).map((t) => t.id);
    case "MANAGEMENT":
      return teachers
        .filter(
          (t) =>
            t.is_management ||
            t.is_principal ||
            t.is_director ||
            t.is_pedagogical_coordinator,
        )
        .map((t) => t.id);
    case "COUNSELOR":
      return teachers.filter((t) => t.is_counselor).map((t) => t.id);
    default:
      return [];
  }
}

function getAutoResolvedIds(
  teachers: Teacher[],
  meetingType: MeetingType,
): number[] {
  switch (meetingType) {
    case "HOMEROOM":
      return getTeachersByRole(teachers, "HOMEROOM");
    case "COORDINATORS":
      return getTeachersByRole(teachers, "COORDINATORS");
    case "MANAGEMENT":
      return getTeachersByRole(teachers, "MANAGEMENT");
    default:
      return [];
  }
}

// ─── Meeting Form ────────────────────────────────────────
function MeetingFormDialog({
  open,
  onClose,
  meeting,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  meeting: Meeting | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId),
  });

  const [name, setName] = useState(meeting?.name ?? "");
  const [meetingType, setMeetingType] = useState<MeetingType>(
    meeting?.meeting_type ?? "CUSTOM",
  );
  const [hoursPerWeek, setHoursPerWeek] = useState(
    meeting?.hours_per_week ?? 1,
  );
  const [color, setColor] = useState(meeting?.color ?? "#8B5CF6");
  const [pinnedSlots, setPinnedSlots] = useState<{ day: string; period: number }[]>(
    meeting?.pinned_slots ?? [],
  );
  const [blockedSlots, setBlockedSlots] = useState<{ day: string; period: number }[]>(
    meeting?.blocked_slots ?? [],
  );
  const [requireConsecutive, setRequireConsecutive] = useState(
    meeting?.require_consecutive ?? false,
  );
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>(
    () => {
      if (meeting?.teacher_ids?.length) return meeting.teacher_ids;
      // For new meetings with built-in types, pre-select by role
      if (!meeting && meetingType !== "CUSTOM") {
        return getAutoResolvedIds(teachers, meetingType);
      }
      return [];
    },
  );
  const [lockedTeacherIds, setLockedTeacherIds] = useState<number[]>(
    meeting?.locked_teacher_ids ?? [],
  );

  // When teachers load and we have a new built-in meeting with empty selection, auto-select
  const [didAutoSelect, setDidAutoSelect] = useState(!!meeting);
  if (
    !didAutoSelect &&
    teachers.length > 0 &&
    !meeting &&
    meetingType !== "CUSTOM" &&
    selectedTeacherIds.length === 0
  ) {
    setSelectedTeacherIds(getAutoResolvedIds(teachers, meetingType));
    setDidAutoSelect(true);
  }

  const createMut = useMutation({
    mutationFn: () =>
      createMeeting({
        school_id: schoolId,
        name,
        meeting_type: meetingType,
        hours_per_week: hoursPerWeek,
        is_active: true,
        color,
        teacher_ids: selectedTeacherIds,
        pinned_slots: pinnedSlots.length > 0 ? pinnedSlots : null,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        require_consecutive: requireConsecutive,
        locked_teacher_ids: lockedTeacherIds.length > 0 ? lockedTeacherIds : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", schoolId] });
      toast.success("ישיבה נוספה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת ישיבה"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateMeeting(meeting!.id, {
        name,
        meeting_type: meetingType,
        hours_per_week: hoursPerWeek,
        color,
        teacher_ids: selectedTeacherIds,
        pinned_slots: pinnedSlots.length > 0 ? pinnedSlots : null,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        require_consecutive: requireConsecutive,
        locked_teacher_ids: lockedTeacherIds.length > 0 ? lockedTeacherIds : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", schoolId] });
      toast.success("ישיבה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון ישיבה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  const toggleTeacher = (tid: number) => {
    setSelectedTeacherIds((prev) => {
      const removing = prev.includes(tid);
      if (removing) {
        // Also unlock if removing
        setLockedTeacherIds((lk) => lk.filter((id) => id !== tid));
        return prev.filter((id) => id !== tid);
      }
      return [...prev, tid];
    });
  };

  const toggleLock = (tid: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setLockedTeacherIds((prev) =>
      prev.includes(tid) ? prev.filter((id) => id !== tid) : [...prev, tid],
    );
  };

  const toggleRole = (role: string) => {
    const roleIds = getTeachersByRole(teachers, role);
    if (roleIds.length === 0) return;
    const allSelected = roleIds.every((id) =>
      selectedTeacherIds.includes(id),
    );
    if (allSelected) {
      // Remove all teachers of this role
      setSelectedTeacherIds((prev) =>
        prev.filter((id) => !roleIds.includes(id)),
      );
    } else {
      // Add all teachers of this role
      setSelectedTeacherIds((prev) => [
        ...new Set([...prev, ...roleIds]),
      ]);
    }
  };

  const isRoleFullySelected = (role: string) => {
    const roleIds = getTeachersByRole(teachers, role);
    return roleIds.length > 0 && roleIds.every((id) => selectedTeacherIds.includes(id));
  };

  const isRolePartiallySelected = (role: string) => {
    const roleIds = getTeachersByRole(teachers, role);
    return (
      roleIds.length > 0 &&
      roleIds.some((id) => selectedTeacherIds.includes(id)) &&
      !roleIds.every((id) => selectedTeacherIds.includes(id))
    );
  };

  const handleTypeChange = (newType: MeetingType) => {
    setMeetingType(newType);
    if (newType !== "CUSTOM" && teachers.length > 0) {
      setSelectedTeacherIds(getAutoResolvedIds(teachers, newType));
    }
  };

  const handleResetToRole = () => {
    if (meetingType !== "CUSTOM" && teachers.length > 0) {
      setSelectedTeacherIds(getAutoResolvedIds(teachers, meetingType));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{meeting ? "עריכת ישיבה" : "ישיבה חדשה"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          meeting ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="meeting-name">שם</Label>
          <Input
            id="meeting-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="שם הישיבה"
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="meeting-type">סוג</Label>
            <select
              id="meeting-type"
              value={meetingType}
              onChange={(e) =>
                handleTypeChange(e.target.value as MeetingType)
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {MEETING_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="hours">שעות/שבוע</Label>
            <Input
              id="hours"
              type="number"
              min={1}
              max={10}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="color">צבע</Label>
            <Input
              id="color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 p-1"
            />
          </div>
        </div>

        {hoursPerWeek >= 2 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={requireConsecutive}
              onChange={(e) => setRequireConsecutive(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-sm">שעה כפולה (שעות רצופות)</span>
          </label>
        )}

        {/* Hybrid teacher picker */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>
              מורים ({selectedTeacherIds.length})
            </Label>
            {meetingType !== "CUSTOM" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={handleResetToRole}
                title="רענן לפי תפקיד"
              >
                <RotateCcw className="h-3 w-3" />
                רענן לפי תפקיד
              </Button>
            )}
          </div>

          {/* Role filter pills */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ROLE_FILTERS.map((role) => {
              const count = getTeachersByRole(teachers, role.value).length;
              if (count === 0) return null;
              const full = isRoleFullySelected(role.value);
              const partial = isRolePartiallySelected(role.value);
              return (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => toggleRole(role.value)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                    full
                      ? "bg-primary text-primary-foreground border-primary"
                      : partial
                        ? "bg-primary/20 border-primary/50"
                        : "bg-background hover:bg-muted"
                  }`}
                >
                  {role.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Teacher name list */}
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
            {teachers.map((t) => {
              const isSelected = selectedTeacherIds.includes(t.id);
              const isLocked = lockedTeacherIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTeacher(t.id)}
                  className={`flex items-center gap-1 px-3 py-1 text-sm rounded-full border transition-colors cursor-pointer ${
                    isSelected
                      ? isLocked
                        ? "bg-amber-600 text-white border-amber-600"
                        : "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {t.name}
                  {isSelected && (
                    <span
                      onClick={(e) => toggleLock(t.id, e)}
                      className="mr-1 hover:opacity-70"
                      title={isLocked ? "נעול — חובה להשתתף" : "לחץ לנעול"}
                    >
                      {isLocked ? (
                        <Lock className="h-3 w-3" />
                      ) : (
                        <LockOpen className="h-3 w-3 opacity-40" />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
            {teachers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                אין מורים — הוסף מורים קודם
              </p>
            )}
          </div>
          {lockedTeacherIds.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              {lockedTeacherIds.length} מורים נעולים — חייבים להשתתף גם אם הישיבה לא חובה
            </p>
          )}
        </div>

        <div>
          <Label>נעילה / חסימה</Label>
          <PinGrid
            reqId={meeting?.id ?? 0}
            maxPins={hoursPerWeek}
            pinnedSlots={pinnedSlots}
            onChange={setPinnedSlots}
            blockedSlots={blockedSlots}
            onBlockedChange={setBlockedSlots}
            fetchSlots={fetchMeetingAvailableSlots}
            queryKeyPrefix="meeting-available-slots"
          />
        </div>

        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : meeting ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Plenary Form Dialog ────────────────────────────────
function PlenaryFormDialog({
  open,
  onClose,
  meeting,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  meeting: Meeting | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId),
  });

  const [name, setName] = useState(meeting?.name ?? "מליאה");
  const [hoursPerWeek, setHoursPerWeek] = useState(
    meeting?.hours_per_week ?? 1,
  );
  const [color, setColor] = useState(meeting?.color ?? "#DC2626");
  const [pinnedSlots, setPinnedSlots] = useState<{ day: string; period: number }[]>(
    meeting?.pinned_slots ?? [],
  );
  const [blockedSlots, setBlockedSlots] = useState<{ day: string; period: number }[]>(
    meeting?.blocked_slots ?? [],
  );
  const [alternativeSlots, setAlternativeSlots] = useState<{ day: string; period: number }[]>(
    meeting?.alternative_slots ?? [],
  );
  const [requireConsecutive, setRequireConsecutive] = useState(
    meeting?.require_consecutive ?? false,
  );
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>(
    meeting?.teacher_ids ?? [],
  );
  // For plenary: locked = mandatory attendance, unlocked = preferred attendance
  const [lockedTeacherIds, setLockedTeacherIds] = useState<number[]>(() => {
    if (meeting?.locked_teacher_ids?.length) return meeting.locked_teacher_ids;
    // New plenary: all teachers mandatory by default
    if (!meeting) return selectedTeacherIds;
    return meeting.teacher_ids ?? [];
  });

  const createMut = useMutation({
    mutationFn: () =>
      createMeeting({
        school_id: schoolId,
        name,
        meeting_type: "PLENARY",
        hours_per_week: hoursPerWeek,
        is_active: true,
        color,
        teacher_ids: selectedTeacherIds,
        pinned_slots: pinnedSlots.length > 0 ? pinnedSlots : null,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        alternative_slots: alternativeSlots.length > 0 ? alternativeSlots : null,
        require_consecutive: requireConsecutive,
        // Plenary is non-mandatory so the per-teacher model kicks in
        is_mandatory_attendance: false,
        locked_teacher_ids: lockedTeacherIds.length > 0 ? lockedTeacherIds : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", schoolId] });
      toast.success("ישיבת מליאה נוספה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת ישיבת מליאה"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateMeeting(meeting!.id, {
        name,
        meeting_type: "PLENARY",
        hours_per_week: hoursPerWeek,
        color,
        teacher_ids: selectedTeacherIds,
        pinned_slots: pinnedSlots.length > 0 ? pinnedSlots : null,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        alternative_slots: alternativeSlots.length > 0 ? alternativeSlots : null,
        require_consecutive: requireConsecutive,
        is_mandatory_attendance: false,
        locked_teacher_ids: lockedTeacherIds.length > 0 ? lockedTeacherIds : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", schoolId] });
      toast.success("ישיבת מליאה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון ישיבת מליאה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  const toggleTeacher = (tid: number) => {
    setSelectedTeacherIds((prev) => {
      const removing = prev.includes(tid);
      if (removing) {
        setLockedTeacherIds((lk) => lk.filter((id) => id !== tid));
        return prev.filter((id) => id !== tid);
      }
      // New teacher added — mandatory by default
      setLockedTeacherIds((lk) => [...lk, tid]);
      return [...prev, tid];
    });
  };

  const toggleAttendance = (tid: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setLockedTeacherIds((prev) =>
      prev.includes(tid) ? prev.filter((id) => id !== tid) : [...prev, tid],
    );
  };

  const toggleRole = (role: string) => {
    const roleIds = getTeachersByRole(teachers, role);
    if (roleIds.length === 0) return;
    const allSelected = roleIds.every((id) =>
      selectedTeacherIds.includes(id),
    );
    if (allSelected) {
      setSelectedTeacherIds((prev) =>
        prev.filter((id) => !roleIds.includes(id)),
      );
      setLockedTeacherIds((prev) =>
        prev.filter((id) => !roleIds.includes(id)),
      );
    } else {
      const newIds = roleIds.filter((id) => !selectedTeacherIds.includes(id));
      setSelectedTeacherIds((prev) => [...new Set([...prev, ...roleIds])]);
      // New teachers are mandatory by default
      setLockedTeacherIds((prev) => [...new Set([...prev, ...newIds])]);
    }
  };

  const isRoleFullySelected = (role: string) => {
    const roleIds = getTeachersByRole(teachers, role);
    return roleIds.length > 0 && roleIds.every((id) => selectedTeacherIds.includes(id));
  };

  const isRolePartiallySelected = (role: string) => {
    const roleIds = getTeachersByRole(teachers, role);
    return (
      roleIds.length > 0 &&
      roleIds.some((id) => selectedTeacherIds.includes(id)) &&
      !roleIds.every((id) => selectedTeacherIds.includes(id))
    );
  };

  const mandatoryCount = lockedTeacherIds.filter((id) => selectedTeacherIds.includes(id)).length;
  const preferredCount = selectedTeacherIds.length - mandatoryCount;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{meeting ? "עריכת ישיבת מליאה" : "ישיבת מליאה חדשה"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          meeting ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="plenary-name">שם</Label>
            <Input
              id="plenary-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="שם ישיבת המליאה"
              required
            />
          </div>
          <div>
            <Label htmlFor="plenary-hours">שעות/שבוע</Label>
            <Input
              id="plenary-hours"
              type="number"
              min={1}
              max={10}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="plenary-color">צבע</Label>
            <Input
              id="plenary-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 p-1"
            />
          </div>
        </div>

        {hoursPerWeek >= 2 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={requireConsecutive}
              onChange={(e) => setRequireConsecutive(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-sm">שעה כפולה (שעות רצופות)</span>
          </label>
        )}

        {/* Teacher picker with mandatory/preferred distinction */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>
              מורים ({selectedTeacherIds.length})
              {mandatoryCount > 0 && (
                <span className="text-xs text-muted-foreground mr-2">
                  {mandatoryCount} חובה, {preferredCount} מועדפים
                </span>
              )}
            </Label>
          </div>

          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3 text-rose-400" /> = נוכחות חובה
            </span>
            <span className="flex items-center gap-1">
              <LockOpen className="h-3 w-3 text-sky-400" /> = נוכחות מועדפת
            </span>
          </div>

          {/* Role-based selection with lock */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ROLE_FILTERS.map((role) => {
              const roleIds = getTeachersByRole(teachers, role.value);
              if (roleIds.length === 0) return null;
              const full = isRoleFullySelected(role.value);
              const partial = isRolePartiallySelected(role.value);
              const selectedInRole = roleIds.filter((id) => selectedTeacherIds.includes(id));
              const lockedInRole = selectedInRole.filter((id) => lockedTeacherIds.includes(id));
              const allLocked = selectedInRole.length > 0 && lockedInRole.length === selectedInRole.length;
              const hasAnySelected = selectedInRole.length > 0;
              return (
                <div key={role.value} className="flex items-center rounded-full border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleRole(role.value)}
                    className={`px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                      full
                        ? "bg-primary text-primary-foreground"
                        : partial
                          ? "bg-primary/20"
                          : "bg-background hover:bg-muted"
                    }`}
                  >
                    {role.label} ({roleIds.length})
                  </button>
                  {hasAnySelected && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (allLocked) {
                          const unlockSet = new Set(selectedInRole);
                          setLockedTeacherIds((prev) =>
                            prev.filter((id) => !unlockSet.has(id)),
                          );
                        } else {
                          setLockedTeacherIds((prev) => {
                            const merged = new Set(prev);
                            for (const id of selectedInRole) merged.add(id);
                            return Array.from(merged);
                          });
                        }
                      }}
                      className={`px-1.5 py-1 text-xs transition-colors cursor-pointer border-r ${
                        allLocked
                          ? "bg-rose-200 text-rose-800 hover:bg-rose-300"
                          : lockedInRole.length > 0
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                            : "bg-sky-100 text-sky-700 hover:bg-sky-200"
                      }`}
                      title={allLocked
                        ? `הסר נעילת חובה מ-${selectedInRole.length} ${role.label}`
                        : `נעל ${selectedInRole.length} ${role.label} כחובה`}
                    >
                      {allLocked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Teacher name list */}
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
            {teachers.map((t) => {
              const isSelected = selectedTeacherIds.includes(t.id);
              const isMandatory = lockedTeacherIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTeacher(t.id)}
                  className={`flex items-center gap-1 px-3 py-1 text-sm rounded-full border transition-colors cursor-pointer ${
                    isSelected
                      ? isMandatory
                        ? "bg-rose-200 text-rose-900 border-rose-300"
                        : "bg-sky-200 text-sky-900 border-sky-300"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {t.name}
                  {isSelected && (
                    <span
                      onClick={(e) => toggleAttendance(t.id, e)}
                      className="mr-1 hover:opacity-70"
                      title={isMandatory ? "נוכחות חובה — לחץ לשנות למועדפת" : "נוכחות מועדפת — לחץ לשנות לחובה"}
                    >
                      {isMandatory ? (
                        <Lock className="h-3 w-3" />
                      ) : (
                        <LockOpen className="h-3 w-3" />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
            {teachers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                אין מורים — הוסף מורים קודם
              </p>
            )}
          </div>
        </div>

        <div>
          <Label>נעילה / חלופי / חסימה</Label>
          <PinGrid
            reqId={meeting?.id ?? 0}
            maxPins={hoursPerWeek}
            pinnedSlots={pinnedSlots}
            onChange={setPinnedSlots}
            blockedSlots={blockedSlots}
            onBlockedChange={setBlockedSlots}
            alternativeSlots={alternativeSlots}
            onAlternativeChange={setAlternativeSlots}
            maxAlternative={hoursPerWeek}
            fetchSlots={fetchMeetingAvailableSlots}
            queryKeyPrefix="meeting-available-slots"
          />
          <p className="text-xs text-muted-foreground mt-1">
            כחול = מיקום ראשי | צהוב = מיקום חלופי — הסולבר יבחר אחד מהשניים
          </p>
        </div>

        <div className="rounded-md border border-amber-100 bg-amber-50/60 p-3 text-sm text-amber-700">
          <strong>ישיבת מליאה:</strong> לא ניתן לקיים ישיבות אחרות במקביל.
          מורים עם נוכחות חובה חייבים להיות פנויים. מורים עם נוכחות מועדפת — ככל שיהיו יותר נוכחים הניקוד גבוה יותר.
        </div>

        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : meeting ? "עדכן" : "צור"}
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
export default function MeetingsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Meeting | null>(null);
  const [plenaryFormOpen, setPlenaryFormOpen] = useState(false);
  const [editingPlenary, setEditingPlenary] = useState<Meeting | null>(null);

  const { data: allMeetings = [] } = useQuery({
    queryKey: ["meetings", schoolId],
    queryFn: () => fetchMeetings(schoolId!),
    enabled: !!schoolId,
  });

  // Split plenary from regular meetings
  const meetings = allMeetings.filter((m) => m.meeting_type !== "PLENARY");
  const plenaryMeetings = allMeetings.filter((m) => m.meeting_type === "PLENARY");

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId!),
    enabled: !!schoolId,
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteMeeting(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", schoolId] });
      toast.success(deleteTarget?.meeting_type === "PLENARY" ? "ישיבת מליאה נמחקה" : "ישיבה נמחקה");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  const refreshMut = useMutation({
    mutationFn: (id: number) => refreshMeetingTeachers(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", schoolId] });
      toast.success("מורים עודכנו");
    },
    onError: () => toast.error("שגיאה ברענון מורים"),
  });

  const { data: school } = useQuery({
    queryKey: ["school", schoolId],
    queryFn: () => fetchSchool(schoolId!),
    enabled: !!schoolId,
  });

  const [maxConsecMeetings, setMaxConsecMeetings] = useState(4);

  // Sync state when school loads
  if (school && maxConsecMeetings !== school.max_consecutive_meetings) {
    setMaxConsecMeetings(school.max_consecutive_meetings);
  }

  const updateMaxConsecMut = useMutation({
    mutationFn: (val: number) => updateSchool(schoolId!, { max_consecutive_meetings: val }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["school", schoolId] });
    },
  });

  const teacherMap = Object.fromEntries(teachers.map((t) => [t.id, t.name]));

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Plenary Section ────────────────────────────── */}
      <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-rose-400" />
            <h3 className="text-lg font-bold text-rose-800">ישיבת מליאה</h3>
          </div>
          {plenaryMeetings.length === 0 && (
            <Button
              size="sm"
              className="bg-rose-400 hover:bg-rose-500"
              onClick={() => {
                setEditingPlenary(null);
                setPlenaryFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              הוסף ישיבת מליאה
            </Button>
          )}
        </div>

        {plenaryMeetings.length > 0 ? (
          plenaryMeetings.map((plenary) => {
            const mandatoryIds = new Set(plenary.locked_teacher_ids ?? []);
            const mandatoryTeachers = plenary.teacher_ids.filter((id) => mandatoryIds.has(id));
            const preferredTeachers = plenary.teacher_ids.filter((id) => !mandatoryIds.has(id));
            return (
              <div key={plenary.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{plenary.name}</span>
                    <Badge variant="outline">{plenary.hours_per_week} שעות/שבוע</Badge>
                    <Badge variant={plenary.is_active ? "default" : "outline"}>
                      {plenary.is_active ? "פעילה" : "לא פעילה"}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingPlenary(plenary);
                        setPlenaryFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(plenary)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {mandatoryTeachers.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-rose-600 mb-1 block">
                      נוכחות חובה ({mandatoryTeachers.length})
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {mandatoryTeachers.map((tid) => (
                        <Badge key={tid} className="text-xs bg-rose-300 text-rose-900">
                          <Lock className="h-3 w-3 ml-1" />
                          {teacherMap[tid] ?? tid}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {preferredTeachers.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-sky-600 mb-1 block">
                      נוכחות מועדפת ({preferredTeachers.length})
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {preferredTeachers.map((tid) => (
                        <Badge key={tid} variant="outline" className="text-xs border-sky-300 text-sky-700 bg-sky-50">
                          <LockOpen className="h-3 w-3 ml-1" />
                          {teacherMap[tid] ?? tid}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">
            אין ישיבת מליאה — הוסף כדי לתזמן ישיבה שבה כל הצוות נפגש
          </p>
        )}
      </div>

      {/* ── Regular Meetings Section ───────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">ישיבות</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("/results?view=meetings")}
          >
            <Calendar className="h-4 w-4" />
            צפה במערכת ישיבות
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            ישיבה חדשה
          </Button>
        </div>
      </div>

      <DataTable
        compact
        keyField="id"
        data={meetings}
        columns={[
          { header: "שם", accessor: "name" },
          {
            header: "סוג",
            accessor: (m) => (
              <Badge variant="secondary">
                {MEETING_TYPE_LABELS[m.meeting_type]}
              </Badge>
            ),
          },
          {
            header: "שעות/שבוע",
            accessor: (m) => String(m.hours_per_week),
          },
          {
            header: "מורים",
            accessor: (m) => {
              const lockedSet = new Set(m.locked_teacher_ids ?? []);
              const names = m.teacher_ids
                .map((tid) => ({
                  id: tid,
                  name: teacherMap[tid] ?? String(tid),
                  locked: lockedSet.has(tid),
                }))
                .sort((a, b) => a.name.localeCompare(b.name, "he"));
              return (
                <div>
                  <span className="text-xs text-muted-foreground mb-1 block">
                    {m.teacher_ids.length} מורים
                    {lockedSet.size > 0 && ` (${lockedSet.size} נעולים)`}
                  </span>
                  <span className="text-xs leading-relaxed">
                    {names.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && ", "}
                        <span className={t.locked ? "font-semibold text-amber-700" : ""}>
                          {t.name}
                        </span>
                      </span>
                    ))}
                  </span>
                </div>
              );
            },
          },
          {
            header: "סטטוס",
            accessor: (m) => (
              <Badge variant={m.is_active ? "default" : "outline"}>
                {m.is_active ? "פעילה" : "לא פעילה"}
              </Badge>
            ),
          },
          {
            header: "פעולות",
            accessor: (m) => (
              <div className="flex gap-1">
                {m.meeting_type !== "CUSTOM" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="רענן מורים"
                    onClick={(e) => {
                      e.stopPropagation();
                      refreshMut.mutate(m.id);
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(m);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(m);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
            className: "w-32",
          },
        ]}
        emptyMessage="אין ישיבות — הוסף ישיבה חדשה"
      />

      {formOpen && (
        <MeetingFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          meeting={editing}
          schoolId={schoolId}
        />
      )}

      {plenaryFormOpen && (
        <PlenaryFormDialog
          open={plenaryFormOpen}
          onClose={() => setPlenaryFormOpen(false)}
          meeting={editingPlenary}
          schoolId={schoolId}
        />
      )}

      {/* ── Meeting Settings ─────────────────────────── */}
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">הגדרות ישיבות</h3>
        <div className="flex items-center gap-3">
          <Label htmlFor="max-consec" className="text-sm whitespace-nowrap">
            מקסימום שעות ישיבה ברצף ללא שיעור פרונטלי
          </Label>
          <Input
            id="max-consec"
            type="number"
            min={0}
            max={8}
            className="w-20"
            value={maxConsecMeetings}
            onChange={(e) => {
              const val = Number(e.target.value);
              setMaxConsecMeetings(val);
              updateMaxConsecMut.mutate(val);
            }}
          />
          <span className="text-xs text-muted-foreground">(0 = ללא הגבלה)</span>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה"
        message={`האם למחוק את הישיבה "${deleteTarget?.name}"? פעולה זו לא ניתנת לביטול.`}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
