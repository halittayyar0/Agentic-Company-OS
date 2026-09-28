import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import {
  Activity,
  Fingerprint,
  GitBranch,
  RadioTower,
  ShieldQuestion,
} from "lucide-react";

import type { AttemptEvidenceChain } from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";

function EvidenceId({ children }: { children: string }) {
  return (
    <bdi
      dir="ltr"
      className="block break-all font-mono text-[12px] leading-5 text-foreground/85"
    >
      {children}
    </bdi>
  );
}

export function OperationEvidenceInspector({
  chain,
  className,
  id = "operation-evidence-inspector",
}: {
  chain: AttemptEvidenceChain | null;
  className?: string;
  id?: string;
}) {
  const { copy: c, t, number, time, state: stateLabel } = useOperationsCopy();

  return (
    <aside
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("border border-border/75 bg-card", className)}
    >
      <header className="border-b border-border/75 px-5 py-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("chainEyebrow")}
        </p>
        <h2
          id={`${id}-title`}
          className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
        >
          {t("chainTitle")}
        </h2>
      </header>

      {!chain ? (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
          {t("chainEmpty")}
        </div>
      ) : (
        <div className="px-4 py-5 sm:px-5">
          <ol className="relative space-y-5 border-s border-border/80 ps-5">
            <li className="relative">
              <span className="absolute -start-[29px] top-0 grid size-4 place-items-center bg-card text-primary">
                <GitBranch size={13} aria-hidden />
              </span>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("logicalExecution")}
              </p>
              <EvidenceId>{chain.logicalExecutionId}</EvidenceId>
            </li>

            <li className="relative">
              <span className="absolute -start-[29px] top-0 grid size-4 place-items-center bg-card text-primary">
                <Activity size={13} aria-hidden />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t("durableAttempt")}
                </p>
                <span className="border border-border px-2 py-0.5 text-[12px] font-semibold">
                  {stateLabel(chain.attempt.state)}
                </span>
              </div>
              <EvidenceId>{chain.attempt.id}</EvidenceId>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {t("worker", { id: chain.attempt.workerInstanceId })} ·{" "}
                {t("cycleAttempt", {
                  cycle: number.format(chain.attempt.cycleNumber),
                  attempt: number.format(chain.attempt.attemptNumber),
                })}
              </p>
              <time
                dateTime={chain.attempt.startedAt}
                className="text-[12px] text-muted-foreground"
              >
                {time(chain.attempt.startedAt)}
              </time>
            </li>

            {chain.receipts.flatMap(({ receipt, invocations }) => [
              ...invocations.map((invocation) => (
                <li key={invocation.id} className="relative">
                  <span className="absolute -start-[29px] top-0 grid size-4 place-items-center bg-card text-primary">
                    <RadioTower size={13} aria-hidden />
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {t("physicalInvocation")}
                    </p>
                    <span className="border border-border px-2 py-0.5 text-[12px] font-semibold">
                      {stateLabel(invocation.state)}
                    </span>
                  </div>
                  <EvidenceId>{invocation.id}</EvidenceId>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    {t("worker", {
                      id: invocation.workerInstanceId ?? c.state_unknown,
                    })}
                  </p>
                  {invocation.effectStartedAt ? (
                    <p className="mt-1 text-[12px] font-semibold text-attention-foreground">
                      {t("boundaryStarted", {
                        time: time(invocation.effectStartedAt),
                      })}
                    </p>
                  ) : (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {t("boundaryMissing")}
                    </p>
                  )}
                </li>
              )),
              <li key={receipt.id} className="relative">
                <span className="absolute -start-[29px] top-0 grid size-4 place-items-center bg-card text-primary">
                  {receipt.state === "unknown" ? (
                    <ShieldQuestion size={13} aria-hidden />
                  ) : (
                    <Fingerprint size={13} aria-hidden />
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t("effectReceipt")}
                  </p>
                  <span className="border border-border px-2 py-0.5 text-[12px] font-semibold">
                    {stateLabel(receipt.state)}
                  </span>
                </div>
                <EvidenceId>{receipt.id}</EvidenceId>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {receipt.toolName} · {stateLabel(receipt.executionKind)} ·{" "}
                  {stateLabel(receipt.sideEffectClass)}
                </p>
                {receipt.reconciliation.decision ? (
                  <p className="mt-1 text-[12px] font-semibold text-verified-foreground">
                    {receipt.reconciliation.decision === "confirmed_applied"
                      ? t("appliedRecord")
                      : t("notAppliedRecord")}
                  </p>
                ) : null}
              </li>,
            ])}
          </ol>

          {chain.receipts.length === 0 ? (
            <p className="border border-border/75 bg-background/45 p-3 text-[12px] leading-5 text-muted-foreground">
              {t("noLinkedEvidence")}
            </p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
