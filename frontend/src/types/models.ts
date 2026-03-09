// ─── School ───────────────────────────────────────────────
export interface School {
  id: number;
  name: string;
  days_per_week: number;
  periods_per_day: number;
  period_duration_minutes: number;
  break_slots: number[];
  week_start_day: string;
  periods_per_day_map: Record<string, number> | null;
}

// ─── Grade & ClassGroup ──────────────────────────────────
export interface Grade {
  id: number;
  name: string;
  level: number;
  school_id: number;
}

export interface ClassGroup {
  id: number;
  name: string;
  grade_id: number;
  school_id: number;
  num_students: number;
}

// ─── Teacher ─────────────────────────────────────────────
export interface BlockedSlot {
  day: string;
  period: number;
}

export interface Teacher {
  id: number;
  name: string;
  school_id: number;
  max_hours_per_week: number;
  min_hours_per_week: number | null;
  employment_percentage: number | null;
  subject_ids: number[];
  is_coordinator: boolean;
  homeroom_class_id: number | null;
  is_management: boolean;
  is_counselor: boolean;
  is_principal: boolean;
  is_pedagogical_coordinator: boolean;
  is_director: boolean;
  blocked_slots: BlockedSlot[];
}

// ─── Subject ─────────────────────────────────────────────
export interface Subject {
  id: number;
  name: string;
  school_id: number;
  color: string | null;
  double_priority: number | null;
  morning_priority: number | null;
  always_double: boolean;
  blocked_slots: BlockedSlot[] | null;
}

export interface PinnedSlot {
  day: string;
  period: number;
}

export interface SubjectRequirement {
  id: number;
  class_group_id: number;
  subject_id: number;
  teacher_id: number | null;
  hours_per_week: number;
  is_grouped: boolean;
  grouping_cluster_id: number | null;
  school_id: number;
  is_external: boolean;
  pinned_slots: PinnedSlot[] | null;
  blocked_slots: PinnedSlot[] | null;
  co_teacher_ids: number[] | null;
  always_double: boolean;
  consecutive_count: number | null;
  consecutive_mode: string | null; // "hard" | "soft" | null
  morning_priority: number | null;
  allow_overlap: boolean;
}

// ─── Grouping ────────────────────────────────────────────
export type ClusterType = "REGULAR" | "CROSS_GRADE" | "SHARED_LESSON";

export interface Track {
  id: number;
  name: string;
  cluster_id: number;
  teacher_id: number | null;
  hours_per_week: number;
  is_secondary: boolean;
  requirement_id: number | null;
  link_group: number | null;
  source_class_id: number | null;
  pinned_slots: PinnedSlot[] | null;
  blocked_slots: PinnedSlot[] | null;
  allow_overlap: boolean;
}

export interface GroupingCluster {
  id: number;
  name: string;
  subject_id: number;
  school_id: number;
  grade_id: number | null;
  source_class_ids: number[];
  tracks: Track[];
  cluster_type: ClusterType;
  consecutive_count: number | null;
  consecutive_mode: string | null;
}

// ─── TimeSlot ────────────────────────────────────────────
export interface TimeSlot {
  id: number;
  school_id: number;
  day: string;
  period: number;
  is_available: boolean;
}

// ─── Constraint ──────────────────────────────────────────
export type ConstraintCategory =
  | "TEACHER"
  | "SUBJECT"
  | "CLASS"
  | "GROUPING"
  | "GLOBAL";

export type ConstraintType = "HARD" | "SOFT";

export type TargetType = "TEACHER" | "SUBJECT" | "CLASS" | "GRADE" | "GROUPING" | "ALL";

export type RuleType =
  | "BLOCK_TIMESLOT"
  | "BLOCK_DAY"
  | "BLOCK_TIME_RANGE"
  | "PREFER_TIME_RANGE"
  | "PREFER_TIMESLOT"
  | "AVOID_LAST_PERIOD"
  | "MAX_PER_DAY"
  | "MIN_DAYS_SPREAD"
  | "NO_CONSECUTIVE_DAYS"
  | "REQUIRE_CONSECUTIVE_PERIODS"
  | "SAME_DAY_GROUPING"
  | "NOT_SAME_DAY_AS"
  | "MAX_TEACHING_HOURS_PER_DAY"
  | "MIN_TEACHING_HOURS_PER_DAY"
  | "MAX_TEACHING_DAYS"
  | "MIN_FREE_DAYS"
  | "BALANCED_DAILY_LOAD"
  | "NO_GAPS"
  | "MAX_GAPS_PER_DAY"
  | "MAX_GAPS_PER_WEEK"
  | "SYNC_TRACKS"
  | "SYNC_TEACHER_CLASSES"
  | "SECONDARY_TRACK_END_OF_DAY"
  | "GROUPING_EXTRA_AT_END"
  | "EARLY_FINISH"
  | "MINIMIZE_TEACHER_DAYS"
  | "CLASS_DAY_LENGTH_LIMIT"
  | "TEACHER_FIRST_LAST_PREFERENCE"
  | "GRADE_ACTIVITY_HOURS"
  | "SHORT_DAYS_FLEXIBLE"
  | "COMPACT_SCHOOL_DAY"
  | "HOMEROOM_EARLY"
  | "CLASS_END_TIME";

export interface Constraint {
  id: number;
  school_id: number;
  name: string;
  description: string | null;
  category: ConstraintCategory;
  type: ConstraintType;
  weight: number;
  rule_type: RuleType;
  parameters: Record<string, unknown>;
  target_type: TargetType;
  target_id: number | null;
  is_active: boolean;
  created_at: string;
  notes: string | null;
}

// ─── Meeting ─────────────────────────────────────────────
export type MeetingType = "HOMEROOM" | "COORDINATORS" | "MANAGEMENT" | "CUSTOM";

export interface Meeting {
  id: number;
  school_id: number;
  name: string;
  meeting_type: MeetingType;
  hours_per_week: number;
  is_mandatory_attendance: boolean;
  is_active: boolean;
  color: string;
  teacher_ids: number[];
  pinned_slots: PinnedSlot[] | null;
  blocked_slots: PinnedSlot[] | null;
  allow_overlap: boolean;
}

export interface ScheduledMeeting {
  id: number;
  solution_id: number;
  meeting_id: number;
  day: string;
  period: number;
}

// ─── Solution ────────────────────────────────────────────
export type SolutionStatus = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "TIMEOUT";

export interface ScheduledLesson {
  id: number;
  solution_id: number;
  class_group_id: number | null;
  track_id: number | null;
  subject_id: number;
  teacher_id: number;
  day: string;
  period: number;
  room_id: number | null;
}

export interface Solution {
  id: number;
  school_id: number;
  created_at: string;
  solve_time_seconds: number;
  total_score: number;
  status: SolutionStatus;
  scenario_name: string | null;
  is_baseline: boolean;
}

export interface SolutionDetail extends Solution {
  lessons: ScheduledLesson[];
  scheduled_meetings: ScheduledMeeting[];
  score_breakdown: ScoreBreakdown | null;
}

export interface SoftScore {
  constraint_id: number;
  name: string;
  weight: number;
  satisfaction: number;
  weighted_score: number;
}

export interface ScoreBreakdown {
  satisfied_hard: number;
  total_hard: number;
  soft_scores: SoftScore[];
  total_soft_penalty: number;
  max_possible_penalty: number;
  total_score: number;
}

// ─── Validation ──────────────────────────────────────────
export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  category: string;
  details: Record<string, unknown>;
  constraint_ids: number[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  summary: {
    classes: number;
    requirements: number;
    available_slots: number;
    clusters: number;
  };
}
