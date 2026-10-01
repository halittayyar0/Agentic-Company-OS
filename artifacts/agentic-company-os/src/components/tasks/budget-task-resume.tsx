import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTaskBudgetResumeStatus,
  getTaskBudgetResumeReceipt,
  resumeTaskBudget,
  type TaskBudgetResumeReceipt,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  readBudgetResumeIntent,
  saveBudgetResumeIntent,
  clearBudgetResumeIntent,
  validateBudgetResumeReceipt,
  type BudgetResumeIntent,
} from "@/lib/budget-resume-recovery";
import { studioText, type ProjectStudioCopy } from "@/lib/project-studio-copy";

export default function BudgetTaskResume({
  taskId,
  reason,
  c,
  onResumed,
}: {
  taskId: number;
  reason: string | null;
  c: ProjectStudioCopy;
  onResumed: () => void;
}) {
  const id = useId(),
    client = useQueryClient();
  const [initial] = useState(() => {
    try {
      return readBudgetResumeIntent(taskId, sessionStorage);
    } catch {
      return { intent: null, error: true };
    }
  });
  const [intent, setIntent] = useState(initial.intent);
  const [storageError, setStorageError] = useState(initial.error);
  const [phase, setPhase] = useState<"send" | "inspect" | null>(null);
  const [missing, setMissing] = useState(false);
  const [receipt, setReceipt] = useState<TaskBudgetResumeReceipt | null>(null);
  const guard = useRef(false),
    alive = useRef(true),
    notice = useRef<HTMLParagraphElement>(null);
  const rejection = {
    emergency_stop: c.budgetReasonEmergency,
    task_changed: c.budgetReasonChanged,
    family_invalid: c.budgetReasonInvalid,
    family_too_large: c.budgetReasonLarge,
    allowance_exhausted: c.budgetReasonExhausted,
    nothing_eligible: c.budgetReasonIneligible,
  };
  const scope = useQuery({
    queryKey: ["task-budget-resume-scope", taskId],
    queryFn: ({ signal }) =>
      getTaskBudgetResumeStatus(taskId, { signal, cache: "no-store" }),
    retry: false,
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (receipt || intent || storageError) notice.current?.focus();
  }, [receipt, intent, storageError, missing]);
  const settle = (value: unknown, sent: BudgetResumeIntent) => {
    const result = validateBudgetResumeReceipt(value, sent);
    if (!alive.current) return;
    let cleared = false;
    try {
      cleared = clearBudgetResumeIntent(sent, sessionStorage);
    } catch {
      /* Retain the identity if browser storage is unavailable. */
    }
    setStorageError(!cleared);
    setReceipt(result);
    setMissing(false);
    if (cleared) setIntent(null);
    if (result.outcome === "accepted") {
      onResumed();
      // Family admission affects task lists, descendants, activity and counters.
      void client.invalidateQueries({
        predicate: ({ queryKey }) =>
          typeof queryKey[0] === "string" &&
          (queryKey[0].startsWith("/api/tasks") ||
            queryKey[0] === "/api/org/summary"),
      });
    } else void scope.refetch();
  };
  const dispatch = async (sent: BudgetResumeIntent) => {
    if (guard.current) return;
    let saved = false;
    try {
      saved = saveBudgetResumeIntent(sent, sessionStorage);
    } catch {
      /* Never send without durable recovery details. */
    }
    if (!saved) {
      setStorageError(true);
      return;
    }
    guard.current = true;
    setStorageError(false);
    setIntent(sent);
    setReceipt(null);
    setMissing(false);
    setPhase("send");
    try {
      settle(
        await resumeTaskBudget(
          taskId,
          { requestId: sent.requestId, rootTaskId: sent.rootTaskId },
          { signal: AbortSignal.timeout(30000) },
        ),
        sent,
      );
    } catch {
      /* Keep the saved identity. Only explicit inspection/retry may follow. */
    } finally {
      guard.current = false;
      if (alive.current) setPhase(null);
    }
  };
  const inspect = async () => {
    if (!intent || guard.current) return;
    const sent = intent;
    guard.current = true;
    setPhase("inspect");
    setMissing(false);
    try {
      settle(
        await getTaskBudgetResumeReceipt(taskId, sent.requestId, {
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        }),
        sent,
      );
    } catch (error) {
      if (alive.current)
        setMissing(
          Boolean(
            error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 404,
          ),
        );
    } finally {
      guard.current = false;
      if (alive.current) setPhase(null);
    }
  };
  const start = () => {
    if (
      intent ||
      guard.current ||
      !scope.data?.budgetPaused ||
      !scope.data.rootTaskId
    )
      return;
    try {
      void dispatch({
        version: 1,
        taskId,
        rootTaskId: scope.data.rootTaskId,
        requestId: crypto.randomUUID(),
      });
    } catch {
      setStorageError(true);
    }
  };
  return (
    <section
      aria-labelledby={id}
      className="mt-4 min-w-0 space-y-3 rounded-control border border-amber-500/25 bg-card p-4"
    >
      <h2 id={id} className="text-sm font-semibold">
        {c.budgetHeading}
      </h2>
      {reason && (
        <p
          dir="auto"
          className="whitespace-pre-wrap break-words text-sm leading-6"
        >
          {reason}
        </p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">{c.budgetHelp}</p>
      <a
        href="https://github.com/halittayyar0/Agentic-Company-OS/blob/main/docs/efficient-work.md"
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        {c.budgetGuide}
      </a>
      {storageError && (
        <p
          ref={notice}
          tabIndex={-1}
          role="alert"
          className="break-words text-sm"
        >
          {c.budgetStorage}
        </p>
      )}
      {receipt && (
        <div role="status" className="space-y-2 text-sm">
          <p ref={storageError ? undefined : notice} tabIndex={-1}>
            {receipt.outcome === "accepted"
              ? studioText(c.budgetAccepted, { count: receipt.queuedCount })
              : rejection[receipt.reason!]}
          </p>
          {receipt.stillPausedCount > 0 && (
            <p>
              {studioText(c.budgetStillPaused, {
                count: receipt.stillPausedCount,
              })}
            </p>
          )}
        </div>
      )}
      {intent && (
        <>
          {!receipt && (
            <p
              ref={storageError ? undefined : notice}
              tabIndex={-1}
              role="status"
              className="text-sm leading-6"
            >
              {phase === "send"
                ? c.budgetChecking
                : missing
                  ? c.budgetMissing
                  : c.budgetUnknown}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-auto min-h-11 whitespace-normal"
              onClick={() => void inspect()}
              disabled={phase !== null}
              aria-busy={phase === "inspect"}
            >
              {phase === "inspect" ? c.budgetChecking : c.budgetInspect}
            </Button>
            {missing && (
              <Button
                variant="outline"
                className="h-auto min-h-11 whitespace-normal"
                onClick={() => void dispatch(intent)}
                disabled={phase !== null}
              >
                {c.budgetRetry}
              </Button>
            )}
          </div>
        </>
      )}
      {!intent && receipt?.outcome !== "accepted" && (
        <>
          {scope.isError && (
            <p role="alert" className="text-sm">
              {c.budgetSnapshotError}
            </p>
          )}
          {scope.data?.budgetPaused && !scope.data.rootTaskId && (
            <p role="alert" className="text-sm">
              {c.budgetReasonInvalid}
            </p>
          )}
          <Button
            className="h-auto min-h-11 whitespace-normal"
            onClick={scope.isError ? () => void scope.refetch() : start}
            disabled={
              phase !== null ||
              scope.isPending ||
              (!scope.isError &&
                (!scope.data?.budgetPaused || !scope.data.rootTaskId))
            }
            aria-busy={phase !== null}
          >
            {phase === "send" || scope.isPending
              ? c.budgetChecking
              : scope.isError
                ? c.retry
                : c.budgetCheck}
          </Button>
        </>
      )}
    </section>
  );
}
