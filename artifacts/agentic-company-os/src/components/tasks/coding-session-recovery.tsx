import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCodexSessionRecovery,
  getCodexSessionRecoveryReceipt,
  recoverCodexSession,
} from "@/lib/coding-recovery-api";
import type { CodexSessionRecoveryReceipt } from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { loadCodingRecoveryCopy } from "@/lib/coding-recovery-copy";
import { setupMessages } from "@/lib/i18n";
import {
  readCodingRecoveryIntent,
  saveCodingRecoveryIntent,
  clearCodingRecoveryIntent,
  validateCodingRecoveryReceipt,
  codingRecoveryRequestId,
  type CodingRecoveryIntent,
} from "@/lib/coding-recovery-intent";

export default function CodingSessionRecovery({ taskId }: { taskId: number }) {
  const { locale, t } = useLocale(),
    id = useId(),
    client = useQueryClient();
  const copy = useQuery({
    queryKey: ["coding-recovery-copy", locale],
    queryFn: () => loadCodingRecoveryCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const c = copy.data;
  const [initial] = useState(() => {
    try {
      return readCodingRecoveryIntent(taskId, sessionStorage);
    } catch {
      return { intent: null, error: true };
    }
  });
  const [intent, setIntent] = useState(initial.intent),
    [storageError, setStorageError] = useState(initial.error),
    [open, setOpen] = useState(!!initial.intent),
    [acknowledged, setAcknowledged] = useState(false),
    [phase, setPhase] = useState<"send" | "inspect" | null>(null),
    [receipt, setReceipt] = useState<CodexSessionRecoveryReceipt | null>(null),
    [missing, setMissing] = useState(false);
  const guard = useRef(false),
    alive = useRef(true),
    notice = useRef<HTMLParagraphElement>(null);
  const scope = useQuery({
    queryKey: ["coding-session-recovery", taskId],
    queryFn: ({ signal }) =>
      getCodexSessionRecovery(taskId, { signal, cache: "no-store" }),
    enabled: open && !!c,
    retry: false,
    refetchInterval: open && !!c ? 5000 : false,
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setAcknowledged(false);
  }, [scope.data?.revision]);
  useEffect(() => {
    if (receipt) notice.current?.focus();
  }, [receipt]);
  const settle = (value: unknown, sent: CodingRecoveryIntent) => {
    const result = validateCodingRecoveryReceipt(value, sent);
    if (!alive.current) return;
    let cleared = false;
    try {
      cleared = clearCodingRecoveryIntent(sent, sessionStorage);
    } catch {
      /* Preserve the identity if storage is inaccessible. */
    }
    setStorageError(!cleared);
    setReceipt(result);
    setMissing(false);
    if (cleared) setIntent(null);
    void scope.refetch();
    void client.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === "string" &&
        queryKey[0].startsWith(`/api/tasks/${taskId}/activity`),
    });
  };
  const dispatch = async (sent: CodingRecoveryIntent) => {
    if (guard.current) return;
    let saved = false;
    try {
      saved = saveCodingRecoveryIntent(sent, sessionStorage);
    } catch {
      /* No write without durable intent. */
    }
    if (!saved) {
      setStorageError(true);
      return;
    }
    guard.current = true;
    setIntent(sent);
    setReceipt(null);
    setStorageError(false);
    setMissing(false);
    setPhase("send");
    try {
      settle(
        await recoverCodexSession(
          taskId,
          {
            requestId: sent.requestId,
            expectedRevision: sent.expectedRevision,
            acknowledgeUncertainEffects: true,
          },
          { signal: AbortSignal.timeout(30000) },
        ),
        sent,
      );
    } catch {
      /* Keep the exact request; never auto-submit a replacement. */
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
        await getCodexSessionRecoveryReceipt(taskId, sent.requestId, {
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        }),
        sent,
      );
    } catch (error) {
      if (alive.current)
        setMissing(
          !!error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 404,
        );
    } finally {
      guard.current = false;
      if (alive.current) setPhase(null);
    }
  };
  const start = () => {
    if (
      !acknowledged ||
      intent ||
      guard.current ||
      !scope.data?.canReset ||
      scope.isFetching ||
      scope.data.revision === null
    )
      return;
    try {
      void dispatch({
        version: 1,
        taskId,
        requestId: codingRecoveryRequestId(),
        expectedRevision: scope.data.revision,
      });
    } catch {
      setStorageError(true);
    }
  };
  if (!c)
    return (
      <section
        data-coding-session-recovery
        className="mt-4 min-w-0 rounded-control border bg-card p-4"
      >
        <p
          role={copy.isError ? "alert" : "status"}
          className="break-words text-sm leading-6"
        >
          {copy.isError
            ? setupMessages[locale].languageFileError
            : t("loadingScreen")}
        </p>
        {copy.isError && (
          <Button
            variant="outline"
            className="mt-3 h-auto min-h-11 whitespace-normal"
            onClick={() => window.location.reload()}
          >
            {t("checkAgain")}
          </Button>
        )}
      </section>
    );
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-4 min-w-0 rounded-control border bg-card"
    >
      <summary className="min-h-11 cursor-pointer break-words px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {c.title}
      </summary>
      {open && (
        <div className="min-w-0 space-y-3 border-t px-4 pb-4 pt-3">
          {receipt?.outcome !== "accepted" && (
            <p id={id} className="break-words text-sm leading-6">
              {c.description}
            </p>
          )}
          {storageError && (
            <>
              <p role="alert" className="break-words text-sm leading-6">
                {c.storage}
              </p>
              <Button
                variant="outline"
                className="h-auto min-h-11 whitespace-normal"
                onClick={() => {
                  try {
                    const state = readCodingRecoveryIntent(
                      taskId,
                      sessionStorage,
                    );
                    setStorageError(state.error);
                    if (!state.error) setIntent(state.intent);
                  } catch {
                    setStorageError(true);
                  }
                }}
              >
                {t("checkAgain")}
              </Button>
            </>
          )}
          {receipt && (
            <p
              ref={notice}
              tabIndex={-1}
              role="status"
              className="break-words text-sm font-medium leading-6"
            >
              {receipt.outcome === "accepted"
                ? c.success
                : c.reasons[receipt.reason!]}
            </p>
          )}
          {intent ? (
            <>
              {!receipt && (
                <p role="status" className="break-words text-sm leading-6">
                  {phase ? c.checking : missing ? c.missing : c.unknown}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => void inspect()}
                  disabled={phase !== null}
                  aria-busy={phase === "inspect"}
                  className="h-auto min-h-11 whitespace-normal"
                >
                  {phase === "inspect" ? c.checking : c.inspect}
                </Button>
                {missing && (
                  <Button
                    variant="outline"
                    className="h-auto min-h-11 whitespace-normal"
                    disabled={phase !== null}
                    onClick={() => void dispatch(intent)}
                  >
                    {c.retry}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              {scope.isError ? (
                <>
                  <p role="alert" className="text-sm leading-6">
                    {c.snapshotError}
                  </p>
                  <Button
                    variant="outline"
                    className="h-auto min-h-11 whitespace-normal"
                    onClick={() => void scope.refetch()}
                  >
                    {t("checkAgain")}
                  </Button>
                </>
              ) : scope.isPending ? (
                <p role="status" className="text-sm">
                  {c.checking}
                </p>
              ) : scope.data?.reason && receipt?.outcome !== "accepted" ? (
                <p className="break-words text-sm leading-6">
                  {c.reasons[scope.data.reason]}
                </p>
              ) : null}
              {scope.data?.canReset && (
                <>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border p-3 text-sm leading-6">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-primary"
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                      disabled={phase !== null}
                      aria-describedby={id}
                    />
                    <span className="min-w-0 break-words">{c.acknowledge}</span>
                  </label>
                  <Button
                    className="h-auto min-h-11 whitespace-normal"
                    disabled={
                      !acknowledged ||
                      scope.isFetching ||
                      phase !== null ||
                      storageError
                    }
                    onClick={start}
                    aria-describedby={id}
                  >
                    {c.reset}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
