import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { fetchAvailableSlots, type SlotStatus } from "@/api/subjects";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";

interface PinnedSlot {
  day: string;
  period: number;
}

type GridMode = "pin" | "block";

interface PinGridProps {
  reqId: number;
  maxPins: number;
  pinnedSlots: PinnedSlot[];
  onChange: (slots: PinnedSlot[]) => void;
  /** Blocked slots — timeslots where this item CANNOT be scheduled */
  blockedSlots?: PinnedSlot[];
  onBlockedChange?: (slots: PinnedSlot[]) => void;
  maxPeriod?: number;
  /** Custom fetch function for slot availability (defaults to requirement-based) */
  fetchSlots?: (id: number) => Promise<SlotStatus[]>;
  /** Custom query key prefix (defaults to "available-slots") */
  queryKeyPrefix?: string;
}

export function PinGrid({
  reqId,
  maxPins,
  pinnedSlots,
  onChange,
  blockedSlots = [],
  onBlockedChange,
  maxPeriod = 8,
  fetchSlots,
  queryKeyPrefix = "available-slots",
}: PinGridProps) {
  const [mode, setMode] = useState<GridMode>("pin");
  const fetcher = fetchSlots ?? fetchAvailableSlots;
  const { data: slotStatuses = [] } = useQuery({
    queryKey: [queryKeyPrefix, reqId],
    queryFn: () => fetcher(reqId),
    enabled: reqId > 0,
  });

  const statusMap = new Map<string, SlotStatus["status"]>();
  for (const s of slotStatuses) {
    statusMap.set(`${s.day}_${s.period}`, s.status);
  }

  const isPinned = (day: string, period: number) =>
    pinnedSlots.some((p) => p.day === day && p.period === period);

  const isBlocked = (day: string, period: number) =>
    blockedSlots.some((p) => p.day === day && p.period === period);

  const togglePin = (day: string, period: number) => {
    const status = statusMap.get(`${day}_${period}`);
    if (status && status !== "available") return;
    // Can't pin a blocked slot
    if (isBlocked(day, period)) return;

    if (isPinned(day, period)) {
      onChange(pinnedSlots.filter((p) => !(p.day === day && p.period === period)));
    } else if (pinnedSlots.length < maxPins) {
      onChange([...pinnedSlots, { day, period }]);
    }
  };

  const toggleBlock = (day: string, period: number) => {
    if (!onBlockedChange) return;
    // Can't block a pinned slot
    if (isPinned(day, period)) return;

    if (isBlocked(day, period)) {
      onBlockedChange(blockedSlots.filter((p) => !(p.day === day && p.period === period)));
    } else {
      onBlockedChange([...blockedSlots, { day, period }]);
    }
  };

  const handleClick = (day: string, period: number) => {
    if (mode === "pin") {
      togglePin(day, period);
    } else {
      toggleBlock(day, period);
    }
  };

  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);
  const hasBlockMode = !!onBlockedChange;

  return (
    <div className="space-y-2">
      {hasBlockMode && (
        <div className="flex gap-1 rounded-md border p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setMode("pin")}
            className={cn(
              "px-3 py-1 rounded text-xs font-medium transition-colors",
              mode === "pin"
                ? "bg-blue-500 text-white"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            נעילה
          </button>
          <button
            type="button"
            onClick={() => setMode("block")}
            className={cn(
              "px-3 py-1 rounded text-xs font-medium transition-colors",
              mode === "block"
                ? "bg-red-500 text-white"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            חסימה
          </button>
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {mode === "pin"
            ? `נעילות: ${pinnedSlots.length}/${maxPins}`
            : `חסימות: ${blockedSlots.length}`}
        </span>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-blue-500" />
            נעול
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-red-500" />
            חסום
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-green-200 border border-green-400" />
            זמין
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-red-200 border border-red-400" />
            לא זמין
          </span>
        </div>
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-2 py-1.5 text-start font-medium text-muted-foreground">
                שעה
              </th>
              {DAYS_ORDER.map((day) => (
                <th
                  key={day}
                  className="px-2 py-1.5 text-center font-medium text-muted-foreground"
                >
                  {DAY_LABELS[day]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period} className="border-t">
                <td className="px-2 py-1 text-muted-foreground">{period}</td>
                {DAYS_ORDER.map((day) => {
                  const status = statusMap.get(`${day}_${period}`) ?? "available";
                  const pinned = isPinned(day, period);
                  const blocked = isBlocked(day, period);
                  const externalBlock = status !== "available";
                  const atMax = pinnedSlots.length >= maxPins && !pinned;

                  // In pin mode: can't click externally blocked or user-blocked slots
                  // In block mode: can't click pinned or externally blocked slots
                  const disabled =
                    mode === "pin"
                      ? externalBlock || blocked || atMax
                      : pinned || externalBlock;

                  return (
                    <td key={day} className="px-1 py-0.5 text-center">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleClick(day, period)}
                        className={cn(
                          "h-6 w-full rounded transition-colors",
                          pinned && "bg-blue-500 text-white",
                          blocked && !pinned && "bg-red-500 text-white",
                          !pinned &&
                            !blocked &&
                            status === "available" &&
                            !disabled &&
                            "bg-green-100 border border-green-300 hover:bg-green-200 cursor-pointer",
                          !pinned &&
                            !blocked &&
                            status === "available" &&
                            disabled &&
                            "bg-gray-100 border border-gray-200 cursor-not-allowed",
                          !pinned &&
                            !blocked &&
                            externalBlock &&
                            "bg-red-100 border border-red-300 cursor-not-allowed",
                        )}
                        title={
                          pinned
                            ? "נעול — לחץ להסרה"
                            : blocked
                              ? "חסום — לחץ להסרה"
                              : externalBlock
                                ? status === "teacher_blocked"
                                  ? "המורה חסום"
                                  : status === "teacher_conflict"
                                    ? "התנגשות מורה"
                                    : "התנגשות כיתה"
                                : disabled
                                  ? "מקסימום נעילות"
                                  : mode === "pin"
                                    ? "לחץ לנעילה"
                                    : "לחץ לחסימה"
                        }
                      >
                        {blocked && !pinned && "✕"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
