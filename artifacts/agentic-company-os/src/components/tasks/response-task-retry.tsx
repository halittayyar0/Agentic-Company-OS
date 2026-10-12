import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { loadResponseRetryRepairCopy } from "@/lib/response-retry-repair-copy";
import { setupMessages } from "@/lib/i18n";
import type { ProjectStudioCopy } from "@/lib/project-studio-copy";
import {
  clearResponseRetryIntent,
  clearDamagedResponseRetry,
  getResponseRetryScope,
  inspectResponseRetry,
  readResponseRetryRecord,
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
  const { locale } = useLocale();
  const [initial] = useState(() => {
    try {
      return {
        record: readResponseRetryRecord(taskId, sessionStorage),
        error: false,
      };
    } catch {
      return { record: null, error: true };
    }
  });
  const [intent, setIntent] = useState(
      initial.record?.kind === "saved" ? initial.record.intent : null,
    ),
    [damaged, setDamaged] = useState(
      initial.record?.kind === "damaged" ? initial.record.raw : null,
    ),
    [storageError, setStorageError] = useState(
      initial.error || initial.record?.kind === "damaged",
    );
  const [phase, setPhase] = useState<"send" | "inspect" | "repair" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null),
    [accepted, setAccepted] = useState(false);
  const repairCopy = useQuery({
    queryKey: ["response-retry-repair-copy", locale],
    queryFn: () => loadResponseRetryRepairCopy(locale),
    enabled: storageError,
    retry: false,
    staleTime: Infinity,
  });
  const r = repairCopy.data;
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
  const failedStorage = (adopt = false) => {
    setStorageError(true);
    try {
      const record = readResponseRetryRecord(taskId, sessionStorage);
      setDamaged(record.kind === "damaged" ? record.raw : null);
      if (adopt && record.kind === "saved") setIntent(record.intent);
    } catch {
      setDamaged(null);
    }
  };
  const repair = async () => {
    if (guard.current || damaged === null || intent || !r) return;
    guard.current = true;
    setPhase("repair");
    setNotice(null);
    const observed = damaged;
    try {
      const current = await refetch();
      if (!alive.current) return;
      if (current.isError || !current.data || current.data.taskId !== taskId)
        throw new Error("Current task scope unavailable");
      clearDamagedResponseRetry(taskId, observed, sessionStorage);
      setDamaged(null);
      setStorageError(false);
      setAccepted(false);
      setNotice(r[3]);
    } catch (error) {
      if (!alive.current) return;
      setNotice(
        error instanceof Error &&
          error.message === "Saved response retry changed"
          ? r[4]
          : r[5],
      );
    } finally {
      guard.current = false;
      if (alive.current) setPhase(null);
    }
  };
  const dispatch = async (sent: ResponseRetryIntent, inspect = false) => {
    if (guard.current) return;
    if (!inspect) {
      try {
        saveResponseRetryIntent(sent, sessionStorage);
      } catch {
        failedStorage(true);
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
        setDamaged(null);
        setStorageError(false);
      } catch {
        failedStorage();
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
          failedStorage();
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
          {r
            ? r[0]
            : repairCopy.isError
              ? setupMessages[locale].languageFileError
              : c.loading}
        </p>
      )}
      {scope.isError && (
        <p role="alert" className="mt-3 text-sm">
          {c.loadError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {damaged !== null && !intent && r && (
          <>
            <p className="basis-full text-sm leading-6">{r[1]}</p>
            <Button
              variant="outline"
              className="min-h-11 h-auto whitespace-normal text-start"
              disabled={!!phase || scope.isFetching}
              aria-busy={phase === "repair"}
              onClick={() => void repair()}
            >
              {phase === "repair" ? c.loading : r[2]}
            </Button>
          </>
        )}
        {intent && (
          <Button
            className="min-h-11 h-auto whitespace-normal text-start"
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
          onClick={() => {
            if (storageError && repairCopy.isError) void repairCopy.refetch();
            void refetch();
          }}
        >
          {c.checkState}
        </Button>
      </div>
    </section>
  );
}
