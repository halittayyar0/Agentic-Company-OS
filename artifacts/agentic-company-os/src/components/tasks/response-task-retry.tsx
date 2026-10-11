import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { ProjectStudioCopy } from "@/lib/project-studio-copy";
import {
  clearResponseRetryIntent,
  getResponseRetryScope,
  inspectResponseRetry,
  readResponseRetryIntent,
  saveResponseRetryIntent,
  sendResponseRetry,
  type ResponseRetryIntent,
} from "@/lib/response-retry";

export default function ResponseTaskRetry({
  taskId,
  paused,
  c,
  onResumed,
}: {
  taskId: number;
  paused: boolean;
  c: ProjectStudioCopy;
  onResumed: () => void;
}) {
  const client = useQueryClient(),
    guard = useRef(false),
    alive = useRef(true);
  const [initial] = useState(() => {
    try {
      return {
        intent: readResponseRetryIntent(taskId, sessionStorage),
        error: false,
      };
    } catch {
      return { intent: null, error: true };
    }
  });
  const [intent, setIntent] = useState(initial.intent),
    [storageError, setStorageError] = useState(initial.error);
  const [phase, setPhase] = useState<"send" | "inspect" | null>(null);
  const [notice, setNotice] = useState<string | null>(null),
    [accepted, setAccepted] = useState(false);
  const scope = useQuery({
    queryKey: ["task-response-retry", taskId],
    queryFn: ({ signal }) => getResponseRetryScope(taskId, signal),
    retry: false,
    enabled: paused || !!intent,
  });
  const refetch = scope.refetch;
  useEffect(() => {
    if (paused || intent) void refetch();
  }, [paused, intent, refetch]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const dispatch = async (sent: ResponseRetryIntent, inspect = false) => {
    if (guard.current) return;
    if (!inspect) {
      try {
        saveResponseRetryIntent(sent, sessionStorage);
      } catch {
        setStorageError(true);
        return;
      }
    }
    guard.current = true;
    setIntent(sent);
    setPhase(inspect ? "inspect" : "send");
    setNotice(null);
    setAccepted(false);
    try {
      if (inspect) await inspectResponseRetry(sent);
      else await sendResponseRetry(sent);
      if (!alive.current) return;
      setAccepted(true);
      try {
        clearResponseRetryIntent(sent, sessionStorage);
        setIntent(null);
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
      onResumed();
      void client.invalidateQueries({
        predicate: ({ queryKey }) =>
          typeof queryKey[0] === "string" &&
          (queryKey[0].startsWith("/api/tasks") ||
            queryKey[0] === "/api/org/summary"),
      });
      void refetch();
    } catch (error) {
      if (!alive.current) return;
      // A received rejection proves this request did not queue work. Transport
      // uncertainty retains the exact attempt identity for explicit inspection.
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 409
      ) {
        try {
          clearResponseRetryIntent(sent, sessionStorage);
          setIntent(null);
        } catch {
          setStorageError(true);
        }
        setNotice(c.responseRetryRejected);
        void refetch();
      } else setNotice(c.responseRetryUnknown);
    } finally {
      guard.current = false;
      if (alive.current) setPhase(null);
    }
  };
  if (
    !intent &&
    !storageError &&
    !accepted &&
    !notice &&
    !scope.data?.canRetry &&
    !scope.isError
  )
    return null;
  return (
    <section
      data-testid="response-task-retry"
      className="mx-auto mt-4 max-w-[1680px] rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 [overflow-wrap:anywhere]"
    >
      <h2 className="font-semibold">{c.responseRetryHeading}</h2>
      <p className="mt-2 text-sm leading-6">{c.responseRetryHelp}</p>
      {accepted && (
        <p role="status" className="mt-3 text-sm">
          {c.responseRetryAccepted}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      {storageError && (
        <p role="alert" className="mt-3 text-sm">
          {c.answerStorage}
        </p>
      )}
      {scope.isError && (
        <p role="alert" className="mt-3 text-sm">
          {c.loadError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {intent && (
          <Button
            className="min-h-11 whitespace-normal text-start"
            disabled={!!phase}
            aria-busy={phase === "inspect"}
            onClick={() => void dispatch(intent, true)}
          >
            {phase === "inspect" ? c.loading : c.responseRetryInspect}
          </Button>
        )}
        <Button
          className="min-h-11 h-auto whitespace-normal text-start"
          disabled={
            !!phase || storageError || (!intent && !scope.data?.canRetry)
          }
          aria-busy={phase === "send"}
          onClick={() => {
            const attempt =
              intent?.blockedAttemptId ?? scope.data?.blockedAttemptId;
            if (attempt)
              void dispatch(intent ?? { taskId, blockedAttemptId: attempt });
          }}
        >
          {phase === "send"
            ? c.loading
            : intent
              ? c.responseRetrySame
              : c.responseRetryAction}
        </Button>
        <Button
          variant="outline"
          className="min-h-11 h-auto whitespace-normal text-start"
          disabled={!!phase || scope.isFetching}
          onClick={() => void refetch()}
        >
          {c.checkState}
        </Button>
      </div>
    </section>
  );
}
