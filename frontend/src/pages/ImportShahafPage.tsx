import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload, Trash2, Check, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { useAuthStore } from "@/stores/authStore";
import { fetchSchools } from "@/api/schools";
import { Button } from "@/components/common/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";

interface PreviewTeacher {
  shahaf_id: string;
  name: string;
  encrypted: boolean;
  target_hours: number | null;
  total_hours: number;
  frontal_hours: number;
  meeting_hours: number;
  homeroom_class_id: string | null;
  homeroom_class_name: string | null;
  roles: string[];
  classes: string[];
  subjects: string[];
  blocked_days: string[];
  blocked_slots_count: number;
  selected: boolean;
}

interface PreviewClass {
  shahaf_id: string;
  name: string;
  layer: string;
  students: number;
  selected: boolean;
}

interface PreviewSubject {
  shahaf_id: string;
  name: string;
  super: string;
  total_hours: number;
  layer_hours: Record<string, number>;
  selected: boolean;
}

interface PreviewStudyItem {
  shahaf_id: string;
  teacher_shahaf_id: string;
  teacher_name: string;
  subject_shahaf_id: string;
  subject_name: string;
  class_shahaf_ids: string[];
  class_names: string[];
  hours: number;
  link_id: string;
  is_grouped: boolean;
  category: "lesson" | "grouped" | "shared" | "meeting" | "plenary";
  layers: string[];
  link_class_count: number;
  selected: boolean;
}

interface PreviewData {
  teachers: PreviewTeacher[];
  classes: PreviewClass[];
  subjects: PreviewSubject[];
  study_items: PreviewStudyItem[];
  teacher_blocks: Record<string, { day: string; period: number }[]>;
  layers: string[];
  backup_data: string;
}

