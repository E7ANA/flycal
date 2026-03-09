import { cn } from "@/lib/utils";
import { DAY_LABELS } from "@/lib/constraints";
import type { ScheduledLesson, ScheduledMeeting } from "@/types/models";

interface MeetingInfo {
  id: number;
  name: string;
  color: string;
}

/** A display-ready cell entry: either a single lesson or a consolidated grouping. */
interface CellEntry {
  subject_id: number;
  teacher_id: number;
  /** When > 1, this is a consolidated grouping of N tracks */
  trackCount: number;
  /** All teacher IDs in the grouping (for display) */
  trackTeacherIds: number[];
  /** Track names for display in grouped cells */
  trackNames: string[];
  /** Original lesson (for non-grouped) */
  isTrack: boolean;
  class_group_id: number | null;
}

/** Presence annotation for an empty slot in a teacher's schedule */
export interface PresenceSlot {
  day: string;
  period: number;
  slot_type: string; // "שהייה" | "שהייה (ישיבה)" | "פרטני" | "חלון"
}

interface TimetableGridProps {
  lessons: ScheduledLesson[];
  days: string[];
  maxPeriod: number;
  subjectMap: Record<number, { name: string; color: string | null }>;
  teacherMap: Record<number, string>;
  classMap?: Record<number, string>;
  /** Track id → track name, for displaying all tracks in grouped cells */
  trackMap?: Record<number, string>;
  showTeacher?: boolean;
  showClass?: boolean;
  /** Scheduled meetings to display in the grid */
  meetings?: ScheduledMeeting[];
  /** Meeting info lookup: id → {name, color} */
  meetingMap?: Record<number, MeetingInfo>;
  /** Presence annotations for empty slots (teacher view only) */
  presenceSlots?: PresenceSlot[];
}

/**
 * Consolidate lessons in a cell: track lessons with the same subject_id
 * are merged into a single entry showing "הקבצה" with track count.
 */
function consolidateLessons(
  cellLessons: ScheduledLesson[],
  trackMap?: Record<number, string>,
): CellEntry[] {
  const regular: CellEntry[] = [];
  // Group track lessons by subject_id
  const tracksBySubject: Record<number, ScheduledLesson[]> = {};

  for (const l of cellLessons) {
    if (l.track_id != null) {
      (tracksBySubject[l.subject_id] ??= []).push(l);
    } else {
      regular.push({
        subject_id: l.subject_id,
        teacher_id: l.teacher_id,
        trackCount: 0,
        trackTeacherIds: [],
        trackNames: [],
        isTrack: false,
        class_group_id: l.class_group_id,
      });
    }
  }

  // Create one consolidated entry per grouped subject
  const grouped: CellEntry[] = [];
  for (const [sidStr, tracks] of Object.entries(tracksBySubject)) {
    const sid = Number(sidStr);
    const names = trackMap
      ? tracks
          .map((t) => (t.track_id != null ? trackMap[t.track_id] : undefined))
          .filter((n): n is string => !!n)
      : [];
    grouped.push({
      subject_id: sid,
      teacher_id: tracks[0].teacher_id,
      trackCount: tracks.length,
      trackTeacherIds: tracks.map((t) => t.teacher_id),
      trackNames: names,
      isTrack: true,
      // For single track, preserve class_group_id for display
      class_group_id: tracks.length === 1 ? tracks[0].class_group_id : null,
    });
  }

  return [...regular, ...grouped];
}

