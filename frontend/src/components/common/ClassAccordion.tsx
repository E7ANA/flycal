import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import type { Grade, ClassGroup } from "@/types/models";

interface ClassAccordionProps {
  grades: Grade[];
  classes: ClassGroup[];
  expandedClassId: number | null;
  onToggle: (classId: number) => void;
  renderContent: (classGroup: ClassGroup) => ReactNode;
  renderClassExtra?: (classGroup: ClassGroup) => ReactNode;
}

export function ClassAccordion({
  grades,
  classes,
  expandedClassId,
  onToggle,
  renderContent,
  renderClassExtra,
}: ClassAccordionProps) {
  const sortedGrades = [...grades].sort((a, b) => a.level - b.level);

  if (sortedGrades.length === 0) {
    return (
      <div className="rounded-md border px-4 py-8 text-center text-muted-foreground">
        אין שכבות — הוסף שכבות וכיתות קודם
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sortedGrades.map((grade) => {
        const gradeClasses = classes
          .filter((c) => c.grade_id === grade.id)
          .sort((a, b) => a.name.localeCompare(b.name, "he"));

        if (gradeClasses.length === 0) return null;

        return (
          <div key={grade.id} className="space-y-2">
            <h3 className="text-lg font-semibold text-muted-foreground">
              שכבה {grade.name}
            </h3>
            <div className="space-y-1">
              {gradeClasses.map((cls) => {
                const isExpanded = expandedClassId === cls.id;

                return (
                  <div key={cls.id} className="rounded-md border">
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => onToggle(cls.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-medium">{cls.name}</span>
                      {renderClassExtra && (
                        <span className="mr-auto text-sm text-muted-foreground">
                          {renderClassExtra(cls)}
                        </span>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="border-t bg-muted/20 px-4 py-3">
                        {renderContent(cls)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
