import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchTimeSlots, generateTimeSlots, batchUpdateTimeSlots } from "@/api/timeslots";
import { Button } from "@/components/common/Button";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";

export default function TimeSlotsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

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
  const minPeriod = Math.min(...slots.map((s) => s.period));
  const maxPeriod = Math.max(...slots.map((s) => s.period));
  const periods = Array.from({ length: maxPeriod - minPeriod + 1 }, (_, i) => minPeriod + i);

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">שעות פעילות</h2>
          <p className="text-sm text-muted-foreground mt-1">
            הגדר שעות פעילות ברמת בית הספר
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

      <SchoolTimeSlotsPanel
        activeDays={activeDays}
        periods={periods}
        slots={slots}
        slotMap={slotMap}
        toggleSlot={toggleSlot}
        toggleDay={toggleDay}
        togglePeriod={togglePeriod}
      />
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

