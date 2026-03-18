import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  GripVertical,
  Zap,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Shield,
  Feather,
  ChevronDown,
  ChevronLeft,
  AlertCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchMeetings } from "@/api/meetings";
import { fetchGroupingClusters } from "@/api/groupings";
import {
  fetchConstraints,
  createConstraint,
  updateConstraint,
  deleteConstraint,
  toggleConstraint,
  updateConstraintWeight,
} from "@/api/constraints";
import { fetchSubjects } from "@/api/subjects";
import { fetchTeachers } from "@/api/teachers";
import { fetchClasses } from "@/api/classes";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Label } from "@/components/common/Label";
import {
  RULE_TYPE_LABELS,
  DAY_LABELS,
  DAYS_ORDER,
} from "@/lib/constraints";
import type {
  Constraint,
  ConstraintCategory,
  ConstraintType as CType,
  RuleType,
  Meeting,
} from "@/types/models";

// ── Brain principle definitions ──────────────────────────────────────────

interface BrainPrinciple {
  id: string;
  name: string;
  description: string;
  category: "system" | "global" | "meetings" | "homeroom";
  details: string[];
  isHard?: boolean;
}

function buildMeetingPrinciples(meetings: Meeting[]): BrainPrinciple[] {
  return meetings
    .filter((m) => !m.is_mandatory_attendance)
    .map((m) => ({
      id: `meeting-${m.id}`,
      name: `נוכחות גמישה — ${m.name}`,
      description:
        "לא כל המורים חייבים להיות נוכחים. המערכת מעדיפה שיהיו פנויים, אבל לא מכריחה.",
      category: "meetings" as const,
      details: [`${m.hours_per_week} שעות שבועיות`, `משקל: 50`],
    }));
}

