import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import {
  BadgeCheck,
  CircleAlert,
  Fingerprint,
  ShieldQuestion,
} from "lucide-react";

import type { OperationsReceiptInput } from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";

const RECEIPT_META: Record<string, { className: string }> = {
  reserved: {
    className: "border-sky-600/25 text-sky-700 dark:text-sky-300",
  },
  running: {
    className: "border-amber-600/25 text-amber-700 dark:text-amber-300",
  },
  succeeded: {
    className: "border-emerald-600/25 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    className: "border-rose-600/25 text-rose-700 dark:text-rose-300",
  },
  unknown: {
    className: "border-rose-600/25 text-rose-700 dark:text-rose-300",
  },
};

export function ReceiptLedger({
  receipts,
  onReconcileReceipt,
  className,
}: {
  receipts: OperationsReceiptInput[];
  onReconcileReceipt?: (receiptId: string) => void;
  className?: string;
}) {
  const { t, number, state: stateLabel } = useOperationsCopy();

  return (
    <section
      aria-labelledby="receipt-ledger-title"
      className={cn("border border-border/75 bg-card", className)}
    >
      <header className="border-b border-border/75 px-5 py-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("receiptEyebrow")}
        </p>
        <h2
          id="receipt-ledger-title"
          className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
        >
          {t("receiptTitle")}
        </h2>
      </header>

      {receipts.length ? (
        <ol className="divide-y divide-border/75">
          {receipts.map((receipt) => {
            const state = RECEIPT_META[receipt.state] ?? {
              className: "border-border text-muted-foreground",
            };
            const unresolvedUnknown =
              receipt.state === "unknown" &&
              receipt.reconciliation.decision === null;
            return (
              <li key={receipt.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "border bg-background/55 px-2 py-1 text-[12px] font-bold uppercase tracking-[0.08em]",
                      state.className,
                    )}
                  >
                    {stateLabel(receipt.state)}
                  </span>
                  <span className="text-[12px] font-semibold">
                    {receipt.toolName}
                  </span>
                  <span className="ms-auto font-mono text-[12px] text-muted-foreground">
                    {stateLabel(receipt.sideEffectClass)}
                  </span>
                </div>

                <p className="mt-3 break-all font-mono text-[12px] leading-4 text-muted-foreground">
                  {receipt.id}
                </p>

                {unresolvedUnknown ? (
                  <div className="mt-3 border border-rose-600/20 bg-rose-600/[0.06] p-3 text-[12px] leading-5 text-rose-800 dark:text-rose-200">
                    <p className="flex items-center gap-1.5 font-bold">
                      <ShieldQuestion size={12} aria-hidden />
                      {t("noReplay")}
                    </p>
                    <p className="mt-1">{t("unknownHelp")}</p>
                    {receipt.reconciliation.eligible ? (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{t("eligible")}</p>
                        {onReconcileReceipt ? (
                          <button
                            type="button"
                            onClick={() => onReconcileReceipt(receipt.id)}
                            className="inline-flex min-h-11 cursor-pointer items-center border border-rose-600/30 bg-background/55 px-3 text-[12px] font-semibold text-rose-800 transition-colors hover:border-rose-600/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-rose-200"
                          >
                            {t("reconcile")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : receipt.reconciliation.decision ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <BadgeCheck size={12} aria-hidden />
                    {receipt.reconciliation.decision === "confirmed_applied"
                      ? t("appliedRecord")
                      : t("notAppliedRecord")}
                  </p>
                ) : null}

                {receipt.invocations.length ? (
                  <details className="mt-3 text-[12px] text-muted-foreground">
                    <summary className="min-h-11 py-3 cursor-pointer select-none font-semibold text-foreground">
                      {t("invocationCount", {
                        count: number.format(receipt.invocations.length),
                      })}
                    </summary>
                    <ul className="mt-2 space-y-1.5 border-s border-border ps-3 font-mono text-[12px]">
                      {receipt.invocations.map((invocation) => (
                        <li key={invocation.id} className="min-w-0">
                          <span className="inline-flex items-center gap-1.5">
                            {invocation.state === "unknown" ? (
                              <CircleAlert size={10} aria-hidden />
                            ) : (
                              <Fingerprint size={10} aria-hidden />
                            )}
                            <span className="break-all">{invocation.id}</span>
                          </span>
                          <span className="ms-2">
                            {stateLabel(invocation.state)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
          {t("receiptEmpty")}
        </div>
      )}
    </section>
  );
}
