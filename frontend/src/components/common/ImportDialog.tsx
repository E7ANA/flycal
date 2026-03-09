import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import api from "@/api/client";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "./Dialog";
import { Button } from "./Button";
import { Select } from "./Select";
import { Label } from "./Label";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  schoolId: number;
}

type ImportType = "teachers" | "classes" | "requirements";

const IMPORT_LABELS: Record<ImportType, string> = {
  teachers: "מורים",
  classes: "כיתות",
  requirements: "דרישות מקצוע",
};

const IMPORT_HELP: Record<ImportType, string> = {
  teachers: "עמודות נדרשות: שם, מקסימום_שעות, מינימום_שעות, אחוז_משרה, מקצועות",
  classes: "עמודות נדרשות: שם, שכבה, מספר_תלמידים",
  requirements: "עמודות נדרשות: כיתה, מקצוע, מורה, שעות",
};

export function ImportDialog({ open, onClose, schoolId }: ImportDialogProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<ImportType>("teachers");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("לא נבחר קובץ");
      const formData = new FormData();
      formData.append("file", selectedFile);
      const { data } = await api.post(
        `/import/${importType}?school_id=${schoolId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return data as { message: string; created: number; errors: string[] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [importType, schoolId] });
      qc.invalidateQueries({ queryKey: ["teachers", schoolId] });
      qc.invalidateQueries({ queryKey: ["classes", schoolId] });
      qc.invalidateQueries({ queryKey: ["requirements", schoolId] });
      const msg = data.errors.length > 0
        ? `${data.message} (${data.errors.length} שגיאות)`
        : data.message;
      toast.success(msg);
      if (data.errors.length > 0) {
        data.errors.forEach((e: string) => toast.error(e, { duration: 5000 }));
      }
      setSelectedFile(null);
      onClose();
    },
    onError: () => toast.error("שגיאה בייבוא"),
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>ייבוא נתונים</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>סוג ייבוא</Label>
          <Select
            value={importType}
            onChange={(e) => setImportType(e.target.value as ImportType)}
          >
            {Object.entries(IMPORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>

        <p className="text-xs text-muted-foreground">
          {IMPORT_HELP[importType]}
        </p>

        <div>
          <Label>קובץ (Excel או CSV)</Label>
          <div className="mt-1">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => importMut.mutate()}
            disabled={!selectedFile || importMut.isPending}
          >
            {importMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {importMut.isPending ? "מייבא..." : "ייבא"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
