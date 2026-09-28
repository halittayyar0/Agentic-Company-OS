import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMeetingCommandResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ControlPlaneError } from "@/lib/auth";
import { type MeetingCopy, meetingText } from "@/lib/meeting-copy";
import {
  type MeetingCommandIntent,
  MEETING_COMMAND_EVENT,
  readMeetingCommand,
  readMeetingCommandRaw,
  readMeetingCommandReceipt,
  dispatchMeetingCommand,
  clearDamagedMeetingCommand,
  MeetingCommandRecoveryError,
} from "@/lib/meeting-command-recovery";

function previewInput(
  kind: MeetingCommandIntent["kind"],
  input: Record<string, unknown>,
  c: MeetingCopy,
): string {
  const labels: Record<string, string> = {
    title:
      kind === "create" || kind === "update" ? c.titleLabel : c.actionLabel,
    agenda: c.agendaLabel,
    summary: c.summary,
    content: kind === "transcript" ? c.messageLabel : c.decisionLabel,
    details: c.commandDetails,
    rationale: c.commandReason,
    participantAgentIds: c.participants,
    ownerAgentId: meetingText(c.ownerLabel, {
      label: kind === "decision" ? c.decisionLabel : c.actionLabel,
    }),
    dueAt: c.commandDue,
    scheduledFor: c.commandScheduled,
    occurredAt: c.commandRecordedAt,
    replyToTranscriptId: c.commandReplyTo,
    decisions: c.decisions,
    actionItems: c.actions,
  };
  return Object.entries(input)
    .map(([key, value]) => {
      if (key === "status")
        return kind === "action-update"
          ? c[`action_${value}` as keyof MeetingCopy]
          : c[value as keyof MeetingCopy];
      if (key === "speakerType") return c.founder;
      let text: string;
      if (Array.isArray(value))
        text = value.length
          ? value
              .map((entry, i) =>
                typeof entry === "number"
                  ? `#${entry}`
                  : `${i + 1}. ${previewInput(key === "decisions" ? "decision" : "action", entry as Record<string, unknown>, c)}`,
              )
              .join("\n")
          : key === "participantAgentIds"
            ? c.noParticipants
            : key === "decisions"
              ? c.emptyDecisions
              : c.emptyActions;
      else
        text =
          value === null
            ? key === "ownerAgentId"
              ? c.noneOwner
              : "—"
            : typeof value === "number"
              ? `#${value}`
              : String(value);
      return `${labels[key]}\n${text}`;
    })
    .join("\n\n");
}

export function useMeetingCommandPending(projectId: number) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((v) => v + 1);
    window.addEventListener(MEETING_COMMAND_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(MEETING_COMMAND_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return useMemo(() => {
    try {
      return { intent: readMeetingCommand(projectId), error: null, raw: null };
    } catch (error) {
      let raw: string | null = null;
      try {
        raw = readMeetingCommandRaw(projectId);
      } catch {
        /* unavailable storage */
      }
      return {
        intent: null,
        error:
          error instanceof MeetingCommandRecoveryError ? error.code : "storage",
        raw,
      };
    }
  }, [projectId, revision]);
}
export function MeetingCommandRecovery({
  projectId,
  c,
  pending,
  onReviewed,
  focusTarget,
}: {
  projectId: number;
  c: MeetingCopy;
  pending: ReturnType<typeof useMeetingCommandPending>;
  onReviewed: (
    intent: MeetingCommandIntent,
    result: ProjectMeetingCommandResult,
  ) => Promise<void>;
  focusTarget: React.RefObject<HTMLHeadingElement | null>;
}) {
  const intent = pending.intent;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<"missing" | "error" | null>(null),
    [result, setResult] = useState<ProjectMeetingCommandResult | null>(null),
    [review, setReview] = useState(false);
  const mounted = useRef(true),
    reviewTrigger = useRef<HTMLButtonElement>(null);
  const identity = useRef(intent?.requestId);
  identity.current = intent?.requestId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setMessage(null);
    setResult(null);
    setReview(false);
  }, [intent?.requestId, pending.raw]);
  const current = (key: string) => mounted.current && identity.current === key;
  async function check(retry = false) {
    if (!intent || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const found = retry
        ? await dispatchMeetingCommand(intent)
        : (await readMeetingCommandReceipt(intent)).response;
      if (current(intent.requestId)) setResult(found);
    } catch (error) {
      if (current(intent.requestId))
        setMessage(
          !retry && error instanceof ControlPlaneError && error.status === 404
            ? "missing"
            : "error",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (!intent && !pending.error) return null;
  const damaged = pending.error === "invalid" && pending.raw !== null;
  return (
    <aside
      className="my-3 space-y-3 rounded-xl border border-amber-600/40 bg-card p-4 text-sm"
      aria-label={c.commandPending}
    >
      <p role="status">
        {pending.error
          ? damaged
            ? c.commandDamaged
            : c.commandStorage
          : result
            ? result.ok
              ? c.commandSaved
              : c.commandRejected
            : c.commandHelp}
      </p>
      {intent && (
        <>
          <p className="font-semibold">
            {
              c[
                `command_${intent.kind.replaceAll("-", "_")}` as keyof MeetingCopy
              ]
            }
          </p>
          <p>
            {meetingText(c.commandScope, {
              project: String(projectId),
              meeting:
                intent.meetingId === null
                  ? c.commandNew
                  : String(intent.meetingId),
            })}
          </p>
          <p>
            {c.commandIdentity}:{" "}
            <bdi dir="ltr" className="break-all font-mono text-xs">
              {intent.requestId}
            </bdi>
          </p>
        </>
      )}
      {message && (
        <p role="alert">
          {message === "missing" ? c.commandMissing : c.commandError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {intent && !result && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void check()}
          >
            {c.commandCheck}
          </Button>
        )}
        {pending.error === "storage" && (
          <Button
            variant="outline"
            onClick={() =>
              window.dispatchEvent(new Event(MEETING_COMMAND_EVENT))
            }
          >
            {c.retry}
          </Button>
        )}
        {intent && message === "missing" && !result && (
          <Button disabled={busy} onClick={() => void check(true)}>
            {c.commandRetry}
          </Button>
        )}
        {(result || damaged) && (
          <Button
            ref={reviewTrigger}
            variant="outline"
            disabled={busy}
            onClick={() => setReview(true)}
          >
            {c.commandReview}
          </Button>
        )}
      </div>
      <AlertDialog open={review} onOpenChange={setReview}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (reviewTrigger.current ?? focusTarget.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{c.commandReview}</AlertDialogTitle>
            <AlertDialogDescription>
              {damaged
                ? c.commandClearHelp
                : result?.ok
                  ? c.commandSaved
                  : c.commandRejected}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="min-w-0 text-sm">
            {c.commandSource}
            <textarea
              readOnly
              dir="auto"
              className="mt-2 min-h-32 w-full resize-y rounded-lg border bg-background p-3 font-mono text-xs"
              value={
                damaged
                  ? pending.raw!
                  : intent
                    ? previewInput(intent.kind, intent.input, c)
                    : ""
              }
            />
          </label>
          {message === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {c.commandError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              className="min-h-11 whitespace-normal"
              disabled={busy}
            >
              {c.commandKeep}
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 whitespace-normal"
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  if (damaged)
                    clearDamagedMeetingCommand(projectId, pending.raw!);
                  else if (intent && result) await onReviewed(intent, result);
                  setReview(false);
                  focusTarget.current?.focus();
                } catch {
                  setMessage("error");
                } finally {
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              {damaged ? c.commandClear : c.commandConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