const GLOBAL_PRINCIPLES: BrainPrinciple[] = [
  // ── System constraints (physical/logical reality) ──
  {
    id: "teacher-no-overlap",
    name: "מורה לא יכול להיות בשני מקומות בו-זמנית",
    description:
      "לכל מורה יכול להיות לכל היותר שיעור אחד בכל משבצת זמן.",
    category: "system",
    details: ["אילוץ קשה (HARD)", "כולל מורים משניים (co-teacher)"],
    isHard: true,
  },
  {
    id: "class-no-overlap",
    name: "כיתה לא יכולה ללמוד שני מקצועות בו-זמנית",
    description:
      "לכל כיתה יכול להיות לכל היותר שיעור אחד בכל משבצת זמן.",
    category: "system",
    details: ["אילוץ קשה (HARD)"],
    isHard: true,
  },
  {
    id: "hours-fulfillment",
    name: "כל דרישה מקבלת בדיוק את השעות שלה",
    description:
      "אם לכיתה מוגדרות 5 שעות מתמטיקה, היא מקבלת בדיוק 5 — לא 4, לא 6.",
    category: "system",
    details: ["אילוץ קשה (HARD)", "חל על כל דרישה, טראק וישיבה"],
    isHard: true,
  },
  {
    id: "teacher-qualification",
    name: "מורה מלמד רק מקצועות שהוקצו לו",
    description:
      "נאכף אוטומטית — המערכת יוצרת משתנים רק לצמדי מורה-מקצוע מוגדרים.",
    category: "system",
    details: ["אילוץ קשה (HARD)", "מובנה ביצירת המשתנים"],
    isHard: true,
  },
  {
    id: "grouping-sync",
    name: "סנכרון הקבצות",
    description:
      "כל הטראקים בהקבצה חייבים להיות מתוזמנים באותן משבצות זמן (או כתת-קבוצה אם השעות שונות).",
    category: "system",
    details: ["אילוץ קשה (HARD)", "תומך בטראקים מקושרים (link_group)"],
    isHard: true,
  },
  {
    id: "linked-tracks-no-overlap",
    name: "טראקים מקושרים לא חופפים",
    description:
      "טראקים באותו link_group (אותן תלמידות, מקצועות שונים) חייבים להיות בשעות שונות.",
    category: "system",
    details: ["אילוץ קשה (HARD)"],
    isHard: true,
  },
  {
    id: "teacher-blocked-slots",
    name: "חסימות מורים",
    description:
      "אין שיעורים, טראקים או ישיבות בשעות שהמורה סימן כחסומות.",
    category: "system",
    details: ["אילוץ קשה (HARD)", "מוגדר בכרטיס המורה"],
    isHard: true,
  },
  {
    id: "pinned-lessons",
    name: "שיעורים נעוצים",
    description:
      "שיעורים, טראקים וישיבות שהוצמדו למשבצת ספציפית חייבים להופיע שם.",
    category: "system",
    details: ["אילוץ קשה (HARD)", "מוגדר בגליון / בהקבצות / בישיבות"],
    isHard: true,
  },
  {
    id: "meetings-on-teaching-days",
    name: "ישיבות רק בימי הוראה",
    description:
      "ישיבת מורים מתוזמנת רק ביום שבו כל המורים המשתתפים מלמדים.",
    category: "system",
    details: ["אילוץ קשה (HARD)", "חל על כל הישיבות עם נוכחות חובה"],
    isHard: true,
  },
  // ── Solver intelligence (soft auto-rules) ──
  {
    id: "same-day-consecutive",
    name: "שעות באותו יום חייבות להיות רצופות",
    description:
      "אם למקצוע יש 2 שעות או יותר באותו יום לאותה כיתה, הן חייבות להיות רצופות — ללא הפסקות ביניהן.",
    category: "global",
    details: ["אילוץ קשה (HARD)", "חל על כל המקצועות אוטומטית"],
    isHard: true,
  },
  {
    id: "always-double",
    name: "תמיד שעה כפולה",
    description:
      "דרישות שסומנו כ\"תמיד שעה כפולה\" בגליון חייבות להופיע בזוגות רצופים. לדוגמה: 4 שעות = 2 זוגות של 2.",
    category: "global",
    details: ["אילוץ קשה (HARD)", "מוגדר בגליון לכל דרישה"],
    isHard: true,
  },
  {
    id: "double-periods",
    name: "שיעורים כפולים",
    description:
      "מקצוע עם 3+ שעות שבועיות מקבל העדפה לשיעורים כפולים (רצופים). ככל שיותר שעות, יותר כפולים נדרשים. המשקל עולה אוטומטית לפי מספר השעות.",
    category: "global",
    details: [
      "אילוץ רך (SOFT)",
      "חל על כל המקצועות עם 3+ שעות",
      "3ש\u21901 כפול, 5ש\u21902 כפולים, 7ש\u21903 כפולים",
      "ניתן לשנות עדיפות ידנית בדף המקצועות",
    ],
  },
  {
    id: "morning-priority",
    name: "חשיבות תחילת יום",
    description:
      "מקצועות עם ניקוד חשיבות בוקר יועדפו בשעות המוקדמות. ניקוד 100 = הכי חשוב, 50 = בינוני. הסולבר יוצר סולם יחסי לשכבה: אם מקצוע אחד ב-100 ואחר ב-50, הראשון יהיה מוקדם יותר.",
    category: "global",
    details: [
      "אילוץ רך (SOFT)",
      "מוגדר בדף מקצועות (ברירת מחדל) ובגליון (דריסה לכל דרישה)",
      "משקל: 1-40 (לפי ניקוד החשיבות)",
    ],
  },
  {
    id: "secondary-track-end-of-day",
    name: "מגמה שניה בסוף היום",
    description:
      "טראקים משניים (מגמה שניה) מועדפים בשעות האחרונות של היום. שעה מוקדמת יותר = עונש גבוה יותר.",
    category: "global",
    details: ["אילוץ רך (SOFT)", "חל אוטומטית על כל טראק משני"],
  },
  {
    id: "subject-blocked-slots",
    name: "חסימת שעות למקצוע",
    description:
      "מקצועות יכולים להיות חסומים בשעות מסוימות. לדוגמה: ספורט לא ביום ראשון, מוזיקה רק בשעות 1-4. מוגדר בדף מקצועות.",
    category: "system",
    details: ["אילוץ קשה (HARD)", "מוגדר בדף מקצועות לכל מקצוע"],
    isHard: true,
  },
  {
    id: "class-end-time",
    name: "סופי ימים (שעות סיום לכיתות)",
    description:
      "קובע שכיתות חייבות לסיים בשעות מסוימות בימים מסוימים. לדוגמה: שני ורביעי חייבים להסתיים בשעות 7-8 (בגלל הסעות).",
    category: "system",
    details: ["אילוץ קשה (HARD)", "מוגדר כאילוץ כיתות בדף המוח"],
    isHard: true,
  },
  {
    id: "teacher-gap-minimization",
    name: "צמצום חלונות מורים",
    description:
      "המערכת מנסה למזער חלונות (שעות פנויות בין שיעורים) עבור כל מורה. כולל שיעורים, טראקים וישיבות.",
    category: "global",
    details: [
      "אילוץ רך (SOFT)",
      "משקל: 60",
      "חל על כל המורים אוטומטית",
      "חלון = שעה ריקה בין שיעור ראשון לאחרון",
    ],
  },
  {
    id: "oz-la-tmura-gaps",
    name: "כללי עוז לתמורה — מגבלת חלונות",
    description:
      "מגביל את מספר החלונות השבועיים המותרים לכל מורה לפי שעות הוראה פרונטליות. החישוב: חלונות מותרים = F÷8 + שעות פרטני (12% מ-F).",
    category: "global",
    details: [
      "אילוץ קשה (HARD)",
      "F = שעות פרונטליות, פרטני = 12%×F, שהייה = 40%×F",
      "ישיבות נחשבות כשעות שהייה",
      "חלונות מותרים = F÷8 + פרטני",
    ],
    isHard: true,
  },
  {
    id: "max-days-by-frontal",
    name: "ימי עבודה מקסימליים לפי עוז לתמורה",
    description:
      "מגביל את מספר ימי ההוראה של כל מורה לפי רובריקה (סה\"כ שעות משרה). ניתן לשנות ידנית בכרטיס מורה — ערך ידני גובר על הכלל.",
    category: "global",
    details: [
      "אילוץ קשה (HARD)",
      "ערך ידני (אם הוגדר) → גובר על הכל",
      "רובריקה פחות מ-20 שעות → 2 ימים",
      "רובריקה 20-27 שעות → 3 ימים",
      "רובריקה מעל 27 שעות → 4 ימים",
      "16+ שעות פרונטליות → לפחות 4 ימים (גובר על רובריקה)",
      "אין רובריקה + פחות מ-12 שעות פרונטליות → 2 ימים",
      "סופר רק ימי הוראה (ללא ישיבות)",
      "יום חופשי תמיד גובר (MIN_FREE_DAYS)",
    ],
    isHard: true,
  },
  {
    id: "max-consecutive-frontal",
    name: "מקסימום 6 שעות פרונטליות רצופות ליום",
    description:
      "מורה לא יכול ללמד יותר מ-6 שעות פרונטליות רצופות באותו יום. ישיבות, פרטני וחלונות שוברים את הרצף ואינם נספרים.",
    category: "global",
    details: [
      "אילוץ קשה (HARD)",
      "חל על כל המורים אוטומטית",
      "רק שיעורים וטראקים נספרים — ישיבות וחלונות מפסיקים את הרצף",
    ],
    isHard: true,
  },
  {
    id: "high-school-daily-core",
    name: "כיתות י-יב: מקצוע ליבה/מגמה בכל יום",
    description:
      "כיתות בשכבות י, יא, יב חייבות בכל יום לימודים לפחות שיעור אחד של אנגלית, מתמטיקה או מגמות (הקבצות).",
    category: "global",
    details: [
      "אילוץ קשה (HARD)",
      "חל על שכבות 10, 11, 12",
      "מקצועות: אנגלית, מתמטיקה, או כל הקבצה של הכיתה",
    ],
    isHard: true,
  },
  {
    id: "subject-limit-last-periods",
    name: "הגבלת מקצוע בשעות אחרונות",
    description:
      "מקצוע שמוגדר עם הגבלת שעות אחרונות — לא יותר מפעם אחת בשעתיים האחרונות של כל יום, לכל כיתה. ההגדרה היא בכרטיס המקצוע.",
    category: "subject",
    details: [
      "אילוץ קשה (HARD)",
      "מוגדר ברמת מקצוע (checkbox בעריכת מקצוע)",
      "מקסימום שיעור אחד בשעתיים האחרונות של כל יום",
      "נבדק לכל כיתה בנפרד",
      "כולל שיעורים רגילים והקבצות",
    ],
    isHard: true,
  },
  {
    id: "teacher-late-finish-limit",
    name: "הגבלת סיום מאוחר למורים",
    description:
      "מחנכת יכולה לסיים בשעה שמינית עד 2 ימים בשבוע. מורה מקצועי יכול לסיים בשעה שמינית עד 3 ימים בשבוע — בשאר ימי ההוראה חייב לסיים עד שעה שישית.",
    category: "global",
    details: [
      "אילוץ קשה (HARD)",
      "מחנכת: מקסימום 2 ימים עם שיעור בשעה 8+",
      "מורה מקצועי: מקסימום 3 ימים עם שיעור בשעה 8+",
      "מורה מקצועי: בשאר הימים — עד שעה 6 בלבד",
    ],
    isHard: true,
  },
];

