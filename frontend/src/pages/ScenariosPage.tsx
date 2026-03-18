import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Pencil,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Send,
  Cpu,
  Sparkles,
  Clock,
} from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolStore } from "@/stores/schoolStore";
import { fetchSolutions } from "@/api/solver";
import { scenarioSmartEditStream } from "@/api/scenarios";
import type { SmartEditResult, EditAction, StreamEvent } from "@/api/scenarios";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/common/Card";
import { Select } from "@/components/common/Select";
import { Label } from "@/components/common/Label";

interface ThinkingStep {
  step: string;
  message: string;
  status: "active" | "done" | "error";
  details?: string;
  timestamp: Date;
  edits?: EditAction[];
  description?: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}

function StepIcon({ status }: { status: "active" | "done" | "error" }) {
  if (status === "active") {
    return <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />;
  }
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />;
  }
  return <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
}

export default function ScenariosPage() {
  const schoolId = useSchoolStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  const [editBaselineId, setEditBaselineId] = useState<number | "">("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editDeviationWeight, setEditDeviationWeight] = useState(10);
  const [editResult, setEditResult] = useState<SmartEditResult | null>(null);

  // Streaming state
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [clarificationQuestion, setClarificationQuestion] = useState<string | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [conversation, setConversation] = useState<{ role: string; content: string }[]>([]);
  const [tokenUsage, setTokenUsage] = useState<{
    input_tokens: number;
    output_tokens: number;
  } | null>(null);
  const [solverProgress, setSolverProgress] = useState(0);

  const thinkingEndRef = useRef<HTMLDivElement>(null);

  const { data: solutions = [] } = useQuery({
    queryKey: ["solutions", schoolId],
    queryFn: () => fetchSolutions(schoolId!),
    enabled: !!schoolId,
  });

  // Auto-scroll thinking panel
  useEffect(() => {
    thinkingEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thinkingSteps, clarificationQuestion]);

  const addStep = useCallback(
    (step: string, message: string, status: "active" | "done" | "error" = "active") => {
      setThinkingSteps((prev) => {
        // Mark previous active steps as done
        const updated = prev.map((s) =>
          s.status === "active" ? { ...s, status: "done" as const } : s,
        );
        return [...updated, { step, message, status, timestamp: new Date() }];
      });
    },
    [],
  );

  const markLastDone = useCallback(() => {
    setThinkingSteps((prev) =>
      prev.map((s, i) =>
        i === prev.length - 1 && s.status === "active" ? { ...s, status: "done" as const } : s,
      ),
    );
  }, []);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.step) {
        case "parsing":
          addStep("parsing", event.message);
          break;

        case "ai_thinking":
          addStep("ai_thinking", event.message);
          break;

        case "ai_result":
          setThinkingSteps((prev) => {
            const updated = prev.map((s) =>
              s.status === "active" ? { ...s, status: "done" as const } : s,
            );
            return [
              ...updated,
              {
                step: "ai_result",
                message: event.message,
                status: "done" as const,
                timestamp: new Date(),
                edits: event.edits,
                description: event.description,
              },
            ];
          });
          if (event.token_usage) setTokenUsage(event.token_usage);
          break;

        case "clarification":
          markLastDone();
          setClarificationQuestion(event.message);
          if (event.token_usage) setTokenUsage(event.token_usage);
          setIsProcessing(false);
          break;

        case "building_model":
          addStep("building_model", event.message);
          break;

        case "solving":
          if (event.progress !== undefined) {
            setSolverProgress(event.progress);
          }
          // Only add the step once
          setThinkingSteps((prev) => {
            const hasSolving = prev.some((s) => s.step === "solving");
            if (hasSolving) return prev;
            const updated = prev.map((s) =>
              s.status === "active" ? { ...s, status: "done" as const } : s,
            );
            return [
              ...updated,
              { step: "solving", message: event.message, status: "active", timestamp: new Date() },
            ];
          });
          break;

        case "done":
          markLastDone();
          setSolverProgress(100);
          if (event.result) {
            setEditResult(event.result);
            qc.invalidateQueries({ queryKey: ["solutions", schoolId] });
            toast.success("תרחיש עריכה הורץ בהצלחה");
            if (event.result.token_usage) setTokenUsage(event.result.token_usage);
          }
          addStep("done", "הסתיים!", "done");
          setIsProcessing(false);
          break;

        case "error":
          markLastDone();
          addStep("error", event.message, "error");
          toast.error(event.message);
          setIsProcessing(false);
          break;
      }
    },
    [addStep, markLastDone, qc, schoolId],
  );

  const startStream = useCallback(
    async (conv?: { role: string; content: string }[]) => {
      if (!schoolId || editBaselineId === "") return;

      setIsProcessing(true);
      setEditResult(null);
      setClarificationQuestion(null);
      setSolverProgress(0);
      if (!conv) {
        setThinkingSteps([]);
        setTokenUsage(null);
        setConversation([{ role: "user", content: editPrompt.trim() }]);
      }

      try {
        await scenarioSmartEditStream(
          {
            school_id: schoolId,
            baseline_solution_id: editBaselineId as number,
            prompt: editPrompt.trim(),
            deviation_weight: editDeviationWeight,
            conversation: conv,
          },
          handleEvent,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "שגיאה";
        addStep("error", message, "error");
        toast.error(message);
        setIsProcessing(false);
      }
    },
    [schoolId, editBaselineId, editPrompt, editDeviationWeight, handleEvent, addStep],
  );

  const handleClarificationSubmit = useCallback(() => {
    if (!clarificationAnswer.trim()) return;

    const newConv = [
      ...conversation,
      { role: "assistant", content: clarificationQuestion || "" },
      { role: "user", content: clarificationAnswer.trim() },
    ];
    setConversation(newConv);
    setClarificationQuestion(null);
    setClarificationAnswer("");

    // Add the exchange to thinking steps
    addStep("clarification_answer", `תשובה: ${clarificationAnswer.trim()}`, "done");

    startStream(newConv);
  }, [clarificationAnswer, clarificationQuestion, conversation, addStep, startStream]);

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">בחר בית ספר כדי להתחיל</p>
      </div>
    );
  }

  const hasThinkingContent =
    thinkingSteps.length > 0 || clarificationQuestion !== null;

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold">עריכת מערכת</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            הצע שינוי
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            בחר פתרון בסיס ותאר בשפה חופשית מה לשנות — הסולבר ישנה את
            המינימום הנדרש
          </p>

          <div>
            <Label>פתרון בסיס</Label>
            <Select
              value={editBaselineId}
              onChange={(e) =>
                setEditBaselineId(
                  e.target.value ? Number(e.target.value) : "",
                )
              }
            >
              <option value="">בחר פתרון</option>
              {solutions.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} — ציון {s.total_score}
                  {s.scenario_name ? ` (${s.scenario_name})` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>מה לשנות?</Label>
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="לדוגמה: שנה את רות בן דוד ללמד שעתיים ברצף ביום ראשון"
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <Label>
              דבקות לפתרון המקורי ({editDeviationWeight})
            </Label>
            <input
              type="range"
              min={1}
              max={50}
              value={editDeviationWeight}
              onChange={(e) =>
                setEditDeviationWeight(Number(e.target.value))
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>גמיש</span>
              <span>שמרני</span>
            </div>
          </div>

          <Button
            onClick={() => startStream()}
            disabled={
              isProcessing ||
              editBaselineId === "" ||
              !editPrompt.trim()
            }
            className="w-full"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                מעבד...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                הרץ שינוי חכם
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Thinking Panel */}
      {hasThinkingContent && (
        <Card className="border-primary/20 bg-muted/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4" />
              תהליך עיבוד
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto space-y-3 pl-1">
              {thinkingSteps.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <StepIcon status={step.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm ${step.status === "error" ? "text-red-600 font-medium" : ""}`}
                      >
                        {step.message}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {formatTime(step.timestamp)}
                      </span>
                    </div>

                    {/* AI result details */}
                    {step.step === "ai_result" && step.description && (
                      <div className="mt-2 p-2.5 rounded-md bg-primary/5 border border-primary/10">
                        <p className="text-sm font-medium mb-1.5">פירוש AI:</p>
                        <p className="text-sm text-muted-foreground">
                          {step.description}
                        </p>
                        {step.edits && step.edits.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {step.edits.map((e, j) => (
                              <Badge
                                key={j}
                                variant="outline"
                                className="text-xs"
                              >
                                {e.type}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Solver progress bar */}
                    {step.step === "solving" && step.status === "active" && (
                      <div className="mt-2">
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${solverProgress}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {solverProgress}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Clarification chat bubble */}
              {clarificationQuestion && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <MessageSquare className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                        AI מבקש הבהרה:
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {clarificationQuestion}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={clarificationAnswer}
                      onChange={(e) => setClarificationAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleClarificationSubmit();
                      }}
                      placeholder="הקלד תשובה..."
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      onClick={handleClarificationSubmit}
                      disabled={!clarificationAnswer.trim()}
                      className="flex-shrink-0"
                    >
                      <Send className="h-4 w-4" />
                      שלח
                    </Button>
                  </div>
                </div>
              )}

              <div ref={thinkingEndRef} />
            </div>

            {/* Token usage footer */}
            {tokenUsage && (
              <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>
                  טוקנים: {tokenUsage.input_tokens.toLocaleString("he-IL")} קלט
                  {" "}&bull;{" "}
                  {tokenUsage.output_tokens.toLocaleString("he-IL")} פלט
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Final result */}
      {editResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">תוצאה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editResult.ai_description && (
              <div className="text-sm">
                <span className="font-medium">פירוש: </span>
                {editResult.ai_description}
              </div>
            )}

            {editResult.parsed_edits && editResult.parsed_edits.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editResult.parsed_edits.map((e, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {e.type}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Badge
                variant={
                  editResult.status === "OPTIMAL"
                    ? "success"
                    : editResult.status === "FEASIBLE"
                      ? "warning"
                      : "destructive"
                }
              >
                {editResult.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {editResult.solve_time}s
              </span>
            </div>

            {editResult.solutions.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 text-sm"
              >
                <span>ציון: {s.total_score}</span>
                <span className="text-muted-foreground">
                  (ID: {s.id})
                </span>
              </div>
            ))}

            {editResult.comparison && (
              <div className="pt-2 border-t space-y-1">
                <div className="flex items-center gap-3 text-sm">
                  <span>
                    דמיון למקור:{" "}
                    <strong>
                      {editResult.comparison.similarity_pct}%
                    </strong>
                  </span>
                  <Badge
                    variant={
                      editResult.comparison.score_delta >= 0
                        ? "success"
                        : "destructive"
                    }
                  >
                    {editResult.comparison.score_delta >= 0 ? "+" : ""}
                    {editResult.comparison.score_delta} ציון
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {editResult.comparison.common_lessons} שיעורים ללא שינוי
                  {" "}&bull;{" "}{editResult.comparison.only_in_b} שיעורים חדשים
                  {" "}&bull;{" "}{editResult.comparison.only_in_a} שיעורים שהוסרו
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
