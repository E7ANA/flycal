import type { RuleType, ConstraintCategory, Constraint } from "@/types/models";

export const CATEGORY_LABELS: Record<ConstraintCategory, string> = {
  TEACHER: "מורה",
  SUBJECT: "מקצוע",
  CLASS: "כיתה",
  GROUPING: "הקבצה",
  GLOBAL: "כללי",
};

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  BLOCK_TIMESLOT: "חסימת משבצת",
  BLOCK_DAY: "חסימת יום",
  BLOCK_TIME_RANGE: "חסימת טווח שעות",
  PREFER_TIME_RANGE: "העדפת טווח שעות",
  PREFER_TIMESLOT: "העדפת משבצת",
  AVOID_LAST_PERIOD: "הימנעות משעה אחרונה",
  MAX_PER_DAY: "מקסימום ליום",
  MIN_DAYS_SPREAD: "פיזור מינימלי בימים",
  NO_CONSECUTIVE_DAYS: "ללא ימים רצופים",
  REQUIRE_CONSECUTIVE_PERIODS: "שעות רצופות (שעה כפולה)",
  SAME_DAY_GROUPING: "קיבוץ באותו יום",
  NOT_SAME_DAY_AS: "לא באותו יום כמו",
  MAX_TEACHING_HOURS_PER_DAY: "מקסימום שעות הוראה ליום",
  MIN_TEACHING_HOURS_PER_DAY: "מינימום שעות הוראה ליום",
  MAX_TEACHING_DAYS: "מקסימום ימי הוראה",
  MIN_FREE_DAYS: "מינימום ימים חופשיים",
  BALANCED_DAILY_LOAD: "עומס יומי מאוזן",
  NO_GAPS: "ללא חלונות",
  MAX_GAPS_PER_DAY: "מקסימום חלונות ליום",
  MAX_GAPS_PER_WEEK: "מקסימום חלונות בשבוע",
  SYNC_TRACKS: "סנכרון רצועות",
  SYNC_TEACHER_CLASSES: "סנכרון מורה-כיתות",
  GROUPING_EXTRA_AT_END: "שעות נוספות בהקבצה בסוף יום",
  EARLY_FINISH: "סיום מוקדם",
  MINIMIZE_TEACHER_DAYS: "מינימום ימי מורה",
  CLASS_DAY_LENGTH_LIMIT: "הגבלת אורך יום לכיתה",
  TEACHER_FIRST_LAST_PREFERENCE: "העדפת שעה ראשונה/אחרונה",
  COMPACT_SCHOOL_DAY: "יום רציף מלא",
  HOMEROOM_EARLY: "מחנכת בתחילת היום",
  CLASS_END_TIME: "סוף יום לכיתה (שעת סיום)",
  TEACHER_DAY_END_LIMIT: "מגבלת סיום יום",
  TEACHER_PREFERRED_FREE_DAY: "בחירת יום חופשי",
};

export const DAY_LABELS: Record<string, string> = {
  SUNDAY: "ראשון",
  MONDAY: "שני",
  TUESDAY: "שלישי",
  WEDNESDAY: "רביעי",
  THURSDAY: "חמישי",
  FRIDAY: "שישי",
};

export const DAY_LABELS_SHORT: Record<string, string> = {
  SUNDAY: "א׳",
  MONDAY: "ב׳",
  TUESDAY: "ג׳",
  WEDNESDAY: "ד׳",
  THURSDAY: "ה׳",
  FRIDAY: "ו׳",
};

export const DAYS_ORDER = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;

/** Format constraint parameters as a human-readable Hebrew string. */
export function formatParams(c: Constraint): string {
  const p = c.parameters;
  const parts: string[] = [];
  if (p.day && p.day !== "ALL")
    parts.push(DAY_LABELS[p.day as string] ?? String(p.day));
  if (p.day === "ALL") parts.push("כל הימים");
  if (p.period) parts.push(`שעה ${p.period}`);
  if (p.from_period && p.to_period)
    parts.push(`שעות ${p.from_period}\u2013${p.to_period}`);
  if (p.max) parts.push(`מקס\u05F3 ${p.max}`);
  if (p.min) parts.push(`מינ\u05F3 ${p.min}`);
  if (p.max_days) parts.push(`${p.max_days} ימים`);
  if (p.min_days) parts.push(`${p.min_days} ימים`);
  if (p.max_periods) parts.push(`${p.max_periods} שעות`);
  if (p.consecutive_count) parts.push(`${p.consecutive_count} רצופות`);
  if (p.max_difference) parts.push(`הפרש ${p.max_difference}`);
  if (p.min_period && p.max_period) parts.push(`סיום שעות ${p.min_period}\u2013${p.max_period}`);
  if (p.days && Array.isArray(p.days) && (p.days as string[]).length > 0)
    parts.push((p.days as string[]).map((d: string) => DAY_LABELS[d] ?? d).join(", "));
  return parts.join(" | ") || "\u2014";
}
