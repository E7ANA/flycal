import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { useActiveSchool } from "@/hooks/useSchool";
import { fetchTimeSlots, generateTimeSlots, batchUpdateTimeSlots } from "@/api/timeslots";
import { fetchGrades } from "@/api/grades";
import { fetchConstraints, createConstraint, updateConstraint } from "@/api/constraints";
import { Button } from "@/components/common/Button";
import { Label } from "@/components/common/Label";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";
import type { Constraint, Grade } from "@/types/models";

export default function TimeSlotsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const { data: school } = useActiveSchool();

  const { data: slots = [] } = useQuery({
    queryKey: ["timeslots", schoolId],
    queryFn: () => fetchTimeSlots(schoolId!),
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">שעות פעילות</h2>
          <p className="text-sm text-muted-foreground mt-1">
            לחץ על תא כדי להפעיל/לכבות משבצת. לחץ על כותרת יום או שעה כדי להפעיל/לכבות שורה/עמודה שלמה.
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

      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-sm font-medium text-muted-foreground">
                שעה
              </th>
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

      <GradeActivitySection schoolId={schoolId} activeDays={activeDays} maxPeriod={maxPeriod} />
    </div>
  );
}

// ─── Grade Activity Hours Section ─────────────────────────
function GradeActivitySection({
  schoolId,
  activeDays,
  maxPeriod,
}: {
  schoolId: number;
  activeDays: string[];
  maxPeriod: number;
}) {
  const qc = useQueryClient();
  const [selectedGrade, setSelectedGrade] = useState<number | "">("");

  const { data: grades = [] } = useQuery({
    queryKey: ["grades", schoolId],
    queryFn: () => fetchGrades(schoolId),
  });

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId),
  });

  // Find existing GRADE_ACTIVITY_HOURS constraint for selected grade
  const activityConstraint = selectedGrade
    ? constraints.find(
        (c) =>
          c.rule_type === "GRADE_ACTIVITY_HOURS" &&
          c.target_id === selectedGrade,
      )
    : null;

  // Find SHORT_DAYS_FLEXIBLE constraint for selected grade
  const shortDaysConstraint = selectedGrade
    ? constraints.find(
        (c) =>
          c.rule_type === "SHORT_DAYS_FLEXIBLE" &&
          c.target_id === selectedGrade,
      )
    : null;

  const currentMap: Record<string, number> =
    (activityConstraint?.parameters?.periods_per_day_map as Record<string, number>) ??
    Object.fromEntries(activeDays.map((d) => [d, maxPeriod]));

  const [periodsMap, setPeriodsMap] = useState<Record<string, number>>(currentMap);
  const [numShortDays, setNumShortDays] = useState(
    (shortDaysConstraint?.parameters?.num_short_days as number) ?? 2,
  );
  const [maxPeriodShort, setMaxPeriodShort] = useState(
    (shortDaysConstraint?.parameters?.max_period_short as number) ?? 5,
  );

  // Reset state when grade changes
  const handleGradeChange = (gradeId: number | "") => {
    setSelectedGrade(gradeId);
    if (gradeId) {
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
    }
  };

  const saveActivityMut = useMutation({
    mutationFn: async () => {
      if (!selectedGrade) return;
      const payload = {
        school_id: schoolId,
        name: `שעות פעילות שכבה ${grades.find((g) => g.id === selectedGrade)?.name ?? ""}`,
        category: "GLOBAL" as const,
        type: "HARD" as const,
        weight: 50,
        rule_type: "GRADE_ACTIVITY_HOURS" as const,
        parameters: { periods_per_day_map: periodsMap },
        target_type: "GRADE" as const,
        target_id: selectedGrade,
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
      if (!selectedGrade) return;
      const payload = {
        school_id: schoolId,
        name: `ימים קצרים שכבה ${grades.find((g) => g.id === selectedGrade)?.name ?? ""}`,
        category: "GLOBAL" as const,
        type: "HARD" as const,
        weight: 50,
        rule_type: "SHORT_DAYS_FLEXIBLE" as const,
        parameters: { num_short_days: numShortDays, max_period_short: maxPeriodShort },
        target_type: "GRADE" as const,
        target_id: selectedGrade,
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

  const sortedGrades = [...grades].sort((a, b) => a.level - b.level);

  return (
    <section className="space-y-4 border-t pt-6">
      <h3 className="text-lg font-semibold">שעות פעילות לפי שכבה</h3>
      <p className="text-sm text-muted-foreground">
        הגדר כמה שעות פעילות לכל יום עבור כל שכבה. הסולבר יחסום שיבוץ מעבר לשעות אלו.
      </p>

      <Select
        value={selectedGrade}
        onChange={(e) => handleGradeChange(e.target.value ? Number(e.target.value) : "")}
      >
        <option value="">בחר שכבה</option>
        {sortedGrades.map((g) => (
          <option key={g.id} value={g.id}>
            שכבה {g.name}
          </option>
        ))}
      </Select>

      {selectedGrade && (
        <div className="space-y-6">
          {/* Activity hours per day */}
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
        </div>
      )}
    </section>
  );
}
