import type { Grade, ClassGroup } from "@/types/models";

interface MultiClassPickerProps {
  grades: Grade[];
  classes: ClassGroup[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

export function MultiClassPicker({
  grades,
  classes,
  selectedIds,
  onChange,
}: MultiClassPickerProps) {
  const toggle = (id: number) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  const toggleGrade = (gradeId: number) => {
    const gradeClassIds = classes
      .filter((c) => c.grade_id === gradeId)
      .map((c) => c.id);
    const allSelected = gradeClassIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      onChange(selectedIds.filter((id) => !gradeClassIds.includes(id)));
    } else {
      const merged = new Set([...selectedIds, ...gradeClassIds]);
      onChange([...merged]);
    }
  };

  // Only show grades that have classes
  const gradesWithClasses = grades.filter((g) =>
    classes.some((c) => c.grade_id === g.id),
  );

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
      {gradesWithClasses.map((grade) => {
        const gradeClasses = classes.filter((c) => c.grade_id === grade.id);
        const allSelected = gradeClasses.every((c) =>
          selectedIds.includes(c.id),
        );
        const someSelected =
          !allSelected && gradeClasses.some((c) => selectedIds.includes(c.id));

        return (
          <div key={grade.id}>
            <label className="flex items-center gap-2 font-medium text-sm cursor-pointer py-1">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={() => toggleGrade(grade.id)}
                className="rounded"
              />
              שכבה {grade.name}
            </label>
            <div className="mr-6 flex flex-wrap gap-x-4 gap-y-1">
              {gradeClasses.map((cls) => (
                <label
                  key={cls.id}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(cls.id)}
                    onChange={() => toggle(cls.id)}
                    className="rounded"
                  />
                  {cls.name}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      {gradesWithClasses.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-2">
          אין כיתות במערכת
        </p>
      )}
    </div>
  );
}
