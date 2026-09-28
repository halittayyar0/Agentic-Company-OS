import { LanguagePackStatus } from "../i18n/language-pack-status";
import { ActivitySummary } from "@/components/activity-summary";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetAgentQueryKey,
  getListActivityQueryKey,
  getListAgentsQueryKey,
  getListTasksQueryKey,
  useListActivity,
  type Agent,
  type AgentRequestReceipt,
  type Message,
  type Task,
  getGetTaskQueryKey,
  getListTaskActivityQueryKey,
} from "@workspace/api-client-react";
import { Copy, ArrowDown, Send, MessageSquare } from "lucide-react";
import type { ModelSelectionValue } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { ValidatedForm } from "@/components/ui/validated-form";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { Markdown } from "@/lib/markdown";
import type { Locale } from "@/lib/i18n";
import {
  loadExpertChatCopy,
  type ExpertChatCopy,
} from "@/lib/expert-chat-copy";
import {
  CHAT_WINDOW_LIMIT,
  chatErrorStatus,
  clearChatIntent,
  fetchChatPage,
  getChatReceipt,
  isChatKind,
  postChatIntent,
  readChatDraft,
  readChatIntent,
  saveChatDraft,
  saveChatIntent,
  type ChatIntent,
  type ChatKind,
  type ChatPage,
} from "@/lib/expert-chat";

interface ChatPanelProps {
  agent: Agent;
  modelSel: ModelSelectionValue;
  active?: boolean;
  canStart?: boolean;
  project?: Task;
}
const control = "min-h-11 whitespace-normal text-start md:min-h-11";
export function ChatPanel(props: ChatPanelProps) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["expert-chat-copy", locale],
    queryFn: () => loadExpertChatCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        className="rounded-xl border bg-card p-5"
        buttonClassName="mt-3"
      />
    );
  return (
    <Conversation
      key={`${props.agent.id}:${props.project?.id ?? "direct"}`}
      {...props}
      c={copy.data}
      locale={locale}
    />
  );
}

