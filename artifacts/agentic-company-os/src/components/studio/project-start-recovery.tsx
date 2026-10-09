import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { NewProjectCopy } from "@/lib/new-project-copy";
import { useProjectStart } from "@/hooks/use-project-start";
import type { ProjectDraft } from "@/lib/project-start-request";
export type ProjectStartHandle = { start: (draft: ProjectDraft) => void };
export type ProjectStartState = {
  ready: boolean;
  pending: boolean;
  busy: "sending" | "checking" | null;
};
const ProjectStartRecovery = forwardRef<
  ProjectStartHandle,
  {
    copy: NewProjectCopy;
    onOpen: (id: number, submitted: ProjectDraft | null) => void;
    onStateChange: (state: ProjectStartState) => void;
    onPrepared: () => void;
  }
>(function ProjectStartRecovery(
  { copy, onOpen, onStateChange, onPrepared },
  ref,
) {
  const recovery = useProjectStart(onOpen);
  useImperativeHandle(ref, () => ({ start: recovery.start }));
  useEffect(() => {
    onStateChange({
      ready: true,
      pending: !!recovery.request,
      busy: recovery.busy,
    });
  }, [recovery.request?.requestId, recovery.busy, onStateChange]);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (recovery.request && !recovery.busy) panelRef.current?.focus();
  }, [
    recovery.request?.requestId,
    recovery.busy,
    recovery.receipt?.state,
    recovery.outcome,
  ]);
  return (
    <>
      {recovery.storageError ? (
        <p
          role="alert"
          className="mt-4 break-words rounded-panel border border-attention/25 bg-attention/5 p-4 text-sm leading-6"
        >
          {copy.recovery.storageError}
        </p>
      ) : null}
      {recovery.request ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="region"
          aria-labelledby="project-start-recovery-title"
          aria-busy={!!recovery.busy}
          className="mt-4 rounded-panel border border-border bg-card p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <h2
            id="project-start-recovery-title"
            className="text-base font-semibold"
          >
            {copy.recovery.title}
          </h2>
          <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
            {copy.recovery.stored}:{" "}
            <span dir="auto" className="font-medium text-foreground">
              {recovery.request.input.title}
            </span>
          </p>
          <p role="status" className="mt-2 break-words text-sm leading-6">
            {recovery.busy === "checking"
              ? copy.recovery.checking
              : recovery.busy === "sending"
                ? copy.starting
                : recovery.receipt?.state === "created"
                  ? copy.recovery.created
                  : recovery.receipt?.state === "rejected"
                    ? copy.recovery.rejected
                    : recovery.outcome === "missing"
                      ? copy.recovery.missing
                      : copy.recovery.uncertain}
          </p>
          {recovery.receipt?.failureCode ? (
            <p className="mt-2 text-sm leading-6">
              {
                copy.recovery.reasons[
                  recovery.receipt
                    .failureCode as keyof typeof copy.recovery.reasons
                ]
              }
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            {recovery.receipt?.state === "created" ? (
              <Button
                type="button"
                className="min-h-11 h-auto whitespace-normal"
                disabled={!!recovery.busy}
                onClick={recovery.open}
              >
                {copy.recovery.open}
              </Button>
            ) : null}
            {recovery.receipt?.state === "rejected" ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal"
                disabled={!!recovery.busy}
                onClick={() => {
                  recovery.prepare();
                  onPrepared();
                }}
              >
                {copy.recovery.prepare}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="min-h-11 h-auto whitespace-normal"
              disabled={!!recovery.busy}
              onClick={() => void recovery.check()}
            >
              {copy.recovery.check}
            </Button>
            {recovery.outcome === "missing" && !recovery.receipt ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal"
                disabled={!!recovery.busy}
                onClick={recovery.retry}
              >
                {copy.recovery.retry}
              </Button>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {copy.recovery.noTokens}
          </p>
        </div>
      ) : null}
    </>
  );
});
export default ProjectStartRecovery;
