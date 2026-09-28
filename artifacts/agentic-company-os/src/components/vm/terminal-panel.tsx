import { useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { useQueryClient } from "@tanstack/react-query";
import {
  execVmCommand,
  type OperatorRequestReceipt,
  getGetVmStatusQueryKey,
  getListActivityQueryKey,
  useGetVmStatus,
} from "@workspace/api-client-react";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { ComputerCopyBoundary } from "@/components/computer/computer-copy-boundary";
import { OperatorRecovery } from "@/components/computer/operator-recovery";
import { readOperatorResponse } from "@/lib/operator-request";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ValidatedForm } from "@/components/ui/validated-form";
import type { ComputerCopy } from "@/lib/computer-copy";
import type { Locale } from "@/lib/i18n";
import {
  emptyTerminalSession,
  readTerminalSession,
  writeTerminalSession,
  sameTerminalRecord,
  TERMINAL_COMMAND_LIMIT,
  type TerminalMode,
  type TerminalSession,
  type TerminalRecord,
} from "@/lib/terminal-session";

type Props = { agentId: number; active?: boolean; disabled?: boolean };
const control = "min-h-11 whitespace-normal text-start md:min-h-11";
function readSaved(agentId: number) {
  try {
    const raw = window.sessionStorage.getItem(`acos.terminal.v1:${agentId}`);
    return { ...readTerminalSession(agentId, { getItem: () => raw }), raw };
  } catch {
    return {
      session: emptyTerminalSession(agentId),
      damaged: true,
      raw: undefined,
    };
  }
}
export function TerminalPanel(props: Props) {
  return (
    <ComputerCopyBoundary>
      {(c, locale) => (
        <Terminal key={props.agentId} {...props} c={c} locale={locale} />
      )}
    </ComputerCopyBoundary>
  );
}
function Terminal({
  agentId,
  active = true,
  disabled = false,
  c,
  locale,
}: Props & { c: ComputerCopy; locale: Locale }) {
  const client = useQueryClient();
  const id = useId();
  const { isScopeBlocked } = useOpsControl();
  const blocked = isScopeBlocked("agent_tools");
  const status = useGetVmStatus(agentId, {
    query: {
      queryKey: getGetVmStatusQueryKey(agentId),
      enabled: active,
      staleTime: 2000,
    },
  });
  const [initial] = useState(() => readSaved(agentId));
  const storedRaw = useRef(initial.raw);
  const [session, setSession] = useState(initial.session);
  const sessionRef = useRef(session);
  const [damaged, setDamaged] = useState(initial.damaged);
  const [storageError, setStorageError] = useState(false);
  const [mode, setMode] = useState<TerminalMode>("sandbox");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [serverReceipt, setServerReceipt] = useState<{
    original: TerminalRecord;
    receipt: OperatorRequestReceipt;
  } | null>(null);
  const [copyState, setCopyState] = useState<"copied" | "copyError" | null>(
    null,
  );
  const [responses, setResponses] = useState<TerminalRecord[]>(
    initial.session.record?.status === "returned"
      ? [initial.session.record]
      : [],
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const current = session.record;
  const resolvedRecord =
    serverReceipt &&
    sameTerminalRecord(current, serverReceipt.original) &&
    ["complete", "not_dispatched"].includes(serverReceipt.receipt.state);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  });
  const uncertain =
    current?.status === "unknown" || (current?.status === "pending" && !busy);
  const input = session.drafts[mode];
  const form = useForm<{ command: string }>({
    values: { command: input },
    resolver: zodResolver(
      z.object({
        command: z.string().check(
          z.maxLength(TERMINAL_COMMAND_LIMIT, c.tooLong),
          z.refine((value) => Boolean(value.trim()), c.commandRequired),
        ),
      }),
    ),
    mode: "onChange",
  });
  const commandField = form.register("command");
  const cwd =
    !status.isError && status.data?.agentId === agentId
      ? status.data.cwd?.trim()
      : null;
  const canRun =
    active &&
    !disabled &&
    !blocked &&
    !busy &&
    !damaged &&
    !storageError &&
    !uncertain &&
    Boolean(cwd) &&
    input.trim().length > 0 &&
    input.length <= TERMINAL_COMMAND_LIMIT;
  function persist(
    next: TerminalSession,
    requireSaved = false,
    expectedRaw = storedRaw.current,
  ) {
    let saved = false;
    try {
      const observed = window.sessionStorage.getItem(
        `acos.terminal.v1:${agentId}`,
      );
      if (observed !== expectedRaw) {
        const latest = readSaved(agentId);
        // Preserve this tab's unsaved draft, but expose the newer recovery
        // identity. No retry may overwrite it without a fresh explicit review.
        const held = {
          ...next,
          record: latest.damaged
            ? sessionRef.current.record
            : latest.session.record,
        };
        sessionRef.current = held;
        setSession(held);
        setDamaged(latest.damaged);
        setStorageError(true);
        return false;
      }
      saved = writeTerminalSession(next, window.sessionStorage);
      if (saved) storedRaw.current = JSON.stringify(next);
    } catch {
      /* blocked storage */
    }
    setStorageError(!saved);
    if (saved || !requireSaved) {
      sessionRef.current = next;
      setSession(next);
    }
    return saved;
  }
  function changeDraft(value: string) {
    const next = {
      ...sessionRef.current,
      drafts: { ...sessionRef.current.drafts, [mode]: value },
    };
    if (damaged) {
      sessionRef.current = next;
      setSession(next);
    } else persist(next);
  }
  async function run() {
    if (!canRun || sending.current) return;
    // Re-read the tab record before dispatch; another mounted view may own it.
    const saved = readSaved(agentId);
    if (saved.damaged) {
      setDamaged(true);
      return;
    }
    if (
      !sameTerminalRecord(saved.session.record, sessionRef.current.record) ||
      (saved.session.record && saved.session.record.status !== "returned")
    ) {
      sessionRef.current = saved.session;
      setSession(saved.session);
      return;
    }
    const record: TerminalRecord = {
      protocolVersion: 2,
      locale,
      id: crypto.randomUUID(),
      agentId,
      command: input,
      mode,
      startedAt: new Date().toISOString(),
      status: "pending",
    };
    if (!persist({ ...sessionRef.current, record })) return;
    sending.current = true;
    setBusy(true);
    setServerReceipt(null);
    setCopyState(null);
    let returned: TerminalRecord;
    try {
      const response = await execVmCommand(
        agentId,
        {
          command: record.command,
          as: record.mode,
          requestId: record.id,
          locale: record.locale,
        },
        { signal: AbortSignal.timeout(95000) },
      );
      const { receipt } = readOperatorResponse(response, {
        agentId,
        requestId: record.id,
        kind: record.mode === "founder" ? "terminal_host" : "terminal_sandbox",
      });
      if (sameTerminalRecord(sessionRef.current.record, record))
        setServerReceipt({ original: record, receipt });
      returned = receipt.result
        ? { ...record, status: "returned", result: receipt.result }
        : { ...record, status: "unknown" };
    } catch {
      returned = { ...record, status: "unknown" };
    }
    mergeResult(record, returned);
    sending.current = false;
    setBusy(false);
    void client.invalidateQueries({
      queryKey: getGetVmStatusQueryKey(agentId),
    });
    void client.invalidateQueries({
      queryKey: getListActivityQueryKey({}),
      exact: false,
    });
  }
  function mergeResult(original: TerminalRecord, returned: TerminalRecord) {
    const latest = readSaved(agentId);
    if (
      !latest.damaged &&
      sameTerminalRecord(latest.session.record, original)
    ) {
      // A late transport failure cannot erase output recovered by a newer view.
      if (
        latest.session.record?.status === "returned" &&
        returned.status !== "returned"
      )
        return;
      const drafts = { ...latest.session.drafts };
      if (
        latest.raw === storedRaw.current &&
        sameTerminalRecord(sessionRef.current.record, original)
      )
        Object.assign(drafts, sessionRef.current.drafts);
      if (
        returned.status === "returned" &&
        drafts[original.mode] === original.command
      )
        drafts[original.mode] = "";
      persist(
        { ...latest.session, drafts, record: returned },
        false,
        latest.raw,
      );
      if (returned.status === "returned")
        setResponses((values) =>
          [
            ...values.filter((value) => value.id !== original.id),
            returned,
          ].slice(-6),
        );
    } else if (!latest.damaged) {
      sessionRef.current = latest.session;
      setSession(latest.session);
    } else {
      setDamaged(true);
      setStorageError(true);
    }
  }
  function prepareReview() {
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem(`acos.terminal.v1:${agentId}`);
    } catch {
      return null;
    }
    const original = sessionRef.current.record;
    return () => {
      if (
        sending.current ||
        !sameTerminalRecord(sessionRef.current.record, original)
      )
        return false;
      try {
        if (
          window.sessionStorage.getItem(`acos.terminal.v1:${agentId}`) !== raw
        )
          return false;
      } catch {
        return false;
      }
      if (!persist({ ...sessionRef.current, record: null }, true, raw))
        return false;
      setDamaged(false);
      setServerReceipt(null);
      requestAnimationFrame(() => inputRef.current?.focus());
      return true;
    };
  }
  const outputText = responses
    .map((record) =>
      [
        record.mode + " $ " + record.command,
        record.result?.stdout ?? "",
        record.result?.stderr ?? "",
      ].join("\n"),
    )
    .join("\n\n");
  return (
    <section
      aria-label={c.terminal}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-[16px] sm:p-5"
    >
      <header className="space-y-2">
        <h3 className="text-lg font-semibold">{c.terminal}</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          {c.terminalHelp}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">{c.localOnly}</p>
      </header>
      {disabled && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {c.disabled}
        </p>
      )}
      {!disabled && blocked && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {c.blocked}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="min-w-0 break-all">
          {c.workspace} · {c.folder}:{" "}
          <bdi dir="ltr" className="font-mono">
            {cwd || "—"}
          </bdi>
        </p>
        <Button
          variant="outline"
          className={control}
          disabled={status.isFetching || busy}
          onClick={() => void status.refetch()}
        >
          {c.refresh}
        </Button>
      </div>
      {!cwd && (
        <p role={status.isError ? "alert" : "status"} className="text-sm">
          {status.isError ? c.cwdError : c.cwdLoading}
        </p>
      )}
      {storageError && (
        <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm">
          <p>{c.storageError}</p>
          {!damaged && (
            <Button
              variant="outline"
              className={control}
              onClick={() => persist(sessionRef.current)}
            >
              {c.storageRetry}
            </Button>
          )}
        </div>
      )}
      {(uncertain || damaged) && (
        <section
          aria-label={c.unconfirmed}
          className="space-y-3 rounded-lg border border-attention/50 bg-attention/5 p-4"
        >
          <h4 className="font-semibold">
            {resolvedRecord ? c.result : c.unconfirmed}
          </h4>
          {!resolvedRecord && (
            <p role="alert" className="text-sm leading-6">
              {damaged ? c.damaged : c.unconfirmedHelp}
            </p>
          )}
          {current && (
            <>
              <p className="text-sm">
                {current.mode === "founder" ? c.host : c.workspace}
              </p>
              <pre
                dir="ltr"
                className="whitespace-pre-wrap break-all rounded-lg bg-secondary p-3 font-mono text-sm"
              >
                {current.command}
              </pre>
            </>
          )}
          <OperatorRecovery
            key={JSON.stringify(
              current
                ? [
                    current.id,
                    current.agentId,
                    current.mode,
                    current.command,
                    current.startedAt,
                    current.protocolVersion,
                    current.locale,
                  ]
                : null,
            )}
            scope={
              current
                ? {
                    agentId,
                    requestId: current.id,
                    kind:
                      current.mode === "founder"
                        ? "terminal_host"
                        : "terminal_sandbox",
                  }
                : null
            }
            supported={
              current?.protocolVersion === 1 || current?.protocolVersion === 2
            }
            disabled={busy || !active}
            initialReceipt={
              serverReceipt &&
              sameTerminalRecord(current, serverReceipt.original)
                ? serverReceipt.receipt
                : null
            }
            onReceipt={(receipt) => {
              if (!current) return;
              const latest = readSaved(agentId);
              if (
                !latest.damaged &&
                sameTerminalRecord(latest.session.record, current)
              )
                setServerReceipt({ original: current, receipt });
              mergeResult(
                current,
                receipt.result
                  ? { ...current, status: "returned", result: receipt.result }
                  : { ...current, status: "unknown" },
              );
            }}
            prepareReview={prepareReview}
          />
        </section>
      )}
      <ValidatedForm
        form={form}
        className="space-y-3"
        onSubmit={run}
        onInvalid={() => inputRef.current?.focus()}
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-wrap gap-3">
          <legend className="sr-only">{c.command}</legend>
          {(["sandbox", "founder"] as const).map((value) => (
            <label
              key={value}
              className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"
            >
              <input
                type="radio"
                name={"terminal-mode-" + id}
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {value === "founder" ? c.host : c.workspace}
            </label>
          ))}
        </fieldset>
        {mode === "founder" && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-6">
            {c.hostHelp}
          </p>
        )}
        <label className="block space-y-2 text-sm font-medium">
          <span>{c.command}</span>
          <Textarea
            name={commandField.name}
            ref={(element) => {
              commandField.ref(element);
              inputRef.current = element;
            }}
            onBlur={commandField.onBlur}
            dir="ltr"
            aria-label={c.command}
            aria-describedby={`terminal-help-${id} terminal-error-${id}`}
            aria-invalid={Boolean(form.formState.errors.command)}
            rows={3}
            value={input}
            onChange={(event) => {
              void commandField.onChange(event);
              changeDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            spellCheck={false}
            autoComplete="off"
            className="min-h-28 font-mono text-base leading-6 md:text-base"
          />
        </label>
        <p id={"terminal-help-" + id} className="text-sm text-muted-foreground">
          {c.keyboard}
        </p>
        {(input.length > TERMINAL_COMMAND_LIMIT ||
          form.formState.errors.command) && (
          <p id={"terminal-error-" + id} role="alert" className="text-sm">
            {form.formState.errors.command?.message || c.tooLong}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            className={control}
            disabled={!canRun}
            aria-busy={busy}
          >
            {busy ? c.running : c.run}
          </Button>
          {["ls", "help", "pwd"].map((command) => (
            <Button
              key={command}
              type="button"
              variant="outline"
              className={control + " font-mono"}
              onClick={() => {
                changeDraft(command);
                inputRef.current?.focus();
              }}
            >
              {command}
            </Button>
          ))}
        </div>
        {(busy || current?.status === "returned") && (
          <p role="status" className="text-sm">
            {busy
              ? c.running
              : `${c.result} · ${c.exit}: ${current?.result?.exitCode ?? "—"}`}
          </p>
        )}
      </ValidatedForm>
      <section
        aria-label={c.output}
        className="min-w-0 space-y-3 border-t pt-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="me-auto font-semibold">{c.output}</h4>
          <Button
            variant="outline"
            className={control}
            disabled={!responses.length}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(outputText);
                setCopyState("copied");
              } catch {
                setCopyState("copyError");
              }
            }}
          >
            {c.copy}
          </Button>
          <Button
            variant="ghost"
            className={control}
            disabled={!responses.length || busy || uncertain}
            onClick={() => {
              setResponses([]);
              setCopyState(null);
              if (sessionRef.current.record?.status === "returned")
                persist({ ...sessionRef.current, record: null });
            }}
          >
            {c.clearOutput}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {c.historyHelp} {c.source}.
        </p>
        {copyState && (
          <p role="status" className="text-sm">
            {c[copyState]}
          </p>
        )}
        <div
          ref={outputRef}
          tabIndex={0}
          role="log"
          aria-live="off"
          aria-label={c.output}
          className="max-h-[32rem] space-y-4 overflow-y-auto rounded-lg border bg-secondary/30 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {!responses.length && (
            <p className="text-sm text-muted-foreground">{c.emptyOutput}</p>
          )}
          {responses.map((record) => (
            <article
              key={record.id}
              className="min-w-0 space-y-2 border-b pb-3 last:border-0 last:pb-0"
            >
              <h5 className="text-sm font-medium">
                {c.result} · {record.mode === "founder" ? c.host : c.workspace}
              </h5>
              <time
                dateTime={record.startedAt}
                className="block text-sm text-muted-foreground"
              >
                {dateFormat.format(new Date(record.startedAt))} ·{" "}
                {dateFormat.resolvedOptions().timeZone}
              </time>
              <pre
                dir="ltr"
                className="whitespace-pre-wrap break-all font-mono text-sm leading-6"
              >
                {record.command}
              </pre>
              {record.result?.cwd && (
                <p className="break-all text-sm text-muted-foreground">
                  {c.folder}: <bdi dir="ltr">{record.result.cwd}</bdi>
                </p>
              )}
              <pre
                dir="auto"
                className={`whitespace-pre-wrap break-words text-sm leading-6 ${(record.locale ?? locale) === "ar" ? "font-sans" : "font-mono"}`}
              >
                {record.result?.stdout || record.result?.stderr
                  ? [record.result.stdout, record.result.stderr]
                      .filter(Boolean)
                      .join("\n")
                  : c.emptyOutput}
              </pre>
              {record.result?.note && (
                <pre
                  dir="auto"
                  className="whitespace-pre-wrap break-all font-mono text-sm text-muted-foreground"
                >
                  {record.result.note}
                </pre>
              )}
              <p className="text-sm text-muted-foreground">
                {c.exit}: <bdi>{record.result?.exitCode ?? "—"}</bdi> ·{" "}
                {c.duration}:{" "}
                <bdi>
                  {new Intl.NumberFormat(locale).format(
                    record.result?.durationMs ?? 0,
                  )}{" "}
                  ms
                </bdi>
              </p>
              <Button
                variant="outline"
                className={control}
                onClick={() => {
                  setMode(record.mode);
                  const next = {
                    ...sessionRef.current,
                    drafts: {
                      ...sessionRef.current.drafts,
                      [record.mode]: record.command,
                    },
                  };
                  if (!damaged) persist(next);
                  inputRef.current?.focus();
                }}
              >
                {c.reuse}
              </Button>
            </article>
          ))}
        </div>
        {responses.length > 1 && (
          <Button
            variant="outline"
            className={control}
            onClick={() => {
              if (outputRef.current) {
                outputRef.current.scrollTop = outputRef.current.scrollHeight;
                outputRef.current.focus();
              }
            }}
          >
            {c.latest}
          </Button>
        )}
      </section>
    </section>
  );
}