function Conversation({
  agent,
  modelSel,
  active = true,
  canStart = true,
  project,
  c,
  locale,
}: ChatPanelProps & { c: ExpertChatCopy; locale: Locale }) {
  const client = useQueryClient();
  const taskId = project?.id;
  const formId = useId();
  const visible = useDocumentVisible() && active;
  const visibleNow = useRef(visible);
  visibleNow.current = visible;
  const ops = useOpsControl();
  const [saved] = useState(() => readChatIntent(agent.id, taskId));
  const [initialDraft] = useState(() => readChatDraft(agent.id, taskId));
  const [intent, setIntent] = useState<ChatIntent | null>(saved.intent);
  const [damaged, setDamaged] = useState(saved.damaged);
  const [draft, setDraft] = useState(
    () =>
      saved.intent?.input.content ??
      initialDraft?.content ??
      (project ? null : new URLSearchParams(location.search).get("draft")) ??
      "",
  );
  const [kind, setKind] = useState<ChatKind>(() => {
    const mode = project
      ? "ask"
      : new URLSearchParams(location.search).get("mode");
    return (
      saved.intent?.input.kind ??
      initialDraft?.kind ??
      (isChatKind(mode) ? mode : "ask")
    );
  });
  const [storageError, setStorageError] = useState(false);
  const [sending, setSending] = useState(false);
  const [shownRecord, setShownRecord] = useState<{
    intent: ChatIntent;
    receipt: AgentRequestReceipt;
  } | null>(null);
  const [failure, setFailure] = useState<
    "invalid" | "conflict" | "unconfirmed" | null
  >(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const frozen = useRef(false);
  const restorePosition = useRef<{ height: number; top: number } | null>(null);
  const olderController = useRef<AbortController | null>(null);
  const [windowPage, setWindowPage] = useState<ChatPage | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const composeForm = useForm({
    values: { content: draft },
    resolver: zodResolver(
      z.object({
        content: z.string().check(
          z.refine((value) => Boolean(value.trim()), c.required),
          z.maxLength(kind === "ask" ? 32768 : 8000, c.tooLong),
        ),
      }),
    ),
  });
  const composeField = composeForm.register("content");
  const reviewForm = useForm({
    defaultValues: { acknowledged: false },
    resolver: zodResolver(
      z.object({
        acknowledged: z
          .boolean()
          .check(z.refine((value) => value, c.acknowledge)),
      }),
    ),
  });
  const acknowledged = reviewForm.watch("acknowledged");
  const setAcknowledged = (value: boolean) =>
    reviewForm.setValue("acknowledged", value);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const latest = useQuery({
    queryKey: ["expert-chat-history", agent.id, taskId ?? null],
    queryFn: ({ signal }) => fetchChatPage(agent.id, undefined, signal, taskId),
    enabled: visible,
    refetchInterval: visible ? 8000 : false,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const receiptKey = ["expert-chat-receipt", agent.id, intent?.input.requestId];
  const result = useQuery({
    queryKey: receiptKey,
    queryFn: ({ signal }) => getChatReceipt(intent!, signal),
    enabled: visible && Boolean(intent),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      visible &&
      intent &&
      (!query.state.data || query.state.data.deliveryState === "unconfirmed")
        ? 5000
        : false,
  });
  const receipt = result.data ?? shownRecord?.receipt;
  const displayedIntent = intent ?? shownRecord?.intent;
  const activity = useListActivity(
    { agentId: agent.id, limit: 12 },
    {
      query: {
        queryKey: getListActivityQueryKey({ agentId: agent.id, limit: 12 }),
        enabled: visible && !project,
        retry: false,
        refetchInterval: visible && !project ? 8000 : false,
      },
    },
  );
  const maxLength = kind === "ask" ? 32768 : 8000;
  const tooLong = draft.length > maxLength;
  const configurationReady =
    canStart &&
    agent.isActive &&
    Boolean(agent.configVersion && /^[a-f0-9]{64}$/.test(agent.configVersion));
  const blocked = ops.controlsBlocked;
  const missing = chatErrorStatus(result.error) === 404;
  const newMessages =
    (latest.data?.messages.at(-1)?.id ?? 0) >
    (windowPage?.messages.at(-1)?.id ?? 0);
  const needsReview =
    !receipt ||
    receipt.deliveryState === "unconfirmed" ||
    !["reply", "queued", "rejected"].includes(receipt.outcome);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      olderController.current?.abort();
    };
  }, []);
  // Release ordinary completed sends only after a visible render. A late
  // response while this tab is hidden or unmounted retains its recovery key.
  useEffect(() => {
    const confirmed = result.data;
    if (
      !visible ||
      sending ||
      !intent ||
      !confirmed ||
      !["reply", "queued", "rejected"].includes(confirmed.outcome)
    )
      return;
    if (!clearChatIntent(agent.id, taskId, intent.input.requestId)) {
      setStorageError(true);
      return;
    }
    setShownRecord({ intent, receipt: confirmed });
    setIntent(null);
    setFailure(null);
    const next =
      confirmed.deliveryState === "rejected" ? intent.input.content : "";
    setDraft(next);
    setStorageError(!saveChatDraft(agent.id, next, kind, taskId));
  }, [visible, sending, intent, result.data, agent.id, kind, taskId]);
  useEffect(() => {
    if (!latest.data) return;
    const next = latest.data;
    setWindowPage((current) =>
      !current || (!frozen.current && nearBottom.current) ? next : current,
    );
  }, [latest.data]);
  useLayoutEffect(() => {
    if (!log.current) return;
    if (restorePosition.current) {
      log.current.scrollTop =
        restorePosition.current.top +
        log.current.scrollHeight -
        restorePosition.current.height;
      restorePosition.current = null;
    } else if (nearBottom.current && !frozen.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [windowPage]);
  function updateDraft(content: string, mode = kind) {
    setDraft(content);
    setKind(mode);
    setStorageError(!saveChatDraft(agent.id, content, mode, taskId));
  }
  async function showLatest() {
    if (olderBusy) return;
    const next = await latest.refetch();
    if (next.isSuccess && alive.current) {
      frozen.current = false;
      nearBottom.current = true;
      setWindowPage({ ...next.data });
      setOlderError(false);
    }
  }
  async function loadOlder() {
    if (
      !windowPage?.beforeId ||
      olderBusy ||
      windowPage.messages.length >= CHAT_WINDOW_LIMIT
    )
      return;
    frozen.current = true;
    nearBottom.current = false;
    setOlderBusy(true);
    setOlderError(false);
    olderController.current = new AbortController();
    try {
      const next = await fetchChatPage(
        agent.id,
        windowPage.beforeId,
        olderController.current.signal,
        taskId,
      );
      if (!alive.current) return;
      if (log.current)
        restorePosition.current = {
          height: log.current.scrollHeight,
          top: log.current.scrollTop,
        };
      setWindowPage((current) =>
        current
          ? {
              messages: [...next.messages, ...current.messages],
              beforeId: next.beforeId,
            }
          : next,
      );
    } catch {
      if (alive.current) {
        restorePosition.current = null;
        setOlderError(true);
      }
    } finally {
      if (alive.current) setOlderBusy(false);
    }
  }
  async function dispatch(recover?: ChatIntent) {
    if (
      !alive.current ||
      !visibleNow.current ||
      document.visibilityState !== "visible" ||
      busy.current ||
      (!recover &&
        (intent ||
          damaged ||
          blocked ||
          !configurationReady ||
          latest.isError ||
          !windowPage ||
          !draft.trim() ||
          tooLong))
    )
      return;
    if (recover && (blocked || !configurationReady)) return;
    if (!recover) {
      const retained = readChatIntent(agent.id, taskId);
      if (retained.damaged || retained.intent) {
        setDamaged(retained.damaged);
        setIntent(retained.intent);
        return;
      }
    }
    let request: ChatIntent;
    try {
      request = recover ?? {
        agentId: agent.id,
        input: {
          requestId: crypto.randomUUID(),
          kind,
          content: draft,
          locale,
          expectedConfig: agent.configVersion!,
          ...(taskId !== undefined ? { taskId } : {}),
          ...(kind === "ask"
            ? modelSel.modelMode === "manual" && modelSel.modelId
              ? { modelMode: "manual", modelId: modelSel.modelId }
              : { modelMode: "auto" }
            : {}),
        },
      };
      if (!recover && !saveChatIntent(request))
        throw new Error("Local record unavailable");
    } catch {
      setStorageError(true);
      return;
    }
    busy.current = true;
    setSending(true);
    setFailure(null);
    setShownRecord(null);
    setIntent(request);
    try {
      const value = await postChatIntent(request);
      const key = ["expert-chat-receipt", agent.id, request.input.requestId];
      await client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<AgentRequestReceipt>(key, (current) =>
        current?.deliveryState === "complete" ||
        current?.deliveryState === "rejected"
          ? current
          : value,
      );
      void client.invalidateQueries({
        queryKey: ["expert-chat-history", agent.id],
      });
      void client.invalidateQueries({
        queryKey: getGetAgentQueryKey(agent.id),
      });
      void client.invalidateQueries({ queryKey: getListTasksQueryKey() });
      void client.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      if (taskId !== undefined) {
        void client.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
        void client.invalidateQueries({
          queryKey: getListTaskActivityQueryKey(taskId),
        });
      }
    } catch (error) {
      if (alive.current)
        setFailure(
          chatErrorStatus(error) === 400
            ? "invalid"
            : chatErrorStatus(error) === 409
              ? "conflict"
              : "unconfirmed",
        );
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  }
  function continueAfterReceipt() {
    if (sending || (needsReview && !acknowledged)) return;
    if (!clearChatIntent(agent.id, taskId, intent?.input.requestId)) {
      setStorageError(true);
      return;
    }
    const retainText = receipt?.deliveryState === "rejected" || needsReview;
    setIntent(null);
    setShownRecord(null);
    setDamaged(false);
    setFailure(null);
    setReviewOpen(false);
    setAcknowledged(false);
    updateDraft(retainText ? draft : "");
    requestAnimationFrame(() => composer.current?.focus());
  }
  function rejectionText(value: AgentRequestReceipt): string {
    switch (value.failureCode) {
      case "PROJECT_CHAT_UNAVAILABLE":
        return c.projectUnavailable;
      case "AGENT_CONFIG_CHANGED":
        return c.configChanged;
      case "AGENT_BUSY":
        return c.busy;
      case "RUNTIME_CAPACITY_EXCEEDED":
        return c.capacity;
      case "EMERGENCY_STOP_ACTIVE":
        return c.blocked;
      default:
        return c.unavailable;
    }
  }
  return (
    <section
      className={`grid min-w-0 gap-4 ${project ? "" : "xl:grid-cols-[minmax(0,1fr)_17rem]"}`}
      aria-label={project ? c.projectTitle : c.title}
    >
      <div className="min-w-0 rounded-xl border bg-card">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-lg font-semibold">
              {project ? c.projectTitle : c.title}
            </h2>
            {project && (
              <p className="mt-1 break-words text-sm">
                <bdi>{project.title}</bdi> · <bdi>{agent.name}</bdi>
              </p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {project ? c.projectHelp : c.help}
            </p>
          </div>
          <Button
            variant="outline"
            className={control}
            onClick={() => void showLatest()}
            disabled={latest.isFetching || olderBusy}
          >
            {c.refresh}
          </Button>
        </header>
        {latest.isError && (
          <p
            className="m-4 rounded-lg border border-destructive/40 p-3 text-sm"
            role="alert"
          >
            {windowPage ? c.historyStale : c.historyError}
          </p>
        )}
        <div
          ref={log}
          role="region"
          tabIndex={0}
          aria-label={c.history}
          className="scrollbar-slim max-h-[55dvh] min-h-48 overflow-y-auto overscroll-contain p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
          onScroll={() => {
            if (log.current)
              nearBottom.current =
                log.current.scrollHeight -
                  log.current.scrollTop -
                  log.current.clientHeight <
                64;
          }}
        >
          {!windowPage && !latest.isError && (
            <p role="status" className="py-8 text-muted-foreground">
              {c.loading}
            </p>
          )}
          {windowPage?.beforeId &&
          windowPage.messages.length < CHAT_WINDOW_LIMIT ? (
            <Button
              variant="outline"
              className={`${control} mb-4`}
              disabled={olderBusy}
              onClick={() => void loadOlder()}
            >
              {olderBusy ? c.loading : c.older}
            </Button>
          ) : null}
          {olderError && (
            <p role="alert" className="mb-4 text-sm">
              {c.olderError}
            </p>
          )}
          {windowPage && windowPage.messages.length >= CHAT_WINDOW_LIMIT && (
            <p className="mb-4 text-sm text-muted-foreground">
              {c.windowLimit}
            </p>
          )}
          {windowPage?.messages.length === 0 && (
            <div className="py-8 text-center">
              <MessageSquare
                aria-hidden="true"
                className="mx-auto mb-3 size-8 text-muted-foreground"
              />
              <h3 className="font-semibold">{c.empty}</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {c.emptyHelp}
              </p>
              <Button
                variant="outline"
                className={`${control} mt-4 max-w-full`}
                disabled={Boolean(intent) || damaged}
                onClick={() => {
                  updateDraft(project ? c.projectPrompt : c.prompt, "ask");
                  composer.current?.focus();
                }}
              >
                {project ? c.projectPrompt : c.prompt}
              </Button>
            </div>
          )}
          <div className="space-y-5">
            {windowPage?.messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                name={agent.name}
                c={c}
                locale={locale}
              />
            ))}
          </div>
        </div>
        {(newMessages || frozen.current) && (
          <div className="border-t px-4 py-2">
            <Button
              variant="secondary"
              className={control}
              disabled={latest.isFetching || olderBusy}
              onClick={() => void showLatest()}
            >
              <ArrowDown aria-hidden="true" />
              {newMessages ? c.newMessages : c.latest}
            </Button>
          </div>
        )}
        <div className="space-y-4 border-t bg-background/50 p-4 sm:p-5">
          {(displayedIntent || damaged) && (
            <section
              className="space-y-3 rounded-lg border bg-card p-4"
              aria-label={c.receipt}
            >
              <p role="status" className="font-semibold">
                {sending
                  ? c.sending
                  : receipt?.deliveryState === "complete"
                    ? receipt.outcome === "queued"
                      ? c.queued
                      : receipt.outcome === "reply"
                        ? c.done
                        : c.systemResult
                    : receipt?.deliveryState === "rejected"
                      ? c.rejected
                      : c.unconfirmed}
              </p>
              <p className="text-sm text-muted-foreground">
                {damaged
                  ? c.storageError
                  : receipt?.deliveryState === "rejected"
                    ? rejectionText(receipt)
                    : receipt?.deliveryState === "complete"
                      ? receipt.outcome === "queued"
                        ? receipt.kind === "continuous"
                          ? c.continuousHelp
                          : c.delegateHelp
                        : c.source
                      : c.unconfirmedHelp}
              </p>
              {displayedIntent && (
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {c.receipt}
                  </summary>
                  <p dir="ltr" className="break-all font-mono text-xs">
                    {displayedIntent.input.requestId}
                  </p>
                  <p
                    dir="auto"
                    className="mt-2 whitespace-pre-wrap break-words"
                  >
                    {displayedIntent.input.content}
                  </p>
                  {receipt?.usedModel && (
                    <p className="mt-2">
                      {c.model}:{" "}
                      <bdi className="break-all">{receipt.usedModel}</bdi>
                      {receipt.usedProvider && (
                        <>
                          {" "}
                          · <bdi>{receipt.usedProvider}</bdi>
                        </>
                      )}
                    </p>
                  )}
                </details>
              )}
              {receipt?.agentMessage &&
                !windowPage?.messages.some(
                  (message) => message.id === receipt.agentMessage!.id,
                ) && (
                  <ChatMessage
                    message={receipt.agentMessage}
                    name={agent.name}
                    c={c}
                    locale={locale}
                  />
                )}
              {failure && (
                <p role="alert" className="text-sm">
                  {c[failure]}
                </p>
              )}
              {result.isError && !sending && (
                <p role="alert" className="text-sm">
                  {missing ? c.missing : c.readError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {intent && (
                  <Button
                    variant="outline"
                    className={control}
                    disabled={result.isFetching}
                    onClick={() => void result.refetch()}
                  >
                    {result.isFetching ? c.checking : c.check}
                  </Button>
                )}
                {receipt?.task && (
                  <Button asChild variant="outline" className={control}>
                    <Link href={`/projects/${receipt.task.id}`}>
                      {c.project}
                    </Link>
                  </Button>
                )}
                {needsReview && (
                  <Button asChild variant="outline" className={control}>
                    <Link href="/operations">{c.operations}</Link>
                  </Button>
                )}
                {(intent || damaged) && (
                  <Button
                    ref={reviewButton}
                    variant="secondary"
                    className={control}
                    disabled={sending}
                    onClick={() => {
                      if (needsReview) {
                        setAcknowledged(false);
                        setReviewOpen(true);
                      } else continueAfterReceipt();
                    }}
                  >
                    {needsReview ? c.review : c.continue}
                  </Button>
                )}
              </div>
              {missing && intent && !sending && !receipt && (
                <div className="border-t pt-3">
                  <p className="mb-2 text-sm text-muted-foreground">
                    {c.recoverHelp}
                  </p>
                  <Button
                    variant="outline"
                    className={control}
                    disabled={blocked || !configurationReady}
                    onClick={() => void dispatch(intent)}
                  >
                    {c.recover}
                  </Button>
                </div>
              )}
            </section>
          )}
          {storageError && (
            <p role="alert" className="text-sm">
              {c.storageError}
            </p>
          )}
          {blocked && (
            <p role="status" className="text-sm">
              {c.blocked}
            </p>
          )}
          {!configurationReady && (
            <p role="status" className="text-sm">
              {c.unavailable}
            </p>
          )}
          <ValidatedForm
            form={composeForm}
            onSubmit={() => dispatch()}
            className="space-y-3"
          >
            {!project && (
              <fieldset
                disabled={Boolean(intent) || damaged}
                className="min-w-0"
              >
                <legend className="mb-2 text-sm font-medium">{c.mode}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["ask", "delegate", "continuous"] as const).map((mode) => (
                    <label
                      key={mode}
                      className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${kind === mode ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <input
                        type="radio"
                        name={`expert-chat-mode-${agent.id}`}
                        value={mode}
                        checked={kind === mode}
                        onChange={() => updateDraft(draft, mode)}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span>{c[mode]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="text-sm text-muted-foreground">{c[`${kind}Help`]}</p>
            <label htmlFor={formId} className="block text-sm font-medium">
              {c.instruction}
            </label>
            <textarea
              {...composeField}
              id={formId}
              ref={(node) => {
                composeField.ref(node);
                composer.current = node;
              }}
              value={draft}
              rows={4}
              readOnly={Boolean(intent) || damaged}
              onChange={(event) => {
                void composeField.onChange(event);
                updateDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey) &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={c.placeholder}
              aria-invalid={Boolean(composeForm.formState.errors.content)}
              aria-describedby={`${formId}-help ${formId}-error`}
              dir="auto"
              className="min-h-28 w-full resize-y rounded-lg border bg-background p-3 text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:bg-secondary/30"
            />
            <div
              id={`${formId}-help`}
              className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"
            >
              <span>{c.keyboard}</span>
              <span dir="auto">
                {number(draft.length)} / {number(maxLength)}
              </span>
            </div>
            <p
              id={`${formId}-error`}
              role={composeForm.formState.errors.content ? "alert" : undefined}
              className="text-sm"
            >
              {composeForm.formState.errors.content?.message}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-xs text-muted-foreground">
                {c.draftLocal}
              </p>
              <Button
                type="submit"
                aria-busy={sending}
                className={control}
                disabled={
                  sending ||
                  Boolean(intent) ||
                  damaged ||
                  blocked ||
                  !configurationReady ||
                  latest.isError ||
                  !windowPage
                }
              >
                <Send aria-hidden="true" />
                {c.send}
              </Button>
            </div>
          </ValidatedForm>
        </div>
      </div>
      {!project && (
        <aside className="min-w-0 self-start rounded-xl border bg-card p-4">
          <h3 className="font-semibold">{c.activity}</h3>
          <p className="mb-4 mt-2 text-sm text-muted-foreground">
            {c.activityHelp}
          </p>
          {activity.isError && (
            <p role="alert" className="mb-3 text-sm">
              {c.activityError}
            </p>
          )}
          {activity.isPending ? (
            <p role="status" className="text-sm">
              {c.loading}
            </p>
          ) : !activity.data?.length && !activity.isError ? (
            <p className="text-sm text-muted-foreground">{c.activityEmpty}</p>
          ) : null}
          <ol className="space-y-4">
            {activity.data?.slice(0, 12).map((event) => (
              <li key={event.id} className="border-s-2 border-border ps-3">
                <p
                  dir="auto"
                  className="whitespace-pre-wrap break-words text-sm"
                >
                  <ActivitySummary event={event} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dateLabel(event.createdAt, locale)}
                </p>
              </li>
            ))}
          </ol>
          <Button
            asChild
            variant="outline"
            className={`${control} mt-4 max-w-full`}
          >
            <Link href="/operations">{c.operations}</Link>
          </Button>
        </aside>
      )}
      <AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelButton.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (intent || damaged) reviewButton.current?.focus();
            else composer.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{c.review}</AlertDialogTitle>
            <AlertDialogDescription>{c.reviewHelp}</AlertDialogDescription>
          </AlertDialogHeader>
          <ValidatedForm form={reviewForm} onSubmit={continueAfterReceipt}>
            <label className="flex min-h-11 items-start gap-3 py-3 text-sm">
              <input
                type="checkbox"
                {...reviewForm.register("acknowledged")}
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 size-4 shrink-0 accent-primary"
                aria-describedby={`${formId}-review-error`}
                aria-invalid={Boolean(reviewForm.formState.errors.acknowledged)}
              />
              <span>{c.acknowledge}</span>
            </label>
            <p
              id={`${formId}-review-error`}
              role={
                reviewForm.formState.errors.acknowledged ? "alert" : undefined
              }
            >
              {reviewForm.formState.errors.acknowledged?.message}
            </p>
            <AlertDialogFooter>
              <Button
                ref={cancelButton}
                type="button"
                variant="outline"
                className={control}
                onClick={() => setReviewOpen(false)}
              >
                {c.cancel}
              </Button>
              <Button
                className={control}
                disabled={!acknowledged || sending}
                type="submit"
              >
                {c.continue}
              </Button>
            </AlertDialogFooter>
          </ValidatedForm>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function dateLabel(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(date)
    : "—";
}
function ChatMessage({
  message,
  name,
  c,
  locale,
}: {
  message: Message;
  name: string;
  c: ExpertChatCopy;
  locale: Locale;
}) {
  const [copyState, setCopyState] = useState<"copied" | "copyError" | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      if (alive.current) setCopyState("copied");
    } catch {
      if (alive.current) setCopyState("copyError");
    } finally {
      clearTimeout(timer.current);
      if (alive.current)
        timer.current = setTimeout(() => setCopyState(null), 4000);
    }
  }
  return (
    <article
      data-message-id={message.id}
      className={`min-w-0 rounded-lg border p-3 sm:p-4 ${message.role === "user" ? "bg-secondary/40" : "bg-background"}`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">
            <bdi>
              {message.role === "user"
                ? c.you
                : message.role === "system"
                  ? c.system
                  : name}
            </bdi>
          </p>
          <time
            dateTime={message.createdAt}
            className="text-xs text-muted-foreground"
          >
            {dateLabel(message.createdAt, locale)}
          </time>
        </div>
        <Button
          type="button"
          variant="ghost"
          className={control}
          onClick={() => void copy()}
          aria-label={c.copy}
        >
          <Copy aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{c.copy}</span>
        </Button>
      </header>
      <div dir="auto" className="min-w-0 [overflow-wrap:anywhere]">
        {message.role === "user" ? (
          <p className="whitespace-pre-wrap text-base leading-relaxed">
            {message.content}
          </p>
        ) : (
          <Markdown content={message.content} unsafeLinkLabel={c.unsafeLink} />
        )}
      </div>
      {message.modelId && (
        <p className="mt-3 text-xs text-muted-foreground">
          {c.model}: <bdi className="break-all">{message.modelId}</bdi>
        </p>
      )}
      {copyState && (
        <p
          role={copyState === "copyError" ? "alert" : "status"}
          className="mt-2 text-sm"
        >
          {c[copyState]}
        </p>
      )}
    </article>
  );
}