const HOMEROOM_PRINCIPLE: BrainPrinciple = {
  id: "homeroom-early",
  name: "מחנכת פותחת בוקר ביום ראשון",
  description:
    "מחנכת חייבת ללמד את הכיתה שלה ביום ראשון, ולפתוח בוקר (שעה 1) ביום ראשון. בנוסף, שעות מוקדמות מקבלות בונוס גבוה — במיוחד ביום ראשון.",
  category: "homeroom",
  details: [
    "חובה: שיעור ביום ראשון (HARD)",
    "חובה: פתיחת בוקר (שעה 1) ביום ראשון (HARD)",
    "בונוס: שעה 1 ביום ראשון ×8, שעה 2 ×4",
    "בונוס: שעה 1 בימים אחרים ×3, שעה 2 ×1",
    "עונש: שעה 3+ — עונש גדל לפי איחור",
  ],
  isHard: true,
};

const BRAIN_CATEGORY_LABELS: Record<string, string> = {
  system: "אילוצי מערכת (פיזיים/לוגיים)",
  global: "כללים אוטומטיים",
  meetings: "ישיבות",
  homeroom: "מחנכת",
};

const BRAIN_CATEGORY_COLORS: Record<string, string> = {
  system: "bg-slate-100 text-slate-800",
  global: "bg-red-100 text-red-800",
  meetings: "bg-purple-100 text-purple-800",
  homeroom: "bg-amber-100 text-amber-800",
};

