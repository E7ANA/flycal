import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { fetchAvailableSlots, type SlotStatus } from "@/api/subjects";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";

interface PinnedSlot {
  day: string;
  period: number;
}

type GridMode = "pin" | "block" | "alternative";

interface PinGridProps {
  reqId: number;
  maxPins: number;
  pinnedSlots: PinnedSlot[];
  onChange: (slots: PinnedSlot[]) => void;
  /** Blocked slots — timeslots where this item CANNOT be scheduled */
  blockedSlots?: PinnedSlot[];
  onBlockedChange?: (slots: PinnedSlot[]) => void;
  /** Alternative slots — solver picks primary OR alternative (PLENARY) */
  alternativeSlots?: PinnedSlot[];
  onAlternativeChange?: (slots: PinnedSlot[]) => void;
  maxAlternative?: number;
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
  alternativeSlots = [],
  onAlternativeChange,
  maxAlternative,
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

  const isAlternative = (day: string, period: number) =>
    alternativeSlots.some((p) => p.day === day && p.period === period);

  const togglePin = (day: string, period: number) => {
    const status = statusMap.get(`${day}_${period}`);
    if (status && status !== "available") return;
    if (isBlocked(day, period) || isAlternative(day, period)) return;

    if (isPinned(day, period)) {
      onChange(pinnedSlots.filter((p) => !(p.day === day && p.period === period)));
    } else if (pinnedSlots.length < maxPins) {
      onChange([...pinnedSlots, { day, period }]);
    }
  };

  const toggleBlock = (day: string, period: number) => {
    if (!onBlockedChange) return;
    if (isPinned(day, period) || isAlternative(day, period)) return;

    if (isBlocked(day, period)) {
      onBlockedChange(blockedSlots.filter((p) => !(p.day === day && p.period === period)));
    } else {
      onBlockedChange([...blockedSlots, { day, period }]);
    }
  };

  const toggleAlternative = (day: string, period: number) => {
    if (!onAlternativeChange) return;
    if (isPinned(day, period) || isBlocked(day, period)) return;
    const status = statusMap.get(`${day}_${period}`);
    if (status && status !== "available") return;

    if (isAlternative(day, period)) {
      onAlternativeChange(alternativeSlots.filter((p) => !(p.day === day && p.period === period)));
    } else {
      const maxAlt = maxAlternative ?? maxPins;
      if (alternativeSlots.length < maxAlt) {
        onAlternativeChange([...alternativeSlots, { day, period }]);
      }
    }
  };

  const handleClick = (day: string, period: number) => {
    if (mode === "pin") {
      togglePin(day, period);
    } else if (mode === "block") {
      toggleBlock(day, period);
    } else {
      toggleAlternative(day, period);
    }
  };

  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);
  const hasBlockMode = !!onBlockedChange;
  const hasAlternativeMode = !!onAlternativeChange;

  return (
    <div className="space-y-2">
      {(hasBlockMode || hasAlternativeMode) && (
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
          {hasAlternativeMode && (
            <button
              type="button"
              onClick={() => setMode("alternative")}
              className={cn(
                "px-3 py-1 rounded text-xs font-medium transition-colors",
                mode === "alternative"
                  ? "bg-amber-400 text-white"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              חלופי
            </button>
          )}
          {hasBlockMode && (
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
          )}
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {mode === "pin"
            ? `נעילות: ${pinnedSlots.length}/${maxPins}`
            : mode === "alternative"
              ? `חלופי: ${alternativeSlots.length}/${maxAlternative ?? maxPins}`
              : `חסימות: ${blockedSlots.length}`}
        </span>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-blue-500" />
            נעול
          </span>
          {hasAlternativeMode && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-amber-400" />
              חלופי
            </span>
          )}
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
                  const alt = isAlternative(day, period);
                  const externalBlock = status !== "available";
                  const atMax = pinnedSlots.length >= maxPins && !pinned;
                  const atMaxAlt = alternativeSlots.length >= (maxAlternative ?? maxPins) && !alt;

                  const disabled =
                    mode === "pin"
                      ? externalBlock || blocked || alt || atMax
                      : mode === "alternative"
                        ? externalBlock || pinned || blocked || atMaxAlt
                        : pinned || alt || externalBlock;

                  return (
                    <td key={day} className="px-1 py-0.5 text-center">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleClick(day, period)}
                        className={cn(
                          "h-6 w-full rounded transition-colors",
                          pinned && "bg-blue-500 text-white",
                          alt && !pinned && "bg-amber-400 text-white",
                          blocked && !pinned && !alt && "bg-red-500 text-white",
                          !pinned &&
                            !blocked &&
                            !alt &&
                            status === "available" &&
                            !disabled &&
                            "bg-green-100 border border-green-300 hover:bg-green-200 cursor-pointer",
                          !pinned &&
                            !blocked &&
                            !alt &&
                            status === "available" &&
                            disabled &&
                            "bg-gray-100 border border-gray-200 cursor-not-allowed",
                          !pinned &&
                            !blocked &&
                            !alt &&
                            externalBlock &&
                            "bg-red-100 border border-red-300 cursor-not-allowed",
                        )}
                        title={
                          pinned
                            ? "נעול — לחץ להסרה"
                            : alt
                              ? "חלופי — לחץ להסרה"
                              : blocked
                                ? "חסום — לחץ להסרה"
                                : externalBlock
                                  ? status === "teacher_blocked"
                                    ? "המורה חסום"
                                    : status === "teacher_conflict"
                                      ? "התנגשות מורה"
                                      : "התנגשות כיתה"
                                  : disabled
                                    ? mode === "pin"
                                      ? "מקסימום נעילות"
                                      : mode === "alternative"
                                        ? "מקסימום חלופי"
                                        : ""
                                    : mode === "pin"
                                      ? "לחץ לנעילה"
                                      : mode === "alternative"
                                        ? "לחץ לסימון חלופי"
                                        : "לחץ לחסימה"
                        }
                      >
                        {blocked && !pinned && !alt && "✕"}
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
