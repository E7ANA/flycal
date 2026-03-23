/**
 * Predefined subject color palette.
 * Each color has a key, background, text color, and Hebrew label.
 */
export interface SubjectColor {
  key: string;
  bg: string;
  text: string;
  border: string;
  label: string;
}

export const SUBJECT_COLORS: SubjectColor[] = [
  { key: "coral",   bg: "#FDE8E4", text: "#8B3A2F", border: "#F0B8AD", label: "אלמוג" },
  { key: "purple",  bg: "#EDE5F5", text: "#5B3A8C", border: "#C9B3E0", label: "סגול" },
  { key: "teal",    bg: "#E8F0ED", text: "#2D5E4F", border: "#B5D5C8", label: "טורקיז" },
  { key: "success", bg: "#E8F1E4", text: "#3D5A2E", border: "#BCD8B0", label: "ירוק" },
  { key: "warning", bg: "#FBF0E0", text: "#6B4423", border: "#E8D0A8", label: "צהוב" },
  { key: "error",   bg: "#FAE0E4", text: "#9B2C3B", border: "#E8A8B4", label: "אדום" },
  { key: "blue",    bg: "#DEEAF6", text: "#2C5F9B", border: "#A8C8E8", label: "כחול" },
];

/** Default color key for new subjects */
export const DEFAULT_SUBJECT_COLOR = "blue";

/**
 * Map legacy hex colors to the closest color key.
 * Covers the 20 hex colors from the old import palette + common defaults.
 */
const HEX_TO_KEY: Record<string, string> = {
  "#ef4444": "error",   "#e11d48": "error",   "#f43f5e": "error",
  "#dc2626": "error",   "#c4342d": "error",
  "#ec4899": "coral",   "#f97316": "coral",   "#fb923c": "coral",
  "#f472b6": "coral",
  "#8b5cf6": "purple",  "#6366f1": "purple",  "#7c3aed": "purple",
  "#a855f7": "purple",  "#d946ef": "purple",  "#818cf8": "purple",
  "#10b981": "success", "#84cc16": "success", "#14b8a6": "success",
  "#4ade80": "success",
  "#2dd4bf": "teal",    "#06b6d4": "teal",    "#22d3ee": "teal",
  "#0ea5e9": "teal",    "#5ba8d4": "teal",
  "#f59e0b": "warning",
  "#3b82f6": "blue",    "#1b365d": "blue",
};

/** Get a SubjectColor by key, with fallback to blue. Handles legacy hex values. */
export function getSubjectColor(key: string | null | undefined): SubjectColor {
  const fallback = SUBJECT_COLORS.find((c) => c.key === DEFAULT_SUBJECT_COLOR)!;
  if (!key) return fallback;
  // Direct key match
  const direct = SUBJECT_COLORS.find((c) => c.key === key);
  if (direct) return direct;
  // Legacy hex → key mapping
  const mapped = HEX_TO_KEY[key.toLowerCase()];
  if (mapped) return SUBJECT_COLORS.find((c) => c.key === mapped) ?? fallback;
  return fallback;
}