// ── Constraint rules per category ────────────────────────────────────────

const SUBJECT_RULES: { value: RuleType; label: string }[] = [
  { value: "MAX_PER_DAY", label: "מקסימום שעות ליום למקצוע" },
  { value: "MIN_DAYS_SPREAD", label: "פיזור מינימלי בימים" },
  { value: "NO_CONSECUTIVE_DAYS", label: "ללא ימים רצופים" },
  { value: "REQUIRE_CONSECUTIVE_PERIODS", label: "שעות רצופות (שעה כפולה)" },
  { value: "PREFER_TIME_RANGE", label: "העדפת טווח שעות" },
  { value: "AVOID_LAST_PERIOD", label: "הימנעות משעה אחרונה" },
];

const TEACHER_RULES: { value: RuleType; label: string }[] = [
  { value: "MAX_TEACHING_HOURS_PER_DAY", label: "מקסימום שעות הוראה ליום" },
  { value: "MAX_TEACHING_DAYS", label: "מקסימום ימי הוראה" },
  { value: "BALANCED_DAILY_LOAD", label: "עומס יומי מאוזן" },
  { value: "NO_GAPS", label: "ללא חלונות" },
  { value: "MAX_GAPS_PER_DAY", label: "מקסימום חלונות ליום" },
  { value: "AVOID_LAST_PERIOD", label: "הימנעות משעה אחרונה" },
];

const CLASS_RULES: { value: RuleType; label: string }[] = [
  { value: "NO_GAPS", label: "ללא חלונות" },
  { value: "MAX_GAPS_PER_DAY", label: "מקסימום חלונות ליום" },
  { value: "CLASS_DAY_LENGTH_LIMIT", label: "אורך יום מקסימלי" },
  { value: "COMPACT_SCHOOL_DAY", label: "יום רציף מלא (מתחיל בשעה 1, מינימום שעות)" },
  { value: "CLASS_END_TIME", label: "סוף יום לכיתה (שעת סיום)" },
];

const GROUPING_RULES: { value: RuleType; label: string }[] = [
  { value: "REQUIRE_CONSECUTIVE_PERIODS", label: "בלוק שעות רצופות" },
  { value: "SECONDARY_TRACK_END_OF_DAY", label: "מגמה שניה בסוף יום (רצוף)" },
  { value: "GROUPING_EXTRA_AT_END", label: "שעות נוספות בהקבצה בסוף יום" },
];

// ── Form component ───────────────────────────────────────────────────────

