import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProjectMeetingStartResponse } from "@workspace/api-client-react";
import { meetingText, type MeetingCopy } from "@/lib/meeting-copy";
import { useLocale } from "@/components/i18n/locale-provider";
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
import { setupMessages } from "@/lib/i18n";
import { ControlPlaneError } from "@/lib/auth";
import {
  loadMeetingTurnCopy,
  type MeetingTurnCopy,
} from "@/lib/meeting-turn-copy";
import {
  MEETING_TURN_EVENT,
  readMeetingTurnIntent,
  readMeetingTurnReceipt,
  assertMeetingTurnResult,
  dispatchMeetingTurn,
  acknowledgeMeetingTurn,
  listMeetingTurnRecords,
  clearDamagedMeetingTurn,
  MEETING_TURN_PAGE_SIZE,
  MeetingTurnRecoveryError,
  type MeetingTurnIntent,
} from "@/lib/meeting-turn-recovery";

export function useMeetingTurnPending(
  projectId: number,
  meetingId: number | null,
) {
  const [revision, bump] = useState(0);
  useEffect(() => {
    const refresh = () => bump((v) => v + 1);
    window.addEventListener(MEETING_TURN_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MEETING_TURN_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return useMemo(() => {
    if (meetingId === null) return { intent: null, error: false };
    try {
      return {
        intent: readMeetingTurnIntent(projectId, meetingId),
        error: false,
      };
    } catch {
      return { intent: null, error: true };
    }
  }, [projectId, meetingId, revision]);
}

export function MeetingTurnRecovery({
  projectId,
  meetingCopy,
  onRefresh,
  focusTarget,
}: {
  projectId: number;
  meetingCopy: MeetingCopy;
  onRefresh: (meetingId: number) => void;
  focusTarget: RefObject<HTMLHeadingElement | null>;
}) {
  const [revision, bump] = useState(0);
  const [offset, setOffset] = useState(0);
  const [scanLimit, setScanLimit] = useState(1000);
  useEffect(() => {
    const refresh = () => bump((v) => v + 1);
    window.addEventListener(MEETING_TURN_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MEETING_TURN_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const inventory = useMemo(() => {
    try {
      return {
        data: listMeetingTurnRecords(projectId, { offset, scanLimit }),
        error: false,
      };
    } catch {
      return { data: null, error: true };
    }
  }, [projectId, offset, scanLimit, revision]);
  useEffect(() => {
    if (inventory.data && offset > 0 && offset >= inventory.data.totalKnown)
      setOffset(
        Math.max(
          0,
          Math.floor((inventory.data.totalKnown - 1) / MEETING_TURN_PAGE_SIZE) *
            MEETING_TURN_PAGE_SIZE,
        ),
      );
  }, [inventory.data, offset]);
  const { locale, t } = useLocale();
  const copy = useQuery({
    queryKey: ["meeting-turn-copy", locale],
    queryFn: () => loadMeetingTurnCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (
    inventory.data &&
    inventory.data.totalKnown === 0 &&
    !inventory.data.scanIncomplete
  )
    return null;
  if (!copy.data)
    return (
      <div
        role={copy.isError ? "alert" : "status"}
        className="rounded-xl border border-border p-4 text-sm"
      >
        {copy.isError
          ? setupMessages[locale].languageFileError
          : t("loadingScreen")}
        {copy.isError && (
          <Button
            className="mt-3 min-h-11"
            onClick={() => window.location.reload()}
          >
            {t("checkAgain")}
          </Button>
        )}
      </div>
    );
  const c = copy.data,
    data = inventory.data,
    number = new Intl.NumberFormat(locale);
  const restoreFocus = () =>
    requestAnimationFrame(() => focusTarget.current?.focus());
  return (
    <section
      aria-label={c.inboxTitle}
      className="mb-4 space-y-3 rounded-xl border bg-card p-3 [overflow-wrap:anywhere] sm:p-4"
    >
      <h3 className="font-semibold">{c.inboxTitle}</h3>
      <p className="text-sm leading-6 text-muted-foreground">{c.inboxHelp}</p>
      {inventory.error && (
        <p role="alert" className="text-sm text-destructive">
          {c.storageReadError}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 h-auto whitespace-normal"
        onClick={() => bump((v) => v + 1)}
      >
        {c.refreshInbox}
      </Button>
      {data?.records.map((record) =>
        record.kind === "valid" ? (
          <Recovery
            key={record.key + record.raw}
            intent={record.intent}
            c={c}
            meetingCopy={meetingCopy}
            onRefresh={() => onRefresh(record.intent.meetingId)}
            onCleared={restoreFocus}
          />
        ) : (
          <DamagedRecovery
            key={record.key + record.raw}
            projectId={projectId}
            record={record}
            c={c}
            onCleared={restoreFocus}
          />
        ),
      )}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            {c.pageSummary
              .replace(
                "{from}",
                number.format(data.records.length ? offset + 1 : 0),
              )
              .replace("{to}", number.format(offset + data.records.length))
              .replace("{count}", number.format(data.totalKnown))}
          </p>
          {(offset > 0 || data.hasMore) && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal"
                disabled={offset === 0}
                onClick={() =>
                  setOffset((v) => Math.max(0, v - MEETING_TURN_PAGE_SIZE))
                }
              >
                {c.previous}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal"
                disabled={!data.hasMore}
                onClick={() => setOffset((v) => v + MEETING_TURN_PAGE_SIZE)}
              >
                {c.next}
              </Button>
            </div>
          )}
          {data.scanIncomplete && (
            <div className="space-y-2">
              <p role="status" className="text-sm">
                {c.scanIncomplete}
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal"
                onClick={() => setScanLimit((v) => v + 1000)}
              >
                {c.scanMore}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DamagedRecovery({
  projectId,
  record,
  c,
  onCleared,
}: {
  projectId: number;
  record: { key: string; raw: string };
  c: MeetingTurnCopy;
  onCleared: () => void;
}) {
  const [review, setReview] = useState(false),
    [accepted, setAccepted] = useState(false),
    [failed, setFailed] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  return (
    <section
      className="space-y-3 rounded-xl border border-amber-600/40 p-4 text-sm"
      aria-label={c.damagedTitle}
    >
      <h4 className="font-semibold">{c.damagedTitle}</h4>
      <p>{c.invalid}</p>
      <p className="text-xs text-muted-foreground">
        {c.localKey}: <bdi dir="ltr">{record.key}</bdi>
      </p>
      <Button
        ref={opener}
        type="button"
        variant="outline"
        className="min-h-11 h-auto whitespace-normal"
        onClick={() => {
          setAccepted(false);
          setFailed(false);
          setReview(true);
        }}
      >
        {c.reviewDamaged}
      </Button>
      <AlertDialog open={review} onOpenChange={setReview}>
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
            else onCleared();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{c.reviewDamaged}</AlertDialogTitle>
            <AlertDialogDescription>{c.damagedHelp}</AlertDialogDescription>
          </AlertDialogHeader>
          <pre
            dir="auto"
            className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-xs"
          >
            {record.raw}
          </pre>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
            <input
              className="mt-1 size-5 shrink-0"
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            {c.clearHelp}
          </label>
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {c.changed}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              ref={cancel}
              className="min-h-11 h-auto whitespace-normal"
            >
              {c.cancel}
            </AlertDialogCancel>
            <Button
              type="button"
              className="min-h-11 h-auto whitespace-normal"
              disabled={!accepted}
              onClick={() => {
                try {
                  clearDamagedMeetingTurn(projectId, record.key, record.raw);
                  setReview(false);
                  onCleared();
                } catch {
                  setFailed(true);
                }
              }}
            >
              {c.clearDamaged}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Recovery({
  intent,
  c,
  meetingCopy: m,
  onRefresh,
  onCleared,
}: {
  intent: MeetingTurnIntent;
  c: MeetingTurnCopy;
  meetingCopy: MeetingCopy;
  onRefresh: () => void;
  onCleared: () => void;
}) {
  const { locale } = useLocale();
  const [outcome, setOutcome] = useState<{
    response: ProjectMeetingStartResponse;
    failed: boolean;
  } | null>(null);
  const [state, setState] = useState<
    | "pending"
    | "running"
    | "notRecorded"
    | "recorded"
    | "unconfirmed"
    | "loadError"
  >("pending");
  const [busy, setBusy] = useState(false),
    [review, setReview] = useState(false);
  const gate = useRef(false),
    mounted = useRef(true);
  const cancel = useRef<HTMLButtonElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function check() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const receipt = await readMeetingTurnReceipt(intent);
      if (mounted.current) {
        if (receipt.state === "complete") {
          assertMeetingTurnResult(receipt.response, intent);
          setOutcome({
            response: receipt.response,
            failed: receipt.httpStatus! >= 400,
          });
        }
        setState(receipt.state === "complete" ? "recorded" : receipt.state);
        onRefresh();
      }
    } catch (error) {
      if (mounted.current)
        setState(
          error instanceof ControlPlaneError && error.status === 404
            ? "notRecorded"
            : "loadError",
        );
    } finally {
      gate.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function retry() {
    if (gate.current || state !== "notRecorded") return;
    gate.current = true;
    setBusy(true);
    try {
      const response = await dispatchMeetingTurn(intent);
      if (mounted.current) {
        setOutcome({ response, failed: false });
        setState("recorded");
        onRefresh();
      }
    } catch {
      if (mounted.current) setState("pending");
    } finally {
      gate.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function acknowledge() {
    try {
      if (!acknowledgeMeetingTurn(intent))
        throw new MeetingTurnRecoveryError("pending");
      setReview(false);
      onRefresh();
      onCleared();
    } catch {
      setState("loadError");
      setReview(false);
    }
  }
  return (
    <section
      aria-label={c.title}
      className="space-y-3 rounded-xl border border-amber-600/40 bg-amber-500/5 p-4"
    >
      <h4 className="font-semibold">{c.title}</h4>
      <p className="text-sm">
        {c.meetingId}: <bdi dir="ltr">#{intent.meetingId}</bdi>
      </p>
      <p className="text-sm text-muted-foreground">{c.help}</p>
      <p role="status" className="text-sm">
        {c[state]}
      </p>
      <p className="break-words text-xs text-muted-foreground">
        {c.recordId}:{" "}
        <bdi dir="ltr" className="[overflow-wrap:anywhere]">
          {intent.requestId}
        </bdi>
      </p>
      {intent.input.prompt && (
        <div>
          <p className="text-xs text-muted-foreground">{c.prompt}</p>
          <p
            dir="auto"
            className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]"
          >
            {intent.input.prompt}
          </p>
        </div>
      )}
      <p className="text-sm">
        {c.participants}:{" "}
        <bdi dir="ltr">
          {intent.input.participantAgentIds === undefined
            ? c.defaultParticipants
            : intent.input.participantAgentIds.length
              ? intent.input.participantAgentIds
                  .map((id) => `#${id}`)
                  .join(", ")
              : c.noParticipants}
        </bdi>
      </p>
      <p className="text-sm">
        {c.tokenLimit}:{" "}
        {intent.input.maxTokensPerResponse === undefined
          ? c.defaultLimit
          : new Intl.NumberFormat(locale).format(
              intent.input.maxTokensPerResponse,
            )}
      </p>
      {outcome && (
        <section
          aria-label={m.transcript}
          className="space-y-3 rounded-lg border bg-card p-3 text-sm"
        >
          <h5 className="font-semibold">
            {meetingText(m.contributions, {
              count: new Intl.NumberFormat(locale).format(
                outcome.response.agentTranscriptIds.length,
              ),
            })}
          </h5>
          <p className="text-muted-foreground">{c.outcomeHelp}</p>
          {outcome.failed && <p role="status">{c.recordedFailure}</p>}
          {outcome.response.agentTranscriptIds.length ? (
            <div
              className="max-h-80 overflow-y-auto space-y-3"
              tabIndex={0}
              role="region"
              aria-label={m.transcript}
            >
              {outcome.response.transcript
                .filter((row) =>
                  outcome.response.agentTranscriptIds.includes(row.id),
                )
                .map((row) => (
                  <div key={row.id} className="border-b pb-3 last:border-0">
                    <p dir="auto" className="font-medium">
                      {row.speakerName ?? m.agent}
                    </p>
                    <p
                      dir="auto"
                      className="mt-1 whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]"
                    >
                      {row.content}
                    </p>
                  </div>
                ))}
            </div>
          ) : (
            <p>{m.noContribution}</p>
          )}
          {outcome.response.skippedParticipants.length > 0 && (
            <div>
              <h6 className="font-medium">{c.skipped}</h6>
              <ul className="mt-2 space-y-2">
                {outcome.response.skippedParticipants.map((row, index) => (
                  <li key={`${row.agentId}:${index}`}>
                    <bdi dir="ltr">#{row.agentId}</bdi>
                    {": "}
                    {c[`skip_${row.reason}`]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground">{m.recordsHelp}</p>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void check()}
        >
          {busy ? c.checking : c.check}
        </Button>
        {state === "notRecorded" && (
          <Button
            className="h-auto min-h-11 whitespace-normal"
            disabled={busy}
            onClick={() => void retry()}
          >
            {c.retry}
          </Button>
        )}
        {(state === "recorded" ||
          state === "unconfirmed" ||
          state === "notRecorded") && (
          <Button
            ref={opener}
            variant="outline"
            className="h-auto min-h-11 whitespace-normal"
            disabled={busy}
            onClick={() => setReview(true)}
          >
            {c.review}
          </Button>
        )}
      </div>
      <AlertDialog open={review} onOpenChange={setReview}>
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
            else onCleared();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{c.review}</AlertDialogTitle>
            <AlertDialogDescription>{c.reviewHelp}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              ref={cancel}
              className="min-h-11 h-auto whitespace-normal"
            >
              {c.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 h-auto whitespace-normal"
              onClick={acknowledge}
            >
              {c.continue}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