export function TimetableGrid({
  lessons,
  days,
  maxPeriod,
  subjectMap,
  teacherMap,
  classMap,
  trackMap,
  showTeacher = true,
  showClass = false,
  meetings = [],
  meetingMap = {},
  presenceSlots = [],
}: TimetableGridProps) {
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

  // Build lookup: day+period → lesson(s)
  const grid: Record<string, ScheduledLesson[]> = {};
  for (const l of lessons) {
    const key = `${l.day}-${l.period}`;
    (grid[key] ??= []).push(l);
  }

  // Build meeting lookup: day+period → meeting(s)
  const meetingGrid: Record<string, ScheduledMeeting[]> = {};
  for (const m of meetings) {
    const key = `${m.day}-${m.period}`;
    (meetingGrid[key] ??= []).push(m);
  }

  // Build presence lookup: day+period → slot_type
  const presenceGrid: Record<string, string> = {};
  for (const ps of presenceSlots) {
    presenceGrid[`${ps.day}-${ps.period}`] = ps.slot_type;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border p-2 bg-muted/50 w-16">שעה</th>
            {days.map((day) => (
              <th key={day} className="border p-2 bg-muted/50 min-w-[120px]">
                {DAY_LABELS[day] ?? day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period}>
              <td className="border p-2 text-center font-medium bg-muted/30">
                {period}
              </td>
              {days.map((day) => {
                const cellKey = `${day}-${period}`;
                const cellLessons = grid[cellKey] ?? [];
                const cellMeetings = meetingGrid[cellKey] ?? [];
                const presenceType = presenceGrid[cellKey];
                const entries = consolidateLessons(cellLessons, trackMap);
                const hasContent =
                  entries.length > 0 || cellMeetings.length > 0;
                const hasPresence = !hasContent && !!presenceType;
                return (
                  <td
                    key={day}
                    className={cn(
                      "border p-1 h-16 align-top",
                      !hasContent && !hasPresence && "bg-muted/10",
                      hasPresence && presenceType === "פרטני" && "bg-blue-50",
                      hasPresence && (presenceType === "שהייה" || presenceType === "שהייה (ישיבה)") && "bg-amber-50",
                      hasPresence && presenceType === "חלון" && "bg-red-50",
                    )}
                  >
                    {entries.map((entry, i) => {
                      const subj = subjectMap[entry.subject_id];
                      const isGrouping = entry.isTrack && entry.trackCount > 1;
                      const isSingleTrack = entry.isTrack && entry.trackCount === 1;
                      // For single track in teacher view: show the track name
                      const displayName =
                        isGrouping && entry.trackNames.length > 0
                          ? entry.trackNames.join(" / ")
                          : isSingleTrack && entry.trackNames.length > 0
                            ? entry.trackNames[0]
                            : (subj?.name ?? `מקצוע ${entry.subject_id}`);
                      return (
                        <div
                          key={`l-${i}`}
                          className="rounded px-2 py-1 text-xs mb-0.5"
                          style={{
                            backgroundColor: entry.isTrack
                              ? (subj?.color
                                  ? `${subj.color}30`
                                  : "#dbeafe")
                              : (subj?.color
                                  ? `${subj.color}20`
                                  : "#f3f4f6"),
                            borderRight: `3px solid ${subj?.color ?? "#ccc"}`,
                            borderLeft: entry.isTrack
                              ? `3px solid ${subj?.color ?? "#3b82f6"}`
                              : undefined,
                          }}
                        >
                          <div className="font-medium">
                            {isGrouping && (
                              <span className="text-[10px] text-muted-foreground">
                                הקבצה{" "}
                              </span>
                            )}
                            {displayName}
                          </div>
                          {showTeacher && !isGrouping && (
                            <div className="text-muted-foreground">
                              {teacherMap[entry.teacher_id] ?? ""}
                            </div>
                          )}
                          {showTeacher && isGrouping && (
                            <div className="text-muted-foreground truncate">
                              {entry.trackTeacherIds
                                .map((tid) => teacherMap[tid] ?? "")
                                .filter(Boolean)
                                .join(" / ")}
                            </div>
                          )}
                          {showClass &&
                            entry.class_group_id &&
                            classMap && (
                              <div className="text-muted-foreground">
                                {classMap[entry.class_group_id] ?? ""}
                              </div>
                            )}
                        </div>
                      );
                    })}
                    {cellMeetings.map((m, i) => {
                      const info = meetingMap[m.meeting_id];
                      return (
                        <div
                          key={`m-${i}`}
                          className="rounded px-2 py-1 text-xs mb-0.5"
                          style={{
                            backgroundColor: info?.color
                              ? `${info.color}30`
                              : "#ede9fe",
                            borderRight: `3px solid ${info?.color ?? "#8b5cf6"}`,
                          }}
                        >
                          <div className="font-medium">
                            {info?.name ?? `ישיבה ${m.meeting_id}`}
                          </div>
                        </div>
                      );
                    })}
                    {hasPresence && (
                      <div
                        className={cn(
                          "rounded px-2 py-1 text-xs flex items-center justify-center h-full",
                          presenceType === "פרטני" && "text-blue-600 font-medium",
                          (presenceType === "שהייה" || presenceType === "שהייה (ישיבה)") && "text-amber-600 font-medium",
                          presenceType === "חלון" && "text-red-500",
                        )}
                      >
                        {presenceType}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
