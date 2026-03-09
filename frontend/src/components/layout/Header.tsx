import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { useSchools } from "@/hooks/useSchool";
import { createSchool } from "@/api/schools";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { Label } from "@/components/common/Label";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/common/Dialog";

export function Header() {
  const qc = useQueryClient();
  const { data: schools } = useSchools();
  const activeSchoolId = useSchoolStore((s) => s.activeSchoolId);
  const setActiveSchoolId = useSchoolStore((s) => s.setActiveSchoolId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [schoolName, setSchoolName] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      createSchool({
        name: schoolName,
        days_per_week: 6,
        periods_per_day: 8,
        period_duration_minutes: 45,
        break_slots: [],
        week_start_day: "SUNDAY",
        periods_per_day_map: null,
      }),
    onSuccess: (school) => {
      qc.invalidateQueries({ queryKey: ["schools"] });
      setActiveSchoolId(school.id);
      toast.success("בית ספר נוצר בהצלחה");
      setDialogOpen(false);
      setSchoolName("");
    },
    onError: () => toast.error("שגיאה ביצירת בית ספר"),
  });

  return (
    <>
      <header className="h-14 border-b bg-card flex items-center px-6 gap-4">
        <div className="flex items-center gap-3 me-auto">
          <label className="text-sm text-muted-foreground">בית ספר:</label>
          <select
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
            value={activeSchoolId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              setActiveSchoolId(val ? Number(val) : null);
            }}
          >
            <option value="">בחר בית ספר</option>
            {schools?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            חדש
          </Button>
        </div>
      </header>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>בית ספר חדש</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="school-name">שם בית הספר</Label>
            <Input
              id="school-name"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="לדוגמה: תיכון הראל"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "יוצר..." : "צור"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
