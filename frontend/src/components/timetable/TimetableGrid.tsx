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

/** Absent teacher info for a meeting */
export interface MeetingAbsenceInfo {
  meeting_id: number;
  teacher_id: number;
  teacher_name: string;
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
  /** Teachers absent from meetings (approved absences) */
  meetingAbsences?: MeetingAbsenceInfo[];
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
  meetingAbsences = [],
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
    <div className="w-full">
      <table className="w-full border-collapse text-[clamp(0.65rem,1.1vw,0.875rem)] table-fixed">
        <thead>
          <tr>
            <th className="border p-1.5 bg-muted/50 w-[8%]">שעה</th>
            {days.map((day) => (
              <th key={day} className="border p-1.5 bg-muted/50">
                {DAY_LABELS[day] ?? day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period}>
              <td className="border p-1.5 text-center font-medium bg-muted/30">
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
                      "border p-1 align-top",
                      !hasContent && !hasPresence && "bg-muted/10",
                      hasPresence && presenceType === "פרטני" && "bg-blue-50",
                      hasPresence && (presenceType === "שהייה" || presenceType === "שהייה (ישיבה)") && "bg-amber-50",
                      hasPresence && presenceType === "חלון" && "bg-red-50",
                    )}
                  >
                    {(() => {
                      // Flatten all items (expand grouped tracks into individual items)
                      const flatItems: {
                        key: string;
                        name: string;
                        teacherName: string;
                        className: string;
                        color: string | null;
                        isTrack: boolean;
                      }[] = [];

                      for (const entry of entries) {
                        const subj = subjectMap[entry.subject_id];
                        const isGrouping = entry.isTrack && entry.trackCount > 1;

                        if (isGrouping) {
                          entry.trackNames.forEach((tName, ti) => {
                            const tTeacher = entry.trackTeacherIds[ti];
                            flatItems.push({
                              key: `g-${entry.subject_id}-${ti}`,
                              name: tName,
                              teacherName: tTeacher ? (teacherMap[tTeacher] ?? "") : "",
                              className: "",
                              color: subj?.color ?? null,
                              isTrack: true,
                            });
                          });
                        } else {
                          const isSingleTrack = entry.isTrack && entry.trackCount === 1;
                          const displayName =
                            isSingleTrack && entry.trackNames.length > 0
                              ? entry.trackNames[0]
                              : (subj?.name ?? `מקצוע ${entry.subject_id}`);
                          flatItems.push({
                            key: `r-${entry.subject_id}-${entry.teacher_id}`,
                            name: displayName,
                            teacherName: teacherMap[entry.teacher_id] ?? "",
                            className: showClass && entry.class_group_id && classMap
                              ? (classMap[entry.class_group_id] ?? "")
                              : "",
                            color: subj?.color ?? null,
                            isTrack: entry.isTrack,
                          });
                        }
                      }

                      const isMulti = flatItems.length > 1;

                      // Single item → full-width block
                      if (!isMulti && flatItems.length === 1) {
                        const item = flatItems[0];
                        return (
                          <div
                            className="rounded px-2 py-1 text-xs mb-0.5"
                            style={{
                              backgroundColor: item.color
                                ? `${item.color}${item.isTrack ? "30" : "20"}`
                                : item.isTrack ? "#dbeafe" : "#f3f4f6",
                              borderRight: `3px solid ${item.color ?? "#ccc"}`,
                              borderLeft: item.isTrack
                                ? `3px solid ${item.color ?? "#3b82f6"}`
                                : undefined,
                            }}
                          >
                            <div className="font-medium truncate">{item.name}</div>
                            {showTeacher && (
                              <div className="text-muted-foreground truncate">{item.teacherName}</div>
                            )}
                            {item.className && (
                              <div className="text-muted-foreground truncate">{item.className}</div>
                            )}
                          </div>
                        );
                      }

                      // Multiple items → always one row, side by side
                      return (
                        <div className="flex gap-0.5 mb-0.5">
                          {flatItems.map((item) => {
                            const shortName = item.name.length > 8
                              ? item.name.split(/\s/)[0] || item.name.slice(0, 6)
                              : item.name;
                            const shortTeacher = item.teacherName.length > 6
                              ? item.teacherName.split(/\s/)[0] || item.teacherName.slice(0, 5)
                              : item.teacherName;
                            return (
                              <div
                                key={item.key}
                                className="flex-1 rounded px-1 py-0.5 text-[10px] min-w-0"
                                title={`${item.name} — ${item.teacherName}`}
                                style={{
                                  backgroundColor: item.color
                                    ? `${item.color}30`
                                    : "#dbeafe",
                                  borderRight: `2px solid ${item.color ?? "#ccc"}`,
                                }}
                              >
                                <div className="font-medium truncate">{shortName}</div>
                                {showTeacher && (
                                  <div className="text-muted-foreground truncate">{shortTeacher}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {cellMeetings.map((m, i) => {
                      const info = meetingMap[m.meeting_id];
                      const absentTeachers = meetingAbsences.filter(
                        (a) => a.meeting_id === m.meeting_id,
                      );
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
                            {absentTeachers.length > 0 && (
                              <span
                                className="text-amber-600 mr-1 cursor-help"
                                title={`נעדרים: ${absentTeachers.map((a) => a.teacher_name).join(", ")}`}
                              >
                                *
                              </span>
                            )}
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
