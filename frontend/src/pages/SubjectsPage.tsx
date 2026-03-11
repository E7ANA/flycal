import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, Calendar } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import {
  fetchSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  fetchRequirements,
} from "@/api/subjects";
import { fetchGroupingClusters } from "@/api/groupings";
import { Button } from "@/components/common/Button";
import { DataTable } from "@/components/common/DataTable";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/common/Input";
import { Label } from "@/components/common/Label";
import { Select } from "@/components/common/Select";
import { Badge } from "@/components/common/Badge";
import { InlineConstraints } from "@/components/common/InlineConstraints";
import { DAY_LABELS, DAYS_ORDER } from "@/lib/constraints";
import type { Subject, BlockedSlot } from "@/types/models";

// ─── Subject Form ────────────────────────────────────────
function SubjectFormDialog({
  open,
  onClose,
  subject,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(subject?.name ?? "");
  const [color, setColor] = useState(subject?.color ?? "#3B82F6");
  const [alwaysDouble, setAlwaysDouble] = useState(
    subject?.always_double ?? false,
  );
  const [limitLastPeriods, setLimitLastPeriods] = useState(
    subject?.limit_last_periods ?? false,
  );
  const [doublePriority, setDoublePriority] = useState<string>(
    subject?.double_priority != null ? String(subject.double_priority) : "",
  );
  const [morningPriority, setMorningPriority] = useState<string>(
    subject?.morning_priority != null ? String(subject.morning_priority) : "",
  );
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>(
    subject?.blocked_slots ?? [],
  );
  const [blockDay, setBlockDay] = useState("");
  const [blockPeriod, setBlockPeriod] = useState("");

  const addBlockedSlot = () => {
    if (!blockDay || !blockPeriod) return;
    const p = Number(blockPeriod);
    if (blockedSlots.some((s) => s.day === blockDay && s.period === p)) return;
    setBlockedSlots([...blockedSlots, { day: blockDay, period: p }]);
    setBlockPeriod("");
  };

  const removeBlockedSlot = (day: string, period: number) => {
    setBlockedSlots(blockedSlots.filter((s) => !(s.day === day && s.period === period)));
  };

  const createMut = useMutation({
    mutationFn: () =>
      createSubject({
        school_id: schoolId,
        name,
        color,
        double_priority: doublePriority !== "" ? Number(doublePriority) : null,
        morning_priority: morningPriority !== "" ? Number(morningPriority) : null,
        always_double: alwaysDouble,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        limit_last_periods: limitLastPeriods,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
      toast.success("מקצוע נוסף בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה בהוספת מקצוע"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateSubject(subject!.id, {
        name,
        color,
        double_priority: doublePriority !== "" ? Number(doublePriority) : null,
        morning_priority: morningPriority !== "" ? Number(morningPriority) : null,
        always_double: alwaysDouble,
        blocked_slots: blockedSlots.length > 0 ? blockedSlots : null,
        limit_last_periods: limitLastPeriods,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
      toast.success("מקצוע עודכן");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון מקצוע"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          {subject ? "עריכת מקצוע" : "מקצוע חדש"}
        </DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          subject ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="subj-name">שם</Label>
          <Input
            id="subj-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: מתמטיקה"
            required
          />
        </div>
        <div>
          <Label htmlFor="subj-color">צבע</Label>
          <div className="flex items-center gap-3">
            <input
              id="subj-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 rounded border cursor-pointer"
            />
            <span className="text-sm text-muted-foreground">{color}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            id="subj-always-double"
            type="checkbox"
            checked={alwaysDouble}
            onChange={(e) => setAlwaysDouble(e.target.checked)}
            className="h-4 w-4 accent-primary cursor-pointer"
          />
          <Label htmlFor="subj-always-double" className="cursor-pointer">
            הכרח כפולים
          </Label>
          <span className="text-xs text-muted-foreground">
            שעות זוגיות = הכל כפולים, אי-זוגי = כפולים + בודד אחד
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            id="subj-limit-last"
            type="checkbox"
            checked={limitLastPeriods}
            onChange={(e) => setLimitLastPeriods(e.target.checked)}
            className="h-4 w-4 accent-primary cursor-pointer"
          />
          <Label htmlFor="subj-limit-last" className="cursor-pointer">
            הגבלה בשעות אחרונות
          </Label>
          <span className="text-xs text-muted-foreground">
            לא יותר מפעם אחת בשעתיים האחרונות של היום (לכל כיתה)
          </span>
        </div>
        <div>
          <Label htmlFor="subj-double-priority">
            עדיפות שיעורים כפולים (0–100)
          </Label>
          <Input
            id="subj-double-priority"
            type="number"
            min={0}
            max={100}
            value={doublePriority}
            onChange={(e) => setDoublePriority(e.target.value)}
            placeholder="אוטומטי לפי שעות"
          />
          <p className="text-xs text-muted-foreground mt-1">
            ריק = אוטומטי. ערך גבוה = עדיפות גבוהה לשיעורים כפולים
          </p>
        </div>
        <div>
          <Label htmlFor="subj-morning-priority">
            חשיבות תחילת יום (0–100)
          </Label>
          <Input
            id="subj-morning-priority"
            type="number"
            min={0}
            max={100}
            value={morningPriority}
            onChange={(e) => setMorningPriority(e.target.value)}
            placeholder="לא מוגדר"
          />
          <p className="text-xs text-muted-foreground mt-1">
            ריק = ללא העדפה. 100 = הכי חשוב להיות בתחילת היום. ניתן לדרוס בגליון לכל דרישה
          </p>
        </div>
        <div>
          <Label>חסימת שעות למקצוע</Label>
          <p className="text-xs text-muted-foreground mb-2">
            שעות שבהן המקצוע לא יתוזמן (לדוגמה: ספורט לא ביום ראשון)
          </p>
          <div className="flex gap-2 mb-2">
            <Select
              value={blockDay}
              onChange={(e) => setBlockDay(e.target.value)}
              className="flex-1"
            >
              <option value="">בחר יום</option>
              {DAYS_ORDER.map((d) => (
                <option key={d} value={d}>{DAY_LABELS[d]}</option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              max={10}
              placeholder="שעה"
              value={blockPeriod}
              onChange={(e) => setBlockPeriod(e.target.value)}
              className="w-20"
            />
            <Button type="button" variant="outline" size="sm" onClick={addBlockedSlot}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {blockedSlots.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {blockedSlots
                .sort((a, b) => DAYS_ORDER.indexOf(a.day) - DAYS_ORDER.indexOf(b.day) || a.period - b.period)
                .map((s) => (
                  <Badge key={`${s.day}-${s.period}`} variant="secondary" className="gap-1">
                    {DAY_LABELS[s.day]} שעה {s.period}
                    <button
                      type="button"
                      onClick={() => removeBlockedSlot(s.day, s.period)}
                      className="cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
            </div>
          )}
        </div>

        {subject && (
          <InlineConstraints
            schoolId={schoolId}
            category="SUBJECT"
            targetId={subject.id}
            targetName={subject.name}
          />
        )}

        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : subject ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function SubjectsPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [subjectFormOpen, setSubjectFormOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "subject";
    id: number;
    name: string;
  } | null>(null);

  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId!),
    enabled: !!schoolId,
  });

  const { data: requirements = [] } = useQuery({
    queryKey: ["requirements", schoolId],
    queryFn: () => fetchRequirements(schoolId!),
    enabled: !!schoolId,
  });

  const { data: clusters = [] } = useQuery({
    queryKey: ["grouping-clusters", schoolId],
    queryFn: () => fetchGroupingClusters(schoolId!),
    enabled: !!schoolId,
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteSubject(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects", schoolId] });
      toast.success("נמחק בהצלחה");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Subjects Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">מקצועות</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditingSubject(null);
              setSubjectFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            מקצוע חדש
          </Button>
        </div>
        <DataTable
          compact
          keyField="id"
          data={subjects}
          columns={[
            {
              header: "צבע",
              accessor: (s) => (
                <div
                  className="h-5 w-5 rounded-full"
                  style={{ backgroundColor: s.color ?? "#ccc" }}
                />
              ),
              className: "w-16",
            },
            { header: "שם", accessor: "name" },
            {
              header: "הכרח כפולים",
              accessor: (s) =>
                s.always_double ? "✓" : "—",
              className: "w-24 text-center",
            },
            {
              header: "הגבלת אחרונות",
              accessor: (s) =>
                s.limit_last_periods ? "✓" : "—",
              className: "w-28 text-center",
            },
            {
              header: "עדיפות כפולים",
              accessor: (s) =>
                s.double_priority != null
                  ? String(s.double_priority)
                  : "אוטומטי",
              className: "w-28",
            },
            {
              header: "חשיבות בוקר",
              accessor: (s) =>
                s.morning_priority != null
                  ? String(s.morning_priority)
                  : "—",
              className: "w-28",
            },
            {
              header: "חסימות",
              accessor: (s) =>
                s.blocked_slots && s.blocked_slots.length > 0
                  ? `${s.blocked_slots.length} חסימות`
                  : "—",
              className: "w-24",
            },
            {
              header: "דרישות / הקבצות",
              accessor: (s) => {
                const reqCount = requirements.filter(
                  (r) => r.subject_id === s.id,
                ).length;
                const clusterCount = clusters.filter(
                  (c) => c.subject_id === s.id,
                ).length;
                const parts: string[] = [];
                if (reqCount > 0) parts.push(`${reqCount} דרישות`);
                if (clusterCount > 0) parts.push(`${clusterCount} הקבצות`);
                return parts.length > 0 ? parts.join(", ") : "—";
              },
            },
            {
              header: "פעולות",
              accessor: (s) => (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="צפה במערכת"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/results?view=subject&id=${s.id}`);
                    }}
                  >
                    <Calendar className="h-4 w-4 text-primary" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSubject(s);
                      setSubjectFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({
                        type: "subject",
                        id: s.id,
                        name: s.name,
                      });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ),
              className: "w-32",
            },
          ]}
          emptyMessage="אין מקצועות — הוסף מקצוע חדש"
        />
      </section>

      {/* Dialogs */}
      {subjectFormOpen && (
        <SubjectFormDialog
          open={subjectFormOpen}
          onClose={() => setSubjectFormOpen(false)}
          subject={editingSubject}
          schoolId={schoolId}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate()}
        title="אישור מחיקה"
        message={`האם למחוק את "${deleteTarget?.name}"? פעולה זו לא ניתנת לביטול.`}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
