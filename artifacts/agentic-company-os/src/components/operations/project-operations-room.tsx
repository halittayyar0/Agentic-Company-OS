import { useOperationsCopy } from "./operations-copy-context";
import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowLeft,
  CircleAlert,
  Eye,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "wouter";

import { useMediaQuery } from "../../hooks/use-page-activity";
import {
  buildAttemptEvidenceChain,
  type OperationsReceiptInput,
  type AttemptEvidenceChain,
  type OperationsRoomModel,
} from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { AttemptLedger } from "./attempt-ledger";
import { MissionLog } from "./mission-log";
import { OperationEvidenceInspector } from "./operation-evidence-inspector";
import { OperationsDataBoundary } from "./operations-data-boundary";
import { OperationsSummaryStrip } from "./operations-summary-strip";
import { ReceiptReconciliationDialog } from "./receipt-reconciliation-dialog";
import { ReceiptLedger } from "./receipt-ledger";
import { RuntimeTruthBadge } from "./runtime-truth-badge";
import { TeamConstellation } from "./team-constellation";
import { TwentyFourHourRing } from "./twenty-four-hour-ring";

interface SelectedWindow {
  from: string;
  to: string;
}

export function ProjectOperationsRoom({
  project,
  model,
  now,
  refreshing = false,
  refreshFailed = false,
  onRefresh,
}: {
  project: { id: number; title: string; status: string };
  model: OperationsRoomModel;
  now: Date;
  refreshing?: boolean;
  refreshFailed?: boolean;
  onRefresh?: () => void;
}) {
  const { copy: c, t, time, state: stateLabel, locale } = useOperationsCopy();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocus = (element: HTMLElement | null) =>
    (element?.isConnected ? element : headingRef.current)?.focus();
  const inspectorOpener = useRef<HTMLElement | null>(null);
  const reconciliationOpener = useRef<HTMLElement | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<SelectedWindow | null>(
    null,
  );
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    model.attempts[0]?.id ?? null,
  );
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [reconciliationSelection, setReconciliationSelection] = useState<{
    receipt: OperationsReceiptInput;
    chain: AttemptEvidenceChain | null;
  } | null>(null);
  const mobileInspector = useMediaQuery("(max-width: 1023px)");
  const members = useMemo(
    () => model.lanes.flatMap((lane) => lane.members),
    [model.lanes],
  );
  const filteredAttempts = useMemo(() => {
    if (!selectedWindow) return model.attempts;
    const from = new Date(selectedWindow.from).getTime();
    const to = new Date(selectedWindow.to).getTime();
    return model.attempts.filter((attempt) => {
      const startedAt = new Date(attempt.startedAt).getTime();
      return startedAt >= from && startedAt < to;
    });
  }, [model.attempts, selectedWindow]);
  const visibleAttemptIds = useMemo(
    () => new Set(filteredAttempts.map((attempt) => attempt.id)),
    [filteredAttempts],
  );
  const filteredReceipts = selectedWindow
    ? model.receipts.filter(
        (receipt) =>
          receipt.originAttemptId === null ||
          visibleAttemptIds.has(receipt.originAttemptId),
      )
    : model.receipts;
  const effectiveSelectedAttemptId = filteredAttempts.some(
    (attempt) => attempt.id === selectedAttemptId,
  )
    ? selectedAttemptId
    : (filteredAttempts[0]?.id ?? null);
  const selectedAttempt =
    filteredAttempts.find(
      (attempt) => attempt.id === effectiveSelectedAttemptId,
    ) ?? null;
  const evidenceChain = useMemo(
    () =>
      selectedAttempt
        ? buildAttemptEvidenceChain(selectedAttempt, model.receipts)
        : null,
    [model.receipts, selectedAttempt],
  );
  const currentReconciliationReceipt = model.receipts.find(
    (receipt) => receipt.id === reconciliationSelection?.receipt.id,
  );
  const reconciliationReceipt =
    currentReconciliationReceipt ?? reconciliationSelection?.receipt ?? null;
  const reconciliationAttempt = reconciliationReceipt?.originAttemptId
    ? (model.attempts.find(
        (attempt) => attempt.id === reconciliationReceipt.originAttemptId,
      ) ?? null)
    : null;
  const reconciliationChain = useMemo(
    () =>
      reconciliationAttempt
        ? buildAttemptEvidenceChain(reconciliationAttempt, model.receipts)
        : (reconciliationSelection?.chain ?? null),
    [model.receipts, reconciliationAttempt, reconciliationSelection],
  );

  useEffect(() => {
    if (!mobileInspector) setMobileInspectorOpen(false);
  }, [mobileInspector]);

  const selectAttempt = (attemptId: string) => {
    inspectorOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSelectedAttemptId(attemptId);
    if (mobileInspector) setMobileInspectorOpen(true);
  };

  return (
    <div className="operations-room [overflow-wrap:anywhere] min-h-full bg-background px-3 py-3 sm:px-5 sm:py-5">
      <div className="mx-auto max-w-[1720px]">
        <header className="relative overflow-hidden border border-border/75 bg-card">
          <div
            aria-hidden
            className="absolute inset-y-0 start-0 w-1 bg-primary"
          />
          <div className="flex min-h-12 flex-wrap items-center gap-3 border-b border-border/75 px-4 py-2 sm:px-6">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={12} aria-hidden />
              {t("studio")}
            </Link>
            <span className="hidden text-border sm:inline" aria-hidden>
              /
            </span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {t("projectId", { id: project.id })}
            </span>
            <span className="ms-auto font-mono text-[12px] text-muted-foreground">
              {t("cursor", { id: model.cursor })}
            </span>
            {onRefresh ? (
              <button
                type="button"
                onClick={() => !refreshing && onRefresh()}
                aria-disabled={refreshing}
                aria-busy={refreshing}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border bg-background/50 px-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-wait md:min-h-11"
              >
                <RefreshCw
                  size={12}
                  className={cn(
                    refreshing && "animate-spin motion-reduce:animate-none",
                  )}
                  aria-hidden
                />
                {t("refresh")}
              </button>
            ) : null}
          </div>

          <div className="grid gap-7 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
                  <Eye size={12} aria-hidden />
                  {t("projectTitle")}
                </span>
                <span className="border border-border bg-secondary/65 px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">
                  {stateLabel(project.status)}
                </span>
              </div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-3 max-w-4xl font-serif text-3xl font-medium tracking-[-0.05em] sm:text-5xl"
              >
                {project.title}
              </h1>
              <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">
                {t("projectHelp")}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 lg:items-end">
              <RuntimeTruthBadge
                truth={model.truth}
                snapshotStale={refreshFailed}
              />
              <span className="text-[12px] text-muted-foreground">
                {t("snapshot", { time: time(model.generatedAt) })}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/75 bg-background/35 px-5 py-3 text-[12px] text-muted-foreground sm:px-7">
            <Sparkles size={12} className="text-primary" aria-hidden />
            <strong className="text-foreground">
              {model.healthRing.complete
                ? t("coverageComplete")
                : t("coverageGathering")}
            </strong>
            <span>{t("coverageHelp")}</span>
          </div>
          {refreshFailed ? (
            <p
              className="flex items-start gap-2 border-t border-amber-600/20 bg-amber-600/[0.06] px-5 py-3 text-[12px] leading-4 text-amber-800 dark:text-amber-200 sm:px-7"
              role="status"
            >
              <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>{c.stale}</span>
            </p>
          ) : null}
        </header>

        <p className="my-3 text-xs text-muted-foreground">{c.sourceHelp}</p>
        <OperationsSummaryStrip model={model} now={now} />

        {model.limits ? (
          <OperationsDataBoundary
            window={model.window}
            limits={model.limits}
            truncation={model.truncation}
          />
        ) : null}

        {selectedWindow ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border border-primary/20 bg-primary/[0.05] px-4 py-3 text-[12px]">
            <span className="font-semibold text-primary">{t("filter")}</span>
            <span className="text-muted-foreground">
              {time(selectedWindow.from)} — {time(selectedWindow.to)}
            </span>
            <p className="w-full text-muted-foreground">{c.filterHelp}</p>
            <button
              type="button"
              onClick={() => setSelectedWindow(null)}
              className="ms-auto inline-flex min-h-11 items-center gap-1 font-semibold text-muted-foreground hover:text-foreground"
            >
              <X size={11} aria-hidden />
              {t("clearFilter")}
            </button>
          </div>
        ) : null}

        <TeamConstellation lanes={model.lanes} className="mt-4" />

        <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <TwentyFourHourRing
            ring={model.healthRing}
            onSelectWindow={setSelectedWindow}
          />
          <MissionLog missions={model.missions} />
        </div>

        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <AttemptLedger
            attempts={filteredAttempts}
            members={members}
            selectedAttemptId={effectiveSelectedAttemptId}
            onSelectAttempt={selectAttempt}
            inspectorId={
              mobileInspector
                ? "operation-evidence-inspector-mobile"
                : "operation-evidence-inspector"
            }
          />
          <OperationEvidenceInspector
            chain={evidenceChain}
            className="hidden lg:block"
          />
        </div>

        <ReceiptLedger
          receipts={filteredReceipts}
          onReconcileReceipt={(id) => {
            reconciliationOpener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            const receipt = model.receipts.find((row) => row.id === id);
            if (!receipt) return;
            const attempt = model.attempts.find(
              (row) => row.id === receipt.originAttemptId,
            );
            setReconciliationSelection({
              receipt,
              chain: attempt
                ? buildAttemptEvidenceChain(attempt, model.receipts)
                : null,
            });
          }}
          className="mt-4"
        />
      </div>

      <Sheet
        open={mobileInspector && mobileInspectorOpen}
        onOpenChange={setMobileInspectorOpen}
      >
        <SheetContent
          side={locale === "ar" ? "left" : "right"}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(inspectorOpener.current);
          }}
          className="flex h-dvh w-[min(94vw,34rem)] max-w-none flex-col gap-0 overflow-hidden border-border bg-background p-0 motion-reduce:duration-100"
        >
          <SheetHeader className="border-b border-border bg-card px-5 py-4 pe-14 text-start">
            <SheetTitle>{t("attemptEvidence")}</SheetTitle>
            <SheetDescription>{t("chainHelp")}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <OperationEvidenceInspector
              id="operation-evidence-inspector-mobile"
              chain={evidenceChain}
            />
          </div>
        </SheetContent>
      </Sheet>

      <ReceiptReconciliationDialog
        open={reconciliationReceipt !== null}
        onOpenChange={(open) => {
          if (!open) setReconciliationSelection(null);
        }}
        project={project}
        refreshFailed={refreshFailed}
        receiptMissing={
          reconciliationSelection !== null && !currentReconciliationReceipt
        }
        onRestoreFocus={() => restoreFocus(reconciliationOpener.current)}
        receipt={reconciliationReceipt}
        chain={reconciliationChain}
      />
    </div>
  );
}
