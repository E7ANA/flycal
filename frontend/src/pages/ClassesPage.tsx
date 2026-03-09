import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchGrades, createGrade, updateGrade, deleteGrade } from "@/api/grades";
import { fetchClasses, createClass, updateClass, deleteClass } from "@/api/classes";
import { Button } from "@/components/common/Button";
import { DataTable } from "@/components/common/DataTable";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Label } from "@/components/common/Label";
import { Badge } from "@/components/common/Badge";
import type { Grade, ClassGroup } from "@/types/models";

// ─── Grade Form ──────────────────────────────────────────
function GradeFormDialog({
  open,
  onClose,
  grade,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  grade: Grade | null;
  schoolId: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(grade?.name ?? "");
  const [level, setLevel] = useState(grade?.level ?? 7);

  const createMut = useMutation({
    mutationFn: () => createGrade({ school_id: schoolId, name, level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grades", schoolId] });
      toast.success("שכבה נוצרה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת שכבה"),
  });

  const updateMut = useMutation({
    mutationFn: () => updateGrade(grade!.id, { name, level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grades", schoolId] });
      toast.success("שכבה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון שכבה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{grade ? "עריכת שכבה" : "שכבה חדשה"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          grade ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="grade-name">שם</Label>
          <Input
            id="grade-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: ז'
            required
          />
        </div>
        <div>
          <Label htmlFor="grade-level">רמה</Label>
          <Input
            id="grade-level"
            type="number"
            min={1}
            max={12}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            required
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : grade ? "עדכן" : "צור"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ─── Class Form ──────────────────────────────────────────
function ClassFormDialog({
  open,
  onClose,
  classGroup,
  grades,
  schoolId,
}: {
  open: boolean;
  onClose: () => void;
  classGroup: ClassGroup | null;
  grades: Grade[];
  schoolId: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(classGroup?.name ?? "");
  const [gradeId, setGradeId] = useState(classGroup?.grade_id ?? (grades[0]?.id ?? 0));
  const [numStudents, setNumStudents] = useState(classGroup?.num_students ?? 30);

  const createMut = useMutation({
    mutationFn: () =>
      createClass({
        school_id: schoolId,
        name,
        grade_id: gradeId,
        num_students: numStudents,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes", schoolId] });
      toast.success("כיתה נוצרה בהצלחה");
      onClose();
    },
    onError: () => toast.error("שגיאה ביצירת כיתה"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateClass(classGroup!.id, {
        name,
        grade_id: gradeId,
        num_students: numStudents,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes", schoolId] });
      toast.success("כיתה עודכנה");
      onClose();
    },
    onError: () => toast.error("שגיאה בעדכון כיתה"),
  });

  const loading = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{classGroup ? "עריכת כיתה" : "כיתה חדשה"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          classGroup ? updateMut.mutate() : createMut.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="class-name">שם</Label>
          <Input
            id="class-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='לדוגמה: ט1'
            required
          />
        </div>
        <div>
          <Label htmlFor="class-grade">שכבה</Label>
          <Select
            id="class-grade"
            value={gradeId}
            onChange={(e) => setGradeId(Number(e.target.value))}
            required
          >
            <option value="">בחר שכבה</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="class-students">מספר תלמידים</Label>
          <Input
            id="class-students"
            type="number"
            min={0}
            value={numStudents}
            onChange={(e) => setNumStudents(Number(e.target.value))}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "שומר..." : classGroup ? "עדכן" : "צור"}
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
export default function ClassesPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  // Dialog state
  const [gradeDialogOpen, setGradeDialogOpen] = useState(false);
  const [editingGrade, setEditingGrade] = useState<Grade | null>(null);
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "grade" | "class"; id: number; name: string } | null>(null);

  const { data: grades = [] } = useQuery({
    queryKey: ["grades", schoolId],
    queryFn: () => fetchGrades(schoolId!),
    enabled: !!schoolId,
  });

  const { data: classes = [] } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId!),
    enabled: !!schoolId,
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      deleteTarget!.type === "grade"
        ? deleteGrade(deleteTarget!.id)
        : deleteClass(deleteTarget!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [deleteTarget!.type === "grade" ? "grades" : "classes", schoolId] });
      toast.success("נמחק בהצלחה");
      setDeleteTarget(null);
    },
    onError: () => toast.error("שגיאה במחיקה"),
  });

  const gradeMap = Object.fromEntries(grades.map((g) => [g.id, g.name]));

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Grades Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">שכבות</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditingGrade(null);
              setGradeDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            שכבה חדשה
          </Button>
        </div>
        <DataTable
          compact
          keyField="id"
          data={grades}
          columns={[
            { header: "שם", accessor: "name" },
            { header: "רמה", accessor: "level" },
            {
              header: "כיתות",
              accessor: (g) => {
                const count = classes.filter((c) => c.grade_id === g.id).length;
                return <Badge variant="secondary">{count}</Badge>;
              },
            },
            {
              header: "פעולות",
              accessor: (g) => (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingGrade(g);
                      setGradeDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ type: "grade", id: g.id, name: g.name });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ),
              className: "w-24",
            },
          ]}
          emptyMessage="אין שכבות — הוסף שכבה חדשה"
        />
      </section>

      {/* Classes Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">כיתות</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditingClass(null);
              setClassDialogOpen(true);
            }}
            disabled={grades.length === 0}
          >
            <Plus className="h-4 w-4" />
            כיתה חדשה
          </Button>
        </div>
        <DataTable
          compact
          keyField="id"
          data={classes}
          columns={[
            { header: "שם", accessor: "name" },
            {
              header: "שכבה",
              accessor: (c) => gradeMap[c.grade_id] ?? "—",
            },
            { header: "תלמידים", accessor: "num_students" },
            {
              header: "פעולות",
              accessor: (c) => (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingClass(c);
                      setClassDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ type: "class", id: c.id, name: c.name });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ),
              className: "w-24",
            },
          ]}
          emptyMessage="אין כיתות — הוסף כיתה חדשה"
        />
      </section>

      {/* Dialogs */}
      {gradeDialogOpen && (
        <GradeFormDialog
          open={gradeDialogOpen}
          onClose={() => setGradeDialogOpen(false)}
          grade={editingGrade}
          schoolId={schoolId}
        />
      )}

      {classDialogOpen && (
        <ClassFormDialog
          open={classDialogOpen}
          onClose={() => setClassDialogOpen(false)}
          classGroup={editingClass}
          grades={grades}
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
