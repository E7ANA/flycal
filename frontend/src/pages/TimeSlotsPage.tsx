import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, School, GraduationCap } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { useActiveSchool } from "@/hooks/useSchool";
import { fetchTimeSlots, generateTimeSlots, batchUpdateTimeSlots } from "@/api/timeslots";
import { fetchGrades } from "@/api/grades";
import { fetchConstraints, createConstraint, updateConstraint } from "@/api/constraints";
import { Button } from "@/components/common/Button";
import { Label } from "@/components/common/Label";
import { Input } from "@/components/common/Input";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";
import type { Grade } from "@/types/models";

type SelectedNav = { type: "school" } | { type: "grade"; id: number };

export default function TimeSlotsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const { data: school } = useActiveSchool();

  const [selected, setSelected] = useState<SelectedNav>({ type: "school" });

  const { data: slots = [] } = useQuery({
    queryKey: ["timeslots", schoolId],
    queryFn: () => fetchTimeSlots(schoolId!),
    enabled: !!schoolId,
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades", schoolId],
    queryFn: () => fetchGrades(schoolId!),
    enabled: !!schoolId,
  });

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  const generateMut = useMutation({
    mutationFn: () => generateTimeSlots(schoolId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timeslots", schoolId] });
      toast.success("משבצות זמן נוצרו בהצלחה");
    },
    onError: () => toast.error("שגיאה ביצירת משבצות זמן"),
  });

  const batchMut = useMutation({
    mutationFn: (updates: { id: number; is_available: boolean }[]) =>
      batchUpdateTimeSlots(schoolId!, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timeslots", schoolId] });
    },
  });

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">שעות פעילות</h2>
        <div className="flex flex-col items-center gap-4 py-12">
          <p className="text-muted-foreground">
            לא הוגדרו משבצות זמן עדיין. צור משבצות לפי הגדרות בית הספר.
          </p>
          <Button
            onClick={() => generateMut.mutate()}
            disabled={generateMut.isPending}
          >
            <RefreshCw className="h-4 w-4" />
            {generateMut.isPending ? "יוצר..." : "צור משבצות זמן"}
          </Button>
        </div>
      </div>
    );
  }

  // Derive grid structure from slots
  const activeDays = DAYS_ORDER.filter((d) =>
    slots.some((s) => s.day === d),
  );
  const maxPeriod = Math.max(...slots.map((s) => s.period));
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

  // Build lookup: (day, period) -> slot
  const slotMap = new Map<string, (typeof slots)[0]>();
  for (const s of slots) {
    slotMap.set(`${s.day}-${s.period}`, s);
  }

  const toggleSlot = (day: string, period: number) => {
    const key = `${day}-${period}`;
    const slot = slotMap.get(key);
    if (!slot) return;
    batchMut.mutate([{ id: slot.id, is_available: !slot.is_available }]);
  };

  const toggleDay = (day: string) => {
    const daySlots = slots.filter((s) => s.day === day);
    const allAvailable = daySlots.every((s) => s.is_available);
    const updates = daySlots.map((s) => ({
      id: s.id,
      is_available: !allAvailable,
    }));
    batchMut.mutate(updates);
  };

  const togglePeriod = (period: number) => {
    const periodSlots = slots.filter((s) => s.period === period);
    const allAvailable = periodSlots.every((s) => s.is_available);
    const updates = periodSlots.map((s) => ({
      id: s.id,
      is_available: !allAvailable,
    }));
    batchMut.mutate(updates);
  };

  const sortedGrades = [...grades].sort((a, b) => a.level - b.level);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">שעות פעילות</h2>
          <p className="text-sm text-muted-foreground mt-1">
            הגדר שעות פעילות ברמת בית הספר ולפי שכבה
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => generateMut.mutate()}
          disabled={generateMut.isPending}
        >
          <RefreshCw className="h-4 w-4" />
          איפוס משבצות
        </Button>
      </div>

      <div className="flex gap-6" style={{ minHeight: "calc(100vh - 220px)" }}>
        {/* ── Right: Navigation Sidebar ── */}
        <div className="w-48 shrink-0 space-y-1 border-e pe-4">
          <h3 className="text-sm font-bold text-muted-foreground mb-3">ניווט</h3>
          <button
            onClick={() => setSelected({ type: "school" })}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              selected.type === "school"
                ? "bg-primary/10 text-primary font-medium"
                : "text-foreground hover:bg-muted"
            }`}
          >
            <School className="h-4 w-4" />
            בית ספרי
          </button>

          {sortedGrades.length > 0 && (
            <div className="pt-2 mt-2 border-t space-y-1">
              <span className="text-xs font-bold text-muted-foreground px-2">שכבות</span>
              {sortedGrades.map((grade) => {
                const isSelected = selected.type === "grade" && selected.id === grade.id;
                const actConstraint = constraints.find(
                  (c) => c.rule_type === "GRADE_ACTIVITY_HOURS" && c.target_id === grade.id,
                );
                return (
                  <button
                    key={grade.id}
                    onClick={() => setSelected({ type: "grade", id: grade.id })}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm transition-colors ${
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <GraduationCap className="h-3.5 w-3.5" />
                      שכבה {grade.name}
                    </span>
                    {actConstraint && (
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 rounded">מוגדר</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Left: Content Panel ── */}
        <div className="flex-1 min-w-0">
          {selected.type === "school" && (
            <SchoolTimeSlotsPanel
              activeDays={activeDays}
              periods={periods}
              slots={slots}
              slotMap={slotMap}
              toggleSlot={toggleSlot}
              toggleDay={toggleDay}
              togglePeriod={togglePeriod}
            />
          )}
          {selected.type === "grade" && (
            <GradeActivityPanel
              schoolId={schoolId}
              gradeId={selected.id}
              grades={sortedGrades}
              constraints={constraints}
              activeDays={activeDays}
              maxPeriod={maxPeriod}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── School-level time slots grid ─────────────────────────
function SchoolTimeSlotsPanel({
  activeDays,
  periods,
  slots,
  slotMap,
  toggleSlot,
  toggleDay,
  togglePeriod,
}: {
  activeDays: string[];
  periods: number[];
  slots: { id: number; day: string; period: number; is_available: boolean }[];
  slotMap: Map<string, { id: number; day: string; period: number; is_available: boolean }>;
  toggleSlot: (day: string, period: number) => void;
  toggleDay: (day: string) => void;
  togglePeriod: (period: number) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">שעות פעילות — בית ספרי</h3>
      <p className="text-sm text-muted-foreground">
        לחץ על תא כדי להפעיל/לכבות משבצת. לחץ על כותרת יום או שעה כדי להפעיל/לכבות שורה/עמודה שלמה.
      </p>

      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-sm font-medium text-muted-foreground">שעה</th>
              {activeDays.map((day) => {
                const daySlots = slots.filter((s) => s.day === day);
                const allAvailable = daySlots.every((s) => s.is_available);
                return (
                  <th key={day} className="p-1">
                    <button
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`w-full rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        allAvailable
                          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {DAY_LABELS[day] ?? day}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const periodSlots = slots.filter((s) => s.period === period);
              const allAvailable = periodSlots.every((s) => s.is_available);
              return (
                <tr key={period}>
                  <td className="p-1">
                    <button
                      type="button"
                      onClick={() => togglePeriod(period)}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        allAvailable
                          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {period}
                    </button>
                  </td>
                  {activeDays.map((day) => {
                    const slot = slotMap.get(`${day}-${period}`);
                    if (!slot) {
                      return (
                        <td key={day} className="p-1">
                          <div className="h-10 w-16 rounded bg-gray-50" />
                        </td>
                      );
                    }
                    return (
                      <td key={day} className="p-1">
                        <button
                          type="button"
                          onClick={() => toggleSlot(day, period)}
                          className={`h-10 w-16 rounded border text-sm font-medium transition-colors ${
                            slot.is_available
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "border-gray-200 bg-gray-100 text-gray-400 hover:bg-gray-200"
                          }`}
                          title={
                            slot.is_available
                              ? `${DAY_LABELS[day]} שעה ${period} — פעיל`
                              : `${DAY_LABELS[day]} שעה ${period} — לא פעיל`
                          }
                        >
                          {slot.is_available ? "V" : "✕"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded border border-emerald-300 bg-emerald-50" />
          פעיל — ניתן לשבץ שיעורים
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded border border-gray-200 bg-gray-100" />
          לא פעיל — לא ישובצו שיעורים
        </span>
      </div>
    </div>
  );
}

// ─── Grade Activity Hours Panel ─────────────────────────
function GradeActivityPanel({
  schoolId,
  gradeId,
  grades,
  constraints,
  activeDays,
  maxPeriod,
}: {
  schoolId: number;
  gradeId: number;
  grades: Grade[];
  constraints: { id: number; rule_type: string; target_id: number | null; parameters: Record<string, unknown> }[];
  activeDays: string[];
  maxPeriod: number;
}) {
  const qc = useQueryClient();
  const grade = grades.find((g) => g.id === gradeId);

  const activityConstraint = constraints.find(
    (c) => c.rule_type === "GRADE_ACTIVITY_HOURS" && c.target_id === gradeId,
  );
  const shortDaysConstraint = constraints.find(
    (c) => c.rule_type === "SHORT_DAYS_FLEXIBLE" && c.target_id === gradeId,
  );

  const defaultMap = Object.fromEntries(activeDays.map((d) => [d, maxPeriod]));
  const savedMap = (activityConstraint?.parameters?.periods_per_day_map as Record<string, number>) ?? defaultMap;

  const [periodsMap, setPeriodsMap] = useState<Record<string, number>>(savedMap);
  const [numShortDays, setNumShortDays] = useState(
    (shortDaysConstraint?.parameters?.num_short_days as number) ?? 2,
  );
  const [maxPeriodShort, setMaxPeriodShort] = useState(
    (shortDaysConstraint?.parameters?.max_period_short as number) ?? 5,
  );

  // Reset state when grade changes
  useEffect(() => {
    const existing = constraints.find(
      (c) => c.rule_type === "GRADE_ACTIVITY_HOURS" && c.target_id === gradeId,
    );
    if (existing?.parameters?.periods_per_day_map) {
      setPeriodsMap(existing.parameters.periods_per_day_map as Record<string, number>);
    } else {
      setPeriodsMap(Object.fromEntries(activeDays.map((d) => [d, maxPeriod])));
    }
    const shortExisting = constraints.find(
      (c) => c.rule_type === "SHORT_DAYS_FLEXIBLE" && c.target_id === gradeId,
    );
    setNumShortDays((shortExisting?.parameters?.num_short_days as number) ?? 2);
    setMaxPeriodShort((shortExisting?.parameters?.max_period_short as number) ?? 5);
  }, [gradeId, constraints, activeDays, maxPeriod]);

  const saveActivityMut = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: schoolId,
        name: `שעות פעילות שכבה ${grade?.name ?? ""}`,
        category: "GLOBAL" as const,
        type: "HARD" as const,
        weight: 50,
        rule_type: "GRADE_ACTIVITY_HOURS" as const,
        parameters: { periods_per_day_map: periodsMap },
        target_type: "GRADE" as const,
        target_id: gradeId,
        is_active: true,
      };
      if (activityConstraint) {
        await updateConstraint(activityConstraint.id, {
          parameters: { periods_per_day_map: periodsMap },
        });
      } else {
        await createConstraint(payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("שעות פעילות שכבה נשמרו");
    },
    onError: () => toast.error("שגיאה בשמירה"),
  });

  const saveShortDaysMut = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: schoolId,
        name: `ימים קצרים שכבה ${grade?.name ?? ""}`,
        category: "GLOBAL" as const,
        type: "HARD" as const,
        weight: 50,
        rule_type: "SHORT_DAYS_FLEXIBLE" as const,
        parameters: { num_short_days: numShortDays, max_period_short: maxPeriodShort },
        target_type: "GRADE" as const,
        target_id: gradeId,
        is_active: true,
      };
      if (shortDaysConstraint) {
        await updateConstraint(shortDaysConstraint.id, {
          parameters: { num_short_days: numShortDays, max_period_short: maxPeriodShort },
        });
      } else {
        await createConstraint(payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("ימים קצרים נשמרו");
    },
    onError: () => toast.error("שגיאה בשמירה"),
  });

  // Build a visual grid showing blocked periods per day for this grade
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">שעות פעילות — שכבה {grade?.name}</h3>
      <p className="text-sm text-muted-foreground">
        הגדר כמה שעות פעילות לכל יום עבור שכבה זו. הסולבר יחסום שיבוץ מעבר לשעות אלו.
      </p>

      {/* Visual blocked-hours grid */}
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-sm font-medium text-muted-foreground">שעה</th>
              {activeDays.map((day) => (
                <th key={day} className="p-1">
                  <div className="rounded px-3 py-1.5 text-sm font-medium bg-gray-50 text-gray-700">
                    {DAY_LABELS[day] ?? day}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period}>
                <td className="p-1">
                  <div className="rounded px-3 py-1.5 text-sm font-medium text-muted-foreground">
                    {period}
                  </div>
                </td>
                {activeDays.map((day) => {
                  const maxForDay = periodsMap[day] ?? maxPeriod;
                  const isBlocked = period > maxForDay;
                  return (
                    <td key={day} className="p-1">
                      <div
                        className={`h-10 w-16 rounded border text-sm font-medium flex items-center justify-center ${
                          isBlocked
                            ? "border-red-200 bg-red-50 text-red-400"
                            : "border-emerald-300 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {isBlocked ? "✕" : "V"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Activity hours per day - number inputs */}
      <div className="space-y-3">
        <Label>שעות מקסימום ליום</Label>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {activeDays.map((day) => (
            <div key={day} className="space-y-1">
              <span className="text-xs text-muted-foreground">
                {DAY_LABELS[day]}
              </span>
              <Input
                type="number"
                min={0}
                max={maxPeriod}
                value={periodsMap[day] ?? maxPeriod}
                onChange={(e) =>
                  setPeriodsMap((prev) => ({
                    ...prev,
                    [day]: Number(e.target.value),
                  }))
                }
              />
            </div>
          ))}
        </div>
        <Button
          size="sm"
          onClick={() => saveActivityMut.mutate()}
          disabled={saveActivityMut.isPending}
        >
          {saveActivityMut.isPending ? "שומר..." : activityConstraint ? "עדכן" : "שמור"}
        </Button>
      </div>

      {/* Short days flexible */}
      <div className="space-y-3 border-t pt-4">
        <Label>ימים קצרים גמישים</Label>
        <p className="text-xs text-muted-foreground">
          הסולבר יבחר אילו ימים יהיו קצרים — לפחות N ימים ללא שיעורים אחרי שעה מסוימת.
        </p>
        <div className="flex gap-4">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">כמות ימים קצרים</span>
            <Input
              type="number"
              min={0}
              max={6}
              value={numShortDays}
              onChange={(e) => setNumShortDays(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">שעה מקסימלית ביום קצר</span>
            <Input
              type="number"
              min={1}
              max={maxPeriod}
              value={maxPeriodShort}
              onChange={(e) => setMaxPeriodShort(Number(e.target.value))}
            />
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => saveShortDaysMut.mutate()}
          disabled={saveShortDaysMut.isPending}
        >
          {saveShortDaysMut.isPending ? "שומר..." : shortDaysConstraint ? "עדכן" : "שמור"}
        </Button>
      </div>

      <div className="flex items-center gap-6 text-sm text-muted-foreground pt-2">
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded border border-emerald-300 bg-emerald-50" />
          פעיל — ניתן לשבץ שיעורים
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded border border-red-200 bg-red-50" />
          חסום — לא ישובצו שיעורים
        </span>
      </div>
    </div>
  );
}
