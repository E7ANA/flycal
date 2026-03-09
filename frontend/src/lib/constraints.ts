import type { RuleType, ConstraintCategory } from "@/types/models";

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
  SECONDARY_TRACK_END_OF_DAY: "מגמה שניה בסוף יום (רצוף)",
  GROUPING_EXTRA_AT_END: "שעות נוספות בהקבצה בסוף יום",
  EARLY_FINISH: "סיום מוקדם",
  MINIMIZE_TEACHER_DAYS: "מינימום ימי מורה",
  CLASS_DAY_LENGTH_LIMIT: "הגבלת אורך יום לכיתה",
  TEACHER_FIRST_LAST_PREFERENCE: "העדפת שעה ראשונה/אחרונה",
  GRADE_ACTIVITY_HOURS: "שעות פעילות שכבה",
  SHORT_DAYS_FLEXIBLE: "ימים קצרים גמישים",
  COMPACT_SCHOOL_DAY: "יום רציף מלא",
  HOMEROOM_EARLY: "מחנכת בתחילת היום",
  CLASS_END_TIME: "סוף יום לכיתה (שעת סיום)",
};

export const DAY_LABELS: Record<string, string> = {
  SUNDAY: "ראשון",
  MONDAY: "שני",
  TUESDAY: "שלישי",
  WEDNESDAY: "רביעי",
  THURSDAY: "חמישי",
  FRIDAY: "שישי",
};

export const DAYS_ORDER = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;
