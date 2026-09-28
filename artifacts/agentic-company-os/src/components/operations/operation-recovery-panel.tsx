import { useEffect, useRef, useState } from "react";
import {
  acknowledgeOperationIntent,
  clearDamagedOperationIntent,
  OPERATION_RECOVERY_EVENT,
  readOperationIntent,
  readOperationIntentRaw,
  type OperationIntent,
} from "../../lib/operation-recovery";
import { Button } from "../ui/button";
import { useOperationsCopy } from "./operations-copy-context";
import { ReceiptReconciliationDialog } from "./receipt-reconciliation-dialog";

type LocalRecovery =
  | { kind: "ready"; intent: OperationIntent; raw: string }
  | { kind: "damaged"; raw: string }
  | { kind: "unavailable" }
  | null;
export function OperationRecoveryPanel({ projectId }: { projectId: number }) {
  const { copy: c, t } = useOperationsCopy();
  const [record, setRecord] = useState<LocalRecovery>(null);
  const [selected, setSelected] = useState<OperationIntent | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = () => {
    try {
      const raw = readOperationIntentRaw(projectId);
      if (raw === null) setRecord(null);
      else {
        try {
          const intent = readOperationIntent(projectId);
          setRecord(intent ? { kind: "ready", raw, intent } : null);
        } catch {
          setRecord({ kind: "damaged", raw });
        }
      }
    } catch {
      setRecord({ kind: "unavailable" });
    }
  };
  useEffect(() => {
    refresh();
    const listener = () => {
      setAccepted(false);
      refresh();
    };
    window.addEventListener(OPERATION_RECOVERY_EVENT, listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener(OPERATION_RECOVERY_EVENT, listener);
      window.removeEventListener("storage", listener);
    };
  }, [projectId]);
  return (
    <div className={record ? "px-3 pt-3 sm:px-5" : ""}>
      {record && (
        <section
          className="mx-auto max-w-[1720px] space-y-3 border border-attention/30 bg-card p-4 [overflow-wrap:anywhere]"
          aria-label={c.recoveryTitle}
        >
          <h2 ref={heading} tabIndex={-1} className="text-base font-semibold">
            {c.recoveryTitle}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {c.recoveryHelp}
          </p>
          {record.kind === "unavailable" ? (
            <>
              <p role="alert" className="text-sm">
                {c.recoveryStorage}
              </p>
              <Button type="button" variant="outline" onClick={refresh}>
                {c.retry}
              </Button>
            </>
          ) : (
            <>
              {record.kind === "ready" ? (
                <>
                  <p className="text-sm">
                    <strong>{c.receipt}: </strong>
                    <bdi>{record.intent.receiptId}</bdi>
                  </p>
                  <Button
                    ref={opener}
                    type="button"
                    variant="outline"
                    className="min-h-11 h-auto whitespace-normal"
                    onClick={() => setSelected(record.intent)}
                  >
                    {c.reviewSaved}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm">{c.recoveryDamaged}</p>
                  <pre
                    dir="auto"
                    className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs"
                  >
                    {record.raw}
                  </pre>
                </>
              )}
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-3 font-medium">
                  {c.clearRecovery}
                </summary>
                <label className="flex min-h-11 items-start gap-3 py-2 leading-6">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  {c.clearRecoveryHelp}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 h-auto whitespace-normal"
                  disabled={!accepted}
                  onClick={() => {
                    try {
                      if (record.kind === "damaged")
                        clearDamagedOperationIntent(projectId, record.raw);
                      else if (!acknowledgeOperationIntent(record.intent))
                        throw Error();
                      setError(false);
                      setAccepted(false);
                      refresh();
                      document
                        .getElementById("operation-recovery-focus")
                        ?.focus();
                    } catch {
                      setError(true);
                      refresh();
                    }
                  }}
                >
                  {c.clearRecovery}
                </Button>
              </details>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {c.recoveryChanged}
            </p>
          )}
        </section>
      )}
      <span id="operation-recovery-focus" tabIndex={-1} className="sr-only">
        {t("projectId", { id: projectId })}
      </span>
      <ReceiptReconciliationDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        project={{ id: projectId, title: t("projectId", { id: projectId }) }}
        receipt={null}
        chain={null}
        recoveryReceiptId={selected?.receiptId}
        onRestoreFocus={() =>
          (opener.current?.isConnected
            ? opener.current
            : (heading.current ??
              document.getElementById("operation-recovery-focus"))
          )?.focus()
        }
      />
    </div>
  );
}