function GlobalConstraintForm({
  open,
  onClose,
  constraint,
  schoolId,
  category,
}: {
  open: boolean;
  onClose: () => void;
  constraint: Constraint | null;
  schoolId: number;
  category: ConstraintCategory;
}) {
  const qc = useQueryClient();
  const rules =
    category === "SUBJECT"
      ? SUBJECT_RULES
      : category === "TEACHER"
        ? TEACHER_RULES
        : category === "GROUPING"
          ? GROUPING_RULES
          : CLASS_RULES;

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId),
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId),
  });

  const [ruleType, setRuleType] = useState<RuleType>(
    constraint?.rule_type ?? rules[0].value,
  );
  const [type, setType] = useState<CType>(
    (constraint?.type as CType) ?? "SOFT",
  );
  const [weight, setWeight] = useState(constraint?.weight ?? 70);
  const [params, setParams] = useState<Record<string, unknown>>(
    constraint?.parameters ?? {},
  );
  const [name, setName] = useState(constraint?.name ?? "");

  const setParam = (key: string, value: unknown) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  const autoName =
    name ||
    `ברירת מחדל — ${rules.find((r) => r.value === ruleType)?.label ?? ruleType}`;

  const createMut = useMutation({
    mutationFn: () =>
      createConstraint({
        school_id: schoolId,
        name: autoName,
        description: null,
        category,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: ruleType,
        parameters: params,
        target_type: category,
        target_id: null,
        is_active: true,
        notes: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ כללי נוצר");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת אילוץ"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateConstraint(constraint!.id, {
        name: autoName,
        category,
        type,
        weight: type === "SOFT" ? weight : 100,
        rule_type: ruleType,
        parameters: params,
        target_type: category,
        target_id: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ עודכן");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {constraint ? "עריכת אילוץ כללי" : "אילוץ כללי חדש"}
        </DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          constraint ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="gc-name">שם (אופציונלי)</Label>
          <Input
            id="gc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={autoName}
          />
        </div>

        <div>
          <Label htmlFor="gc-rule">סוג כלל</Label>
          <Select
            id="gc-rule"
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value as RuleType);
              setParams({});
            }}
          >
            {rules.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="gc-type">סוג</Label>
            <Select
              id="gc-type"
              value={type}
              onChange={(e) => setType(e.target.value as CType)}
            >
              <option value="HARD">חובה (HARD)</option>
              <option value="SOFT">רך (SOFT)</option>
            </Select>
          </div>
          {type === "SOFT" && (
            <div>
              <Label htmlFor="gc-weight">משקל ({weight})</Label>
              <input
                id="gc-weight"
                type="range"
                min={1}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="w-full mt-2"
              />
            </div>
          )}
        </div>

        <ParameterFields
          ruleType={ruleType}
          params={params}
          setParam={setParam}
          subjects={subjects}
          classes={classes}
        />

        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : constraint ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ── Parameter Fields ─────────────────────────────────────────────────────

function ParameterFields({
  ruleType,
  params,
  setParam,
  subjects,
  classes = [],
}: {
  ruleType: RuleType;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
  subjects: { id: number; name: string }[];
  classes?: { id: number; name: string }[];
}) {
  const daySelect = (key: string, allowAll = false) => (
    <div>
      <Label className="text-xs">יום</Label>
      <Select
        value={(params[key] as string) ?? (allowAll ? "ALL" : "")}
        onChange={(e) => setParam(key, e.target.value)}
      >
        {allowAll && <option value="ALL">כל הימים</option>}
        {!allowAll && <option value="">בחר יום</option>}
        {DAYS_ORDER.map((d) => (
          <option key={d} value={d}>
            {DAY_LABELS[d]}
          </option>
        ))}
      </Select>
    </div>
  );

  const numberInput = (key: string, label: string, min = 0) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        value={(params[key] as number) ?? ""}
        onChange={(e) => setParam(key, Number(e.target.value))}
      />
    </div>
  );

  switch (ruleType) {
    case "MAX_PER_DAY":
      return numberInput("max", "מקסימום שעות ליום", 1);
    case "MIN_DAYS_SPREAD":
      return numberInput("min_days", "מינימום ימים", 1);
    case "REQUIRE_CONSECUTIVE_PERIODS":
      return numberInput("consecutive_count", "מספר שעות רצופות", 2);
    case "PREFER_TIME_RANGE":
      return (
        <div className="grid grid-cols-3 gap-2">
          {daySelect("day", true)}
          {numberInput("from_period", "משעה", 1)}
          {numberInput("to_period", "עד שעה", 1)}
        </div>
      );
    case "MAX_TEACHING_HOURS_PER_DAY":
      return numberInput("max", "מקסימום שעות", 1);
    case "MAX_TEACHING_DAYS":
      return numberInput("max_days", "מקסימום ימים", 1);
    case "BALANCED_DAILY_LOAD":
      return numberInput("max_difference", "הפרש מקסימלי", 1);
    case "MAX_GAPS_PER_DAY":
      return numberInput("max", "מקסימום חלונות", 0);
    case "CLASS_DAY_LENGTH_LIMIT":
      return (
        <div className="grid grid-cols-2 gap-2">
          {numberInput("max_periods", "מקסימום שעות", 1)}
          {daySelect("day", true)}
        </div>
      );
    case "COMPACT_SCHOOL_DAY":
      return numberInput("min_periods", "מינימום שעות ביום", 1);
    case "CLASS_END_TIME": {
      const selectedClassIds = ((params.target_class_ids as number[]) ?? []);
      const allClassesSelected = selectedClassIds.length === 0;
      const allowedPeriods = ((params.allowed_periods as number[]) ?? []);
      return (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">ימים</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {DAYS_ORDER.map((d) => {
                const selected = ((params.days as string[]) ?? []).includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`px-2 py-1 text-xs rounded border cursor-pointer ${selected ? "bg-primary text-white" : "bg-muted"}`}
                    onClick={() => {
                      const current = ((params.days as string[]) ?? []);
                      setParam("days", selected ? current.filter((x: string) => x !== d) : [...current, d]);
                    }}
                  >
                    {DAY_LABELS[d]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="text-xs">שעות סיום אפשריות</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {[1,2,3,4,5,6,7,8].map((p) => {
                const selected = allowedPeriods.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className={`px-2.5 py-1 text-xs rounded border cursor-pointer ${selected ? "bg-primary text-white" : "bg-muted"}`}
                    onClick={() => {
                      setParam("allowed_periods",
                        selected
                          ? allowedPeriods.filter((x: number) => x !== p)
                          : [...allowedPeriods, p].sort((a, b) => a - b)
                      );
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">בחר את השעות שבהן מותר לסיים את היום</p>
          </div>
          <div>
            <Label className="text-xs">כיתות</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <button
                type="button"
                className={`px-2 py-1 text-xs rounded border cursor-pointer ${allClassesSelected ? "bg-primary text-white" : "bg-muted"}`}
                onClick={() => setParam("target_class_ids", [])}
              >
                כולן
              </button>
              {classes.map((cls) => {
                const isSelected = selectedClassIds.includes(cls.id);
                return (
                  <button
                    key={cls.id}
                    type="button"
                    className={`px-2 py-1 text-xs rounded border cursor-pointer ${isSelected ? "bg-primary text-white" : "bg-muted"}`}
                    onClick={() => {
                      setParam("target_class_ids",
                        isSelected
                          ? selectedClassIds.filter((id: number) => id !== cls.id)
                          : [...selectedClassIds, cls.id]
                      );
                    }}
                  >
                    {cls.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">ריק = כל הכיתות</p>
          </div>
        </div>
      );
    }
    case "NO_GAPS":
    case "NO_CONSECUTIVE_DAYS":
    case "AVOID_LAST_PERIOD":
      return null;
    default:
      return null;
  }
}

// ── Category Section (DB constraints) ────────────────────────────────────

function CategorySection({
  title,
  category,
  globals,
  overrides,
  schoolId,
  entityMap,
  crossExceptions,
  crossEntityMap,
}: {
  title: string;
  category: ConstraintCategory;
  globals: Constraint[];
  overrides: Constraint[];
  schoolId: number;
  entityMap: Record<number, string>;
  crossExceptions?: Constraint[];
  crossEntityMap?: Record<number, string>;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Constraint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Constraint | null>(null);

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      toggleConstraint(id, active),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] }),
  });

  const weightMut = useMutation({
    mutationFn: ({ id, weight }: { id: number; weight: number }) =>
      updateConstraintWeight(id, weight),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteConstraint(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", schoolId] });
      toast.success("אילוץ נמחק");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  // Group overrides by rule_type for display
  const overridesByRule = new Map<string, Constraint[]>();
  for (const o of overrides) {
    const list = overridesByRule.get(o.rule_type) ?? [];
    list.push(o);
    overridesByRule.set(o.rule_type, list);
  }

  // Overrides not matched to any global rule
  const matchedRuleTypes = new Set(globals.map((g) => g.rule_type));
  const unmatchedOverrides = overrides.filter(
    (o) => !matchedRuleTypes.has(o.rule_type),
  );

  return (
    <section className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 bg-card hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          )}
          <h3 className="font-semibold text-lg">{title}</h3>
          {(globals.length + overrides.length) > 0 && (
            <Badge variant="secondary">
              {globals.length + overrides.length}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          הוסף
        </Button>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-3">
          {globals.length === 0 && overrides.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              אין אילוצים — לחץ "הוסף" להגדרת ברירת מחדל
            </p>
          ) : (
            <>
              {globals.map((c) => {
                const ruleOverrides = overridesByRule.get(c.rule_type) ?? [];
                // For MAX_PER_DAY, show cross-category exceptions (e.g. grouping clusters with higher consecutive_count)
                const exceptions =
                  c.rule_type === "MAX_PER_DAY" && crossExceptions
                    ? crossExceptions.filter((ex) => {
                        const cc = ex.parameters?.consecutive_count as number | undefined;
                        const max = c.parameters?.max as number | undefined;
                        return cc != null && max != null && cc > max;
                      })
                    : [];
                return (
                  <ConstraintRow
                    key={c.id}
                    constraint={c}
                    overrides={ruleOverrides}
                    entityMap={entityMap}
                    crossExceptions={exceptions}
                    crossEntityMap={crossEntityMap ?? {}}
                    onToggle={(active) =>
                      toggleMut.mutate({ id: c.id, active })
                    }
                    onWeightChange={(weight) =>
                      weightMut.mutate({ id: c.id, weight })
                    }
                    onEdit={() => {
                      setEditing(c);
                      setFormOpen(true);
                    }}
                    onDelete={() => setDeleteTarget(c)}
                  />
                );
              })}

              {/* Show overrides that don't match any global rule */}
              {unmatchedOverrides.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-dashed">
                  <span className="text-xs text-muted-foreground font-medium">
                    אילוצים ספציפיים (ללא ברירת מחדל):
                  </span>
                  {unmatchedOverrides.map((o) => (
                    <div
                      key={o.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        o.is_active ? "bg-card" : "bg-muted/50 opacity-60"
                      }`}
                    >
                      <button
                        onClick={() =>
                          toggleMut.mutate({ id: o.id, active: !o.is_active })
                        }
                        className="shrink-0 cursor-pointer"
                      >
                        {o.is_active ? (
                          <ToggleRight className="h-5 w-5 text-primary" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {entityMap[o.target_id!] ?? o.name}
                          </span>
                          <Badge
                            variant={o.type === "HARD" ? "default" : "secondary"}
                            className="shrink-0"
                          >
                            {o.type === "HARD" ? (
                              <span className="flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                חובה
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <Feather className="h-3 w-3" />
                                רך
                              </span>
                            )}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {RULE_TYPE_LABELS[o.rule_type]} {"\u2022"} {formatParams(o)}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(o)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {formOpen && (
        <GlobalConstraintForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          constraint={editing}
          schoolId={schoolId}
          category={category}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה"
        message={`האם למחוק את האילוץ "${deleteTarget?.name}"?`}
        loading={deleteMut.isPending}
      />
    </section>
  );
}

// ── Single constraint row ────────────────────────────────────────────────

function ConstraintRow({
  constraint: c,
  overrides,
  entityMap,
  crossExceptions = [],
  crossEntityMap = {},
  onToggle,
  onWeightChange,
  onEdit,
  onDelete,
}: {
  constraint: Constraint;
  overrides: Constraint[];
  entityMap: Record<number, string>;
  crossExceptions?: Constraint[];
  crossEntityMap?: Record<number, string>;
  onToggle: (active: boolean) => void;
  onWeightChange: (weight: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-1">
      <div
        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
          c.is_active ? "bg-card" : "bg-muted/50 opacity-60"
        }`}
      >
        <button
          onClick={() => onToggle(!c.is_active)}
          className="shrink-0 cursor-pointer"
        >
          {c.is_active ? (
            <ToggleRight className="h-5 w-5 text-primary" />
          ) : (
            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{c.name}</span>
            <Badge
              variant={c.type === "HARD" ? "default" : "secondary"}
              className="shrink-0"
            >
              {c.type === "HARD" ? (
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  חובה
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Feather className="h-3 w-3" />
                  רך
                </span>
              )}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {RULE_TYPE_LABELS[c.rule_type]} {"\u2022"} {formatParams(c)}
          </p>
        </div>

        {c.type === "SOFT" && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground w-6 text-center">
              {c.weight}
            </span>
            <input
              type="range"
              min={1}
              max={100}
              value={c.weight}
              onChange={(e) => onWeightChange(Number(e.target.value))}
              className="w-20"
            />
          </div>
        )}

        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Show overrides for this rule */}
      {(overrides.length > 0 || crossExceptions.length > 0) && (
        <div className="mr-8 flex flex-wrap gap-1.5">
          <span className="text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            דריסות:
          </span>
          {overrides.map((o) => (
            <Badge
              key={o.id}
              variant="outline"
              className="text-xs border-amber-300 text-amber-700"
            >
              {entityMap[o.target_id!] ?? o.target_id} —{" "}
              {formatParams(o)}
            </Badge>
          ))}
          {crossExceptions.map((ex) => (
            <Badge
              key={ex.id}
              variant="outline"
              className="text-xs border-violet-300 text-violet-700"
            >
              {crossEntityMap[ex.target_id!] ?? ex.target_id} —{" "}
              {formatParams(ex)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function BrainPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);

  const { data: meetings = [] } = useQuery({
    queryKey: ["meetings", schoolId],
    queryFn: () => fetchMeetings(schoolId!),
    enabled: !!schoolId,
  });

  const { data: constraints = [] } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId!),
    enabled: !!schoolId,
  });

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId!),
    enabled: !!schoolId,
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId!),
    enabled: !!schoolId,
  });

  const { data: clusters = [] } = useQuery({
    queryKey: ["grouping-clusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: !!schoolId,
  });

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  // Brain principles
  const meetingPrinciples = buildMeetingPrinciples(meetings);
  const allPrinciples = [
    ...GLOBAL_PRINCIPLES,
    HOMEROOM_PRINCIPLE,
    ...meetingPrinciples,
  ];
  const CATEGORY_ORDER = ["system", "global", "homeroom", "meetings"];
  const brainCategories = CATEGORY_ORDER.filter((cat) =>
    allPrinciples.some((p) => p.category === cat),
  );

  // DB constraints split
  const globalSubject = constraints.filter(
    (c) => c.target_id === null && c.category === "SUBJECT",
  );
  const globalTeacher = constraints.filter(
    (c) => c.target_id === null && c.category === "TEACHER",
  );
  const globalClass = constraints.filter(
    (c) => c.target_id === null && c.category === "CLASS",
  );
  const globalGrouping = constraints.filter(
    (c) => c.target_id === null && c.category === "GROUPING",
  );

  const overridesSubject = constraints.filter(
    (c) => c.target_id !== null && c.category === "SUBJECT",
  );
  const overridesTeacher = constraints.filter(
    (c) => c.target_id !== null && c.category === "TEACHER",
  );
  const overridesClass = constraints.filter(
    (c) => c.target_id !== null && c.category === "CLASS",
  );
  const overridesGrouping = constraints.filter(
    (c) => c.target_id !== null && c.category === "GROUPING",
  );

  // Entity maps for override display
  const subjectMap: Record<number, string> = Object.fromEntries(
    subjects.map((s) => [s.id, s.name]),
  );
  const teacherMap: Record<number, string> = Object.fromEntries(
    teachers.map((t) => [t.id, t.name]),
  );
  const classMap: Record<number, string> = Object.fromEntries(
    classes.map((c) => [c.id, c.name]),
  );
  const clusterMap: Record<number, string> = Object.fromEntries(
    clusters.map((c) => [c.id, c.name]),
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Brain className="h-7 w-7 text-primary" />
        <div>
          <h2 className="text-2xl font-bold">מח המערכת</h2>
          <p className="text-sm text-muted-foreground">
            עקרונות אוטומטיים ואילוצים כלליים שמנחים את הסולבר
          </p>
        </div>
      </div>

      {/* Brain auto-principles (read-only) */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4" />
          עקרונות אוטומטיים (מובנים)
          <span className="text-xs font-normal text-muted-foreground">
            לא ניתן לשינוי — תמיד פעילים
          </span>
        </h3>

        {brainCategories.map((cat) => {
          const catPrinciples = allPrinciples.filter(
            (p) => p.category === cat,
          );
          return (
            <div key={cat} className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">
                {BRAIN_CATEGORY_LABELS[cat]}
              </span>
              <div className="grid gap-2">
                {catPrinciples.map((p) => (
                  <div
                    key={p.id}
                    className="border rounded-lg p-3 bg-muted/30"
                  >
                    <div className="flex items-start gap-3">
                      <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{p.name}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${BRAIN_CATEGORY_COLORS[p.category] ?? ""}`}
                          >
                            {BRAIN_CATEGORY_LABELS[p.category]}
                          </span>
                          {p.isHard && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-200 text-red-900 font-semibold">
                              HARD
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {p.description}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Divider */}
      <div className="border-t" />

      {/* DB Constraints (editable) */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">
          אילוצים כלליים (ניתנים לעריכה)
        </h3>
        <p className="text-sm text-muted-foreground">
          חלים על כל המקצועות / המורים / הכיתות / ההקבצות — אלא אם יש דריסה
          ספציפית
        </p>
      </section>

      <CategorySection
        title="מקצועות"
        category="SUBJECT"
        globals={globalSubject}
        overrides={overridesSubject}
        schoolId={schoolId}
        entityMap={subjectMap}
        crossExceptions={overridesGrouping}
        crossEntityMap={clusterMap}
      />

      <CategorySection
        title="מורים"
        category="TEACHER"
        globals={globalTeacher}
        overrides={overridesTeacher}
        schoolId={schoolId}
        entityMap={teacherMap}
      />

      <CategorySection
        title="כיתות"
        category="CLASS"
        globals={globalClass}
        overrides={overridesClass}
        schoolId={schoolId}
        entityMap={classMap}
      />

      <CategorySection
        title="הקבצות ומגמות"
        category="GROUPING"
        globals={globalGrouping}
        overrides={overridesGrouping}
        schoolId={schoolId}
        entityMap={clusterMap}
      />
    </div>
  );
}

// ── Helper ───────────────────────────────────────────────────────────────

function formatParams(c: Constraint): string {
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
