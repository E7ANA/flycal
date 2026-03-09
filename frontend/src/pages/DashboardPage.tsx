import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { ImportDialog } from "@/components/common/ImportDialog";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchClasses } from "@/api/classes";
import { fetchTeachers } from "@/api/teachers";
import { fetchSubjects, fetchRequirements } from "@/api/subjects";
import { fetchConstraints } from "@/api/constraints";
import { fetchSolutions } from "@/api/solver";
import { fetchTimeSlots } from "@/api/timeslots";

export default function DashboardPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const [importOpen, setImportOpen] = useState(false);

  const { data: classes } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: () => fetchClasses(schoolId!),
    enabled: !!schoolId,
  });

  const { data: teachers } = useQuery({
    queryKey: ["teachers", schoolId],
    queryFn: () => fetchTeachers(schoolId!),
    enabled: !!schoolId,
  });

  const { data: subjects } = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => fetchSubjects(schoolId!),
    enabled: !!schoolId,
  });

  const { data: requirements } = useQuery({
    queryKey: ["requirements", schoolId],
    queryFn: () => fetchRequirements(schoolId!),
    enabled: !!schoolId,
  });

  const { data: constraints } = useQuery({
    queryKey: ["constraints", schoolId],
    queryFn: () => fetchConstraints(schoolId!),
    enabled: !!schoolId,
  });

  const { data: solutions } = useQuery({
    queryKey: ["solutions", schoolId],
    queryFn: () => fetchSolutions(schoolId!),
    enabled: !!schoolId,
  });

  const { data: timeslots } = useQuery({
    queryKey: ["timeslots", schoolId],
    queryFn: () => fetchTimeSlots(schoolId!),
    enabled: !!schoolId,
  });

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-lg">
          בחר בית ספר מהתפריט העליון כדי להתחיל
        </p>
      </div>
    );
  }

  const summaryRows = [
    { label: "כיתות", value: classes?.length ?? 0 },
    { label: "מורים", value: teachers?.length ?? 0 },
    { label: "מקצועות", value: subjects?.length ?? 0 },
    { label: "דרישות", value: requirements?.length ?? 0 },
    { label: "אילוצים", value: constraints?.length ?? 0 },
    { label: "משבצות זמן", value: timeslots?.length ?? 0 },
    { label: "פתרונות", value: solutions?.length ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">לוח בקרה</h2>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" />
          ייבוא נתונים
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">סיכום נתונים</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {summaryRows.map((row) => (
                  <tr key={row.label} className="border-t first:border-t-0 hover:bg-muted/50 transition-colors">
                    <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                    <td className="px-3 py-1.5 font-medium text-end">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {solutions && solutions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">פתרון אחרון</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Badge
                variant={
                  solutions[0].status === "OPTIMAL"
                    ? "success"
                    : solutions[0].status === "FEASIBLE"
                      ? "warning"
                      : "destructive"
                }
              >
                {solutions[0].status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                ציון: {solutions[0].total_score}
              </span>
              <span className="text-sm text-muted-foreground">
                זמן: {solutions[0].solve_time_seconds}s
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {importOpen && (
        <ImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          schoolId={schoolId}
        />
      )}
    </div>
  );
}