export default function ImportShahafPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const setActiveSchoolId = useSchoolStore((s) => s.setActiveSchoolId);
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importMode, setImportMode] = useState<"new" | "existing">("new");
  const [targetSchoolId, setTargetSchoolId] = useState<number | null>(schoolId);
  const [schoolName, setSchoolName] = useState("");

  const { data: schools = [] } = useQuery({
    queryKey: ["schools"],
    queryFn: fetchSchools,
  });
  const [lessonLayerFilter, setLessonLayerFilter] = useState<string | null>(null);
  const [studyItemSearch, setStudyItemSearch] = useState("");
  // Merge mode: first click selects the "base" row, subsequent clicks merge into it
  const [mergeBaseIdx, setMergeBaseIdx] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    teachers: true,
    classes: true,
    subjects: true,
    study_items: false,
  });

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleUpload = async (file: File) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("backup", file);
      const token = useAuthStore.getState().token;
      const res = await fetch("/api/import-shahaf/preview", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        const detail = errBody?.detail || `שגיאה ${res.status}`;
        throw new Error(detail);
      }
      const data: PreviewData = await res.json();
      setPreview(data);
      toast.success(
        `נמצאו ${data.teachers.length} מורים, ${data.classes.length} כיתות, ${data.subjects.length} מקצועות, ${data.study_items.length} שיבוצים`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה בקריאת הגיבוי";
      toast.error(msg, { duration: 8000 });
      console.error("Preview error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    if (importMode === "existing" && !targetSchoolId) {
      toast.error("בחר בית ספר יעד");
      return;
    }
    setImporting(true);
    try {
      const token = useAuthStore.getState().token;
      const payload = {
        school_id: importMode === "existing" ? targetSchoolId : undefined,
        school_name: importMode === "new" ? (schoolName || undefined) : undefined,
        teachers: preview.teachers.filter((t) => t.selected),
        classes: preview.classes.filter((c) => c.selected),
        subjects: preview.subjects.filter((s) => s.selected),
        study_items: preview.study_items.filter((si) => si.selected),
        teacher_blocks: preview.teacher_blocks,
        backup_data: preview.backup_data,
      };
      const res = await fetch("/api/import-shahaf/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        const detail = errBody?.detail || `שגיאה ${res.status}`;
        throw new Error(detail);
      }
      const result = await res.json();
      // Switch to the newly created school
      if (result.stats.school_id) {
        setActiveSchoolId(result.stats.school_id);
      }
      toast.success(
        `נוצר "${result.stats.school_name}" — יובאו: ${result.stats.teachers} מורים, ${result.stats.classes} כיתות, ${result.stats.subjects} מקצועות, ${result.stats.requirements} שיבוצים`,
      );
      setPreview(null);
      setSchoolName("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה בייבוא";
      toast.error(msg, { duration: 8000 });
      console.error("Import error:", err);
    } finally {
      setImporting(false);
    }
  };

  // Sync study_items selection based on selected subject shahaf_ids
  const syncStudyItemsWithSubjects = (updatedSubjects: typeof preview.subjects) => {
    if (!preview) return preview!.study_items;
    const selectedSubjectIds = new Set(
      updatedSubjects.filter((s) => s.selected).map((s) => s.shahaf_id),
    );
    return preview.study_items.map((si) =>
      selectedSubjectIds.has(si.subject_shahaf_id)
        ? si  // keep current selection if subject is selected
        : { ...si, selected: false },  // deselect if subject is deselected
    );
  };

  const toggleAll = (
    key: "teachers" | "classes" | "subjects" | "study_items",
    selected: boolean,
  ) => {
    if (!preview) return;
    const updated = preview[key].map((item) => ({ ...item, selected }));
    if (key === "subjects") {
      setPreview({
        ...preview,
        subjects: updated as typeof preview.subjects,
        study_items: syncStudyItemsWithSubjects(updated as typeof preview.subjects),
      });
    } else {
      setPreview({ ...preview, [key]: updated });
    }
  };

  const toggleItem = (
    key: "teachers" | "classes" | "subjects" | "study_items",
    index: number,
  ) => {
    if (!preview) return;
    const arr = [...preview[key]];
    arr[index] = { ...arr[index], selected: !arr[index].selected };
    if (key === "subjects") {
      setPreview({
        ...preview,
        subjects: arr as typeof preview.subjects,
        study_items: syncStudyItemsWithSubjects(arr as typeof preview.subjects),
      });
    } else {
      setPreview({ ...preview, [key]: arr });
    }
  };

  // No need to select a school first — import always creates a new one

  const selectedCounts = preview
    ? {
        teachers: preview.teachers.filter((t) => t.selected).length,
        classes: preview.classes.filter((c) => c.selected).length,
        subjects: preview.subjects.filter((s) => s.selected).length,
        study_items: preview.study_items.filter((si) => si.selected).length,
      }
    : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold">ייבוא משחף</h2>

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            העלאת גיבוי שחף
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            העלה קובץ ZIP של גיבוי שחף. המערכת תפרסר את כל הנתונים ותציג אותם לסינון.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {loading ? "מפרסר..." : "בחר קובץ ZIP"}
          </Button>
        </CardContent>
      </Card>

      {/* Preview */}
      {preview && (
        <>
          {/* Summary */}
          <div className="flex gap-3 flex-wrap">
            <Badge variant="outline" className="text-sm">
              מורים: {selectedCounts!.teachers}/{preview.teachers.length}
            </Badge>
            <Badge variant="outline" className="text-sm">
              כיתות: {selectedCounts!.classes}/{preview.classes.length}
            </Badge>
            <Badge variant="outline" className="text-sm">
              מקצועות: {selectedCounts!.subjects}/{preview.subjects.length}
            </Badge>
            <Badge variant="outline" className="text-sm">
              שיבוצים: {selectedCounts!.study_items}/{preview.study_items.length}
            </Badge>
          </div>

          {/* Teachers */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection("teachers")}>
              <CardTitle className="flex items-center justify-between">
                <span>מורים ({selectedCounts!.teachers}/{preview.teachers.length})</span>
                <div className="flex gap-2 items-center">
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("teachers", true); }}>בחר הכל</Button>
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("teachers", false); }}>נקה הכל</Button>
                  {expandedSections.teachers ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </CardTitle>
            </CardHeader>
            {expandedSections.teachers && (
              <CardContent>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="px-2 py-1.5 text-start w-8"></th>
                        <th className="px-2 py-1.5 text-center">מזהה</th>
                        <th className="px-2 py-1.5 text-start">שם</th>
                        <th className="px-2 py-1.5 text-center">סה"כ</th>
                        <th className="px-2 py-1.5 text-center">פרונטלי</th>
                        <th className="px-2 py-1.5 text-center">שעות משרה</th>
                        <th className="px-2 py-1.5 text-center">ישיבות</th>
                        <th className="px-2 py-1.5 text-start">תפקיד</th>
                        <th className="px-2 py-1.5 text-start">חסימות</th>
                        <th className="px-2 py-1.5 text-start">כיתות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.teachers.map((t, i) => (
                        <tr
                          key={t.shahaf_id}
                          className={`border-b transition-colors ${
                            t.selected
                              ? "hover:bg-muted/30"
                              : "bg-muted/10 text-muted-foreground"
                          }`}
                        >
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              checked={t.selected}
                              onChange={() => toggleItem("teachers", i)}
                              className="rounded cursor-pointer"
                            />
                          </td>
                          <td className="px-2 py-1 text-center text-xs text-muted-foreground font-mono">
                            {t.shahaf_id}
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="text"
                              value={t.encrypted ? (t.name.startsWith("~!") ? "" : t.name) : t.name}
                              onChange={(e) => {
                                const arr = [...preview!.teachers];
                                arr[i] = { ...arr[i], name: e.target.value, encrypted: false };
                                setPreview({ ...preview!, teachers: arr });
                              }}
                              placeholder={`מורה #${t.shahaf_id}`}
                              className="w-full px-2 py-0.5 text-sm rounded border border-border bg-background"
                            />
                          </td>
                          <td className="px-2 py-1 text-center">{t.total_hours}</td>
                          <td className="px-2 py-1 text-center font-medium">{t.frontal_hours}</td>
                          <td className="px-2 py-1 text-center">{t.target_hours ?? "—"}</td>
                          <td className="px-2 py-1 text-center text-muted-foreground">{t.meeting_hours}</td>
                          <td className="px-2 py-1">
                            <div className="flex flex-wrap gap-1">
                              {t.roles.map((r) => (
                                <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-2 py-1">
                            {t.blocked_days.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {t.blocked_days.map((d) => (
                                  <Badge key={d} variant="destructive" className="text-xs">{d}</Badge>
                                ))}
                              </div>
                            ) : t.blocked_slots_count > 0 ? (
                              <span className="text-xs text-muted-foreground">{t.blocked_slots_count} משבצות</span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-xs text-muted-foreground max-w-48" title={t.classes.join(", ")}>
                            {t.classes.slice(0, 4).join(", ")}
                            {t.classes.length > 4 && ` +${t.classes.length - 4}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Classes */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection("classes")}>
              <CardTitle className="flex items-center justify-between">
                <span>כיתות ({selectedCounts!.classes}/{preview.classes.length})</span>
                <div className="flex gap-2 items-center">
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("classes", true); }}>בחר הכל</Button>
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("classes", false); }}>נקה הכל</Button>
                  {expandedSections.classes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </CardTitle>
            </CardHeader>
            {expandedSections.classes && (
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {preview.classes.map((c, i) => (
                    <button
                      key={c.shahaf_id}
                      onClick={() => toggleItem("classes", i)}
                      className={`px-3 py-1 text-sm rounded-full border transition-colors cursor-pointer ${
                        c.selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/30 text-muted-foreground border-border line-through"
                      }`}
                    >
                      {c.name} ({c.layer})
                    </button>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Subjects */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection("subjects")}>
              <CardTitle className="flex items-center justify-between">
                <span>מקצועות ({selectedCounts!.subjects}/{preview.subjects.length})</span>
                <div className="flex gap-2 items-center">
                  <Button size="sm" variant="outline" onClick={(e) => {
                    e.stopPropagation();
                    setPreview({
                      ...preview!,
                      subjects: preview!.subjects.map((s) => ({
                        ...s,
                        selected: s.total_hours > 0,
                      })),
                    });
                  }}>הסר ללא שעות</Button>
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("subjects", true); }}>בחר הכל</Button>
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("subjects", false); }}>נקה הכל</Button>
                  {expandedSections.subjects ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </CardTitle>
            </CardHeader>
            {expandedSections.subjects && (
              <CardContent>
                {(() => {
                  const layers = preview.subjects.length > 0
                    ? Object.keys(preview.subjects[0].layer_hours || {})
                    : [];
                  return (
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card">
                          <tr className="border-b text-muted-foreground text-xs">
                            <th className="px-2 py-1.5 w-8"></th>
                            <th className="px-2 py-1.5 text-center">מזהה</th>
                            <th className="px-2 py-1.5 text-start">שם מקצוע</th>
                            <th className="px-2 py-1.5 text-center">סה"כ</th>
                            {layers.map((l) => (
                              <th key={l} className="px-2 py-1.5 text-center">{l}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.subjects.map((s, i) => (
                            <tr
                              key={s.shahaf_id}
                              className={`border-b transition-colors ${
                                s.selected
                                  ? s.total_hours > 0 ? "hover:bg-muted/30" : "text-muted-foreground"
                                  : "bg-muted/10 text-muted-foreground line-through"
                              }`}
                            >
                              <td className="px-2 py-0.5">
                                <input
                                  type="checkbox"
                                  checked={s.selected}
                                  onChange={() => toggleItem("subjects", i)}
                                  className="rounded cursor-pointer"
                                />
                              </td>
                              <td className="px-2 py-0.5 text-center text-xs text-muted-foreground font-mono">
                                {s.shahaf_id}
                              </td>
                              <td className="px-2 py-0.5">
                                {s.name}
                                {s.super && (
                                  <span className="text-xs text-muted-foreground mr-1">({s.super})</span>
                                )}
                              </td>
                              <td className="px-2 py-0.5 text-center font-medium">
                                {s.total_hours || ""}
                              </td>
                              {layers.map((l) => (
                                <td key={l} className="px-2 py-0.5 text-center">
                                  {s.layer_hours[l] || ""}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </CardContent>
            )}
          </Card>

          {/* Study Items — unified table */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection("study_items")}>
              <CardTitle className="flex items-center justify-between">
                <span>שיבוצים ({preview.study_items.filter((si) => si.selected).length}/{preview.study_items.length})</span>
                <div className="flex gap-2 items-center">
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("study_items", true); }}>בחר הכל</Button>
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); toggleAll("study_items", false); }}>נקה הכל</Button>
                  {expandedSections.study_items ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </CardTitle>
            </CardHeader>
            {expandedSections.study_items && (
              <CardContent>
                {/* Search */}
                <input
                  type="text"
                  value={studyItemSearch}
                  onChange={(e) => setStudyItemSearch(e.target.value)}
                  placeholder="חיפוש לפי מורה, מקצוע או כיתה..."
                  className="w-full px-3 py-1.5 mb-3 rounded-md border border-border bg-background text-sm"
                />
                {/* Layer filter tabs */}
                {preview.layers.length > 0 && (
                  <div className="flex gap-1 mb-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setLessonLayerFilter(null)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                        lessonLayerFilter === null
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      הכל
                    </button>
                    {preview.layers.map((layer) => {
                      const layerCount = preview.study_items.filter(
                        (si) => si.layers.includes(layer),
                      ).length;
                      return (
                        <button
                          key={layer}
                          type="button"
                          onClick={() => setLessonLayerFilter(layer)}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                            lessonLayerFilter === layer
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-muted"
                          }`}
                        >
                          {layer} ({layerCount})
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="px-2 py-1.5 w-8"></th>
                        <th className="px-2 py-1.5 text-center">שעות</th>
                        <th className="px-2 py-1.5 text-start">מורה</th>
                        <th className="px-2 py-1.5 text-start">מקצוע</th>
                        <th className="px-2 py-1.5 text-start">כיתה</th>
                        <th className="px-2 py-1.5 text-center">סוג</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.study_items
                        .map((si, origIdx) => ({ si, origIdx }))
                        .filter(({ si }) =>
                          lessonLayerFilter === null || si.layers.includes(lessonLayerFilter) || si.layers.length === 0,
                        )
                        .filter(({ si }) => {
                          if (!studyItemSearch) return true;
                          const q = studyItemSearch.toLowerCase();
                          return si.teacher_name.toLowerCase().includes(q)
                            || si.subject_name.toLowerCase().includes(q)
                            || si.class_names.some((c) => c.toLowerCase().includes(q));
                        })
                        .map(({ si, origIdx }) => (
                        <tr
                          key={`${si.shahaf_id}-${origIdx}`}
                          className={`border-b transition-colors ${
                            si.selected
                              ? "hover:bg-muted/30"
                              : "bg-muted/10 text-muted-foreground line-through"
                          }`}
                        >
                          <td className="px-2 py-0.5">
                            <input
                              type="checkbox"
                              checked={si.selected}
                              onChange={() => toggleItem("study_items", origIdx)}
                              className="rounded cursor-pointer"
                            />
                          </td>
                          <td className="px-2 py-0.5 text-center font-medium">{si.hours}</td>
                          <td className="px-2 py-0.5">{si.teacher_name}</td>
                          <td className="px-2 py-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const subjectId = si.subject_shahaf_id;
                                const allOfSubject = preview!.study_items.filter(
                                  (s) => s.subject_shahaf_id === subjectId,
                                );
                                const allSelected = allOfSubject.every((s) => s.selected);
                                setPreview({
                                  ...preview!,
                                  study_items: preview!.study_items.map((s) =>
                                    s.subject_shahaf_id === subjectId
                                      ? { ...s, selected: !allSelected }
                                      : s,
                                  ),
                                });
                              }}
                              className="hover:underline hover:text-primary cursor-pointer text-start"
                              title={`לחץ להסיר/להוסיף את כל ${si.subject_name}`}
                            >
                              {si.subject_name}
                            </button>
                          </td>
                          <td className="px-2 py-0.5 text-muted-foreground">
                            {si.class_names.join(", ") || "—"}
                          </td>
                          <td className="px-2 py-0.5 text-center">
                            <Badge variant={
                              si.category === "meeting" || si.category === "plenary" ? "destructive"
                              : si.category === "grouped" ? "default"
                              : si.category === "shared" ? "outline"
                              : "secondary"
                            } className="text-xs">
                              {si.category === "lesson" ? "שיעור"
                                : si.category === "grouped" ? "הקבצה"
                                : si.category === "shared" ? "משותף"
                                : si.category === "meeting" ? "ישיבה"
                                : "מליאה"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>
          <div className="space-y-3">
            <div className="space-y-3">
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === "new"}
                    onChange={() => setImportMode("new")}
                  />
                  <span className="text-sm font-medium">בית ספר חדש</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === "existing"}
                    onChange={() => setImportMode("existing")}
                  />
                  <span className="text-sm font-medium">הוסף לבית ספר קיים</span>
                </label>
              </div>

              {importMode === "new" ? (
                <div>
                  <input
                    type="text"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder={`ייבוא ${new Date().toLocaleDateString("he-IL")}`}
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    השאר ריק לשם אוטומטי.
                  </p>
                </div>
              ) : (
                <div>
                  <select
                    value={targetSchoolId ?? ""}
                    onChange={(e) => setTargetSchoolId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                  >
                    <option value="">בחר בית ספר...</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    הנתונים הנבחרים יתווספו לבית הספר הקיים. פריטים עם אותו מזהה שחף יתעדכנו.
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-3">
            <Button
              size="lg"
              className="flex-1"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              {importing ? "מייבא..." : `ייבא ${selectedCounts!.teachers} מורים, ${selectedCounts!.classes} כיתות, ${selectedCounts!.subjects} מקצועות`}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setPreview(null)}
            >
              <Trash2 className="h-5 w-5" />
              ביטול
            </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
