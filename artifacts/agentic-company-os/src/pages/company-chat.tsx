import { useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetCompanyChannelQueryKey,
  getListAgentsQueryKey,
  getListCompanyMessagesQueryKey,
  listCompanyMessages,
  useListAgents,
  type Agent,
  type CompanyMessage,
  type CompanyMessageResponse,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  ChevronDown,
  UsersRound,
} from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { CompanyRoomComposer } from "@/components/company/company-room-composer";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { useMediaQuery } from "@/hooks/use-page-activity";
import {
  addCompanyRoomMember,
  companyRoomMembersQueryKey,
  listCompanyRoomMembers,
  removeCompanyRoomMember,
  sendCompanyRoomMessage,
} from "@/lib/company-room";
import {
  loadCompanyRoomCopy,
  type CompanyRoomCopy,
} from "@/lib/company-room-copy";
import {
  clearRoomIntent,
  readRoomIntent,
  roomSendRejection,
  saveRoomIntent,
  type RoomSendIntent,
} from "@/lib/company-room-send";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const CHAT_KEY = [
  ...getListCompanyMessagesQueryKey({ limit: PAGE_SIZE }),
  "infinite",
];

export default function CompanyChatPage() {
  const { locale, t } = useLocale();
  const copy = useQuery({
    queryKey: ["room-copy", locale],
    queryFn: () => loadCompanyRoomCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <section
        role={copy.isError ? "alert" : "status"}
        className="rounded-xl border bg-card p-6"
      >
        <p>{copy.isError ? t("roomCopyError") : t("loadingScreen")}</p>
        {copy.isError && (
          <Button className="mt-4" onClick={() => window.location.reload()}>
            {t("checkAgain")}
          </Button>
        )}
      </section>
    );
  return <Room copy={copy.data} locale={locale} />;
}

function Room({ copy: c, locale }: { copy: CompanyRoomCopy; locale: Locale }) {
  const [intent, setIntent] = useState(readRoomIntent);
  const [draft, setDraft] = useState(() => readRoomIntent()?.content ?? "");
  const [receipt, setReceipt] = useState<CompanyMessageResponse | null>(null);
  const [failure, setFailure] = useState<keyof CompanyRoomCopy | null>(null);
  const [sending, setSending] = useState(false);
  const [memberPending, setMemberPending] = useState<number | null>(null);
  const [memberStatus, setMemberStatus] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const sendBusy = useRef(false);
  const memberBusy = useRef(false);
  const nearBottom = useRef(true);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const client = useQueryClient();
  const ops = useOpsControl();
  const wide = useMediaQuery("(min-width: 1280px)");
  const agentsQuery = useListAgents(
    { includeInactive: true },
    {
      query: {
        queryKey: getListAgentsQueryKey({ includeInactive: true }),
        retry: false,
        refetchInterval: 10000,
      },
    },
  );
  const membersQuery = useQuery({
    queryKey: companyRoomMembersQueryKey,
    queryFn: listCompanyRoomMembers,
    retry: false,
    refetchInterval: 10000,
  });
  const messagesQuery = useInfiniteQuery({
    queryKey: CHAT_KEY,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      listCompanyMessages(
        { limit: PAGE_SIZE, beforeId: pageParam },
        { signal },
      ),
    getNextPageParam: (last) =>
      last.length === PAGE_SIZE
        ? Math.min(...last.map((message) => message.id))
        : undefined,
    retry: false,
    refetchInterval: 5000,
    refetchOnWindowFocus: "always",
  });
  const agents = agentsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const messages = useMemo(() => {
    const unique = new Map<number, CompanyMessage>();
    for (const page of messagesQuery.data?.pages ?? [])
      for (const message of page) unique.set(message.id, message);
    return [...unique.values()].sort((a, b) => a.id - b.id);
  }, [messagesQuery.data]);
  const rosterReady =
    membersQuery.isSuccess &&
    !membersQuery.isError &&
    agentsQuery.isSuccess &&
    !agentsQuery.isError;
  const staleRoster = membersQuery.isError || agentsQuery.isError;
  const controlsBlocked =
    !rosterReady ||
    messagesQuery.isPending ||
    messagesQuery.isError ||
    needsRefresh;
  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => {
    if (!lastMessageId) return;
    if (nearBottom.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
    else setNewMessages(true);
  }, [lastMessageId]);
  // A response arriving after navigation must leave the pending intent intact.
  // Clear it only after this page actually mounts the receipt for the operator.
  useEffect(() => {
    if (receipt) {
      clearRoomIntent();
      setIntent(null);
      setDraft("");
    }
  }, [receipt]);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  async function refresh() {
    const results = await Promise.all([
      membersQuery.refetch(),
      agentsQuery.refetch(),
      messagesQuery.refetch(),
    ]);
    if (results.every((result) => result.isSuccess)) {
      setNeedsRefresh(false);
      setMemberStatus(null);
      if (!intent) setFailure(null);
    }
    ops.refetch();
  }
  async function send(
    content: string,
    mentionedAgentIds: number[],
    recover?: RoomSendIntent,
  ) {
    if (
      sendBusy.current ||
      (!recover &&
        (memberBusy.current ||
          controlsBlocked ||
          ops.controlsBlocked ||
          intent ||
          receipt))
    )
      return;
    const request = recover ?? {
      requestId: crypto.randomUUID(),
      content,
      mentionedAgentIds,
      locale,
    };
    if (!recover && !saveRoomIntent(request)) {
      setFailure("storageError");
      return;
    }
    setIntent(request);
    setFailure(null);
    setSending(true);
    sendBusy.current = true;
    try {
      const result = await sendCompanyRoomMessage(request);
      if (
        !Number.isSafeInteger(result?.founderMessage?.id) ||
        result.founderMessage.content !== request.content ||
        !Array.isArray(result.agentMessages) ||
        !Array.isArray(result.skippedParticipants) ||
        !["complete", "unconfirmed"].includes(result.deliveryState)
      )
        throw new Error("Unconfirmed room receipt");
      setReceipt(result);
      await Promise.all([
        client.invalidateQueries({
          queryKey: getListCompanyMessagesQueryKey(),
        }),
        client.invalidateQueries({ queryKey: getGetCompanyChannelQueryKey() }),
      ]);
    } catch (error) {
      const rejection = roomSendRejection(error);
      setFailure(rejection ?? "unknown");
      if (rejection && rejection !== "conflict") {
        clearRoomIntent();
        setIntent(null);
        setNeedsRefresh(true);
      }
    } finally {
      sendBusy.current = false;
      setSending(false);
    }
  }
  async function toggle(agent: Agent, joined: boolean) {
    if (
      memberBusy.current ||
      controlsBlocked ||
      sending ||
      (!agent.isActive && !joined)
    )
      return;
    memberBusy.current = true;
    setMemberPending(agent.id);
    setMemberStatus(null);
    try {
      if (joined) await removeCompanyRoomMember(agent.id);
      else await addCompanyRoomMember(agent.id);
      await Promise.all([
        client.invalidateQueries({ queryKey: companyRoomMembersQueryKey }),
        client.invalidateQueries({ queryKey: getGetCompanyChannelQueryKey() }),
      ]);
      setMemberStatus(
        (joined ? c.memberRemoved : c.memberAdded) + ": " + agent.name,
      );
    } catch {
      setMemberStatus(c.memberError);
      setNeedsRefresh(true);
    } finally {
      memberBusy.current = false;
      setMemberPending(null);
    }
  }
  async function older() {
    if (messagesQuery.isFetching || !messagesQuery.hasNextPage) return;
    const oldHeight = log.current?.scrollHeight ?? 0;
    const oldTop = log.current?.scrollTop ?? 0;
    await messagesQuery.fetchNextPage();
    requestAnimationFrame(() => {
      if (log.current)
        log.current.scrollTop = oldTop + log.current.scrollHeight - oldHeight;
    });
  }
  function another() {
    setReceipt(null);
    setFailure(null);
    requestAnimationFrame(() => composer.current?.focus());
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8 [overflow-wrap:anywhere]">
      <header className="border-b pb-5">
        <p className="text-sm font-medium text-primary">{c.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {c.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {c.description}
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {c.activeMembers}:{" "}
          {rosterReady
            ? number(members.filter((member) => member.isActive).length)
            : "—"}
        </p>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={
            sending ||
            memberPending !== null ||
            messagesQuery.isFetching ||
            membersQuery.isFetching ||
            agentsQuery.isFetching
          }
          onClick={() => void refresh()}
        >
          {c.retry}
        </Button>
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section
          className="min-w-0 rounded-xl border bg-card"
          aria-label={c.title}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
            <p className="text-xs text-muted-foreground">
              {c.loadedMessages}:{" "}
              {messagesQuery.data ? number(messages.length) : "—"}
            </p>
            {messagesQuery.hasNextPage && (
              <Button
                variant="outline"
                className="min-h-11 h-auto whitespace-normal"
                disabled={messagesQuery.isFetching}
                onClick={() => void older()}
              >
                {c.older}
              </Button>
            )}
          </div>
          {messagesQuery.isError && (
            <p role="alert" className="m-3 rounded-lg border p-3 text-sm">
              {messagesQuery.data ? c.messagesStale : c.messagesError}
            </p>
          )}
          {messagesQuery.isPending ? (
            <p role="status" className="p-6">
              {c.loadingMessages}
            </p>
          ) : !messagesQuery.data ? null : messages.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center">
              <UsersRound aria-hidden className="mb-3 text-primary" />
              <h2 className="font-semibold">{c.empty}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {c.emptyHelp}
              </p>
              <Button
                className="mt-4 min-h-11"
                onClick={() => composer.current?.focus()}
              >
                {c.firstMessage}
              </Button>
            </div>
          ) : (
            <div
              ref={log}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={c.title}
              tabIndex={0}
              onScroll={() => {
                if (log.current) {
                  nearBottom.current =
                    log.current.scrollHeight -
                      log.current.scrollTop -
                      log.current.clientHeight <
                    80;
                  if (nearBottom.current) setNewMessages(false);
                }
              }}
              className="h-[55dvh] min-h-64 space-y-4 overflow-y-auto p-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
            >
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  agent={
                    message.senderAgentId
                      ? agentsById.get(message.senderAgentId)
                      : undefined
                  }
                  copy={c}
                  locale={locale}
                />
              ))}
            </div>
          )}
          {newMessages && (
            <Button
              variant="outline"
              className="m-3 min-h-11"
              onClick={() => {
                if (log.current)
                  log.current.scrollTop = log.current.scrollHeight;
                nearBottom.current = true;
                setNewMessages(false);
              }}
            >
              {c.newMessages}
            </Button>
          )}
          <div className="space-y-3 border-t p-3 sm:p-4">
            {ops.controlsBlocked && (
              <p
                role="status"
                className="text-sm leading-6 text-muted-foreground"
              >
                {ops.isLoading || ops.isError ? c.safetyUnknown : c.stopped}
              </p>
            )}
            {(staleRoster || needsRefresh) && (
              <p role="alert" className="text-sm leading-6 text-destructive">
                {c.rosterStale}
              </p>
            )}
            {failure && (
              <p
                role="alert"
                className="rounded-lg border p-3 text-sm leading-6"
              >
                {c[failure]}
              </p>
            )}
            {intent && !receipt && (
              <section
                role="status"
                className="rounded-lg border p-3 text-sm leading-6"
              >
                <p>{c.pendingHelp}</p>
                <p className="mt-1 text-xs">
                  <bdi>{intent.locale}</bdi>
                  {intent.mentionedAgentIds.length > 0 && (
                    <>
                      {" "}
                      · {c.members}:{" "}
                      {intent.mentionedAgentIds
                        .map((id) => agentsById.get(id)?.name ?? "#" + id)
                        .join(", ")}
                    </>
                  )}
                </p>
                {!sending && (
                  <Button
                    variant="outline"
                    className="mt-3 min-h-11"
                    onClick={() =>
                      void send(
                        intent.content,
                        intent.mentionedAgentIds,
                        intent,
                      )
                    }
                  >
                    {c.recover}
                  </Button>
                )}
                {failure === "conflict" && (
                  <Button
                    variant="outline"
                    className="ms-2 mt-3 min-h-11"
                    onClick={() => {
                      clearRoomIntent();
                      setIntent(null);
                      setFailure(null);
                      setNeedsRefresh(true);
                    }}
                  >
                    {c.newSend}
                  </Button>
                )}
              </section>
            )}
            {receipt && (
              <section
                role="status"
                className="rounded-lg border p-3 text-sm leading-6"
              >
                <h2 className="font-semibold">
                  {c.stored} · #{receipt.founderMessage.id}
                </h2>
                <p>
                  {receipt.deliveryState === "complete"
                    ? c.storedHelp
                    : c.unconfirmed}
                </p>
                {receipt.skippedParticipants.length > 0 && (
                  <details className="mt-2">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium">
                      {c.skipped}
                    </summary>
                    <ul className="space-y-2">
                      {receipt.skippedParticipants.map((item) => (
                        <li key={item.agentId}>
                          <bdi>
                            {agentsById.get(item.agentId)?.name ??
                              c.agent + " #" + item.agentId}
                          </bdi>{" "}
                          · {c[item.reason]}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <Button
                  variant="outline"
                  className="mt-3 min-h-11"
                  disabled={sending}
                  onClick={another}
                >
                  {c.newSend}
                </Button>
              </section>
            )}
            <CompanyRoomComposer
              copy={c}
              value={draft}
              onChange={setDraft}
              members={members}
              agentsById={agentsById}
              onSubmit={(content, ids) => void send(content, ids)}
              pending={sending}
              disabled={
                Boolean(intent || receipt) ||
                memberPending !== null ||
                controlsBlocked ||
                ops.controlsBlocked
              }
              textareaRef={composer}
            />
            {sending && (
              <p role="status" className="text-sm">
                {c.sending}
              </p>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              {c.source}
            </p>
          </div>
        </section>
        <aside
          aria-label={c.memberRegion}
          className="min-w-0 self-start rounded-xl border bg-card"
        >
          <details open={wide} className="group">
            <summary className="flex min-h-14 cursor-pointer items-center gap-2 border-b p-4 font-semibold">
              <UsersRound size={18} aria-hidden />
              {c.members}
              <ChevronDown
                aria-hidden
                className="ms-auto size-4 shrink-0 group-open:rotate-180"
              />
            </summary>
            <div className="p-4">
              <p className="text-xs leading-5 text-muted-foreground">
                {c.rosterHelp}
              </p>
              {memberStatus && (
                <p role="status" className="mt-3 text-sm leading-6">
                  {memberStatus}
                </p>
              )}
              {agentsQuery.isPending || membersQuery.isPending ? (
                <p role="status" className="py-4">
                  {c.loadingMembers}
                </p>
              ) : staleRoster ? (
                <p role="alert" className="py-4 text-sm">
                  {c.rosterError}
                </p>
              ) : agents.length === 0 ? (
                <p className="py-4 text-sm">{c.noAgents}</p>
              ) : (
                <div className="mt-3 max-h-[65dvh] space-y-2 overflow-y-auto">
                  {members.length === 0 && (
                    <p className="mb-3 text-sm text-muted-foreground">
                      {c.noMembers}
                    </p>
                  )}
                  {agents.map((agent) => {
                    const joined = members.some(
                      (member) => member.agentId === agent.id,
                    );
                    return (
                      <div
                        key={agent.id}
                        className="min-w-0 rounded-lg border p-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <AgentAvatar agent={agent} size="sm" />
                          <div className="min-w-0 flex-1">
                            <bdi className="block truncate text-sm font-medium">
                              {agent.name}
                            </bdi>
                            <bdi className="block truncate text-xs text-muted-foreground">
                              {agent.role}
                            </bdi>
                            {!agent.isActive && (
                              <p className="text-xs text-muted-foreground">
                                {c.inactive}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            variant={joined ? "secondary" : "outline"}
                            aria-pressed={joined}
                            aria-label={
                              (joined ? c.leave : c.join) + ": " + agent.name
                            }
                            disabled={
                              memberPending !== null ||
                              sending ||
                              controlsBlocked ||
                              (!agent.isActive && !joined)
                            }
                            onClick={() => void toggle(agent, joined)}
                            className="min-h-11 h-auto flex-1 whitespace-normal px-2 text-xs"
                          >
                            {joined && (
                              <Check
                                size={14}
                                aria-hidden
                                className="me-1 shrink-0"
                              />
                            )}
                            {joined ? c.leave : c.join}
                          </Button>
                          <Link
                            href={`/agents/${agent.id}?tab=chat&from=conversations`}
                            aria-label={agent.name + " · " + c.openChat}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ArrowRight
                              size={17}
                              className="rtl:rotate-180"
                              aria-hidden
                            />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function Message({
  message,
  agent,
  copy: c,
  locale,
}: {
  message: CompanyMessage;
  agent?: Agent;
  copy: CompanyRoomCopy;
  locale: Locale;
}) {
  const founder = message.senderType === "founder";
  const sender = founder
    ? c.founder
    : message.senderName || agent?.name || c.agent;
  const source =
    message.source === "operator"
      ? c.operatorMessage
      : message.source === "agent_tool"
        ? c.projectNote
        : c.roomReply;
  const date = new Date(message.createdAt);
  return (
    <article
      className={cn(
        "flex items-start gap-[8px]",
        founder && "flex-row-reverse",
      )}
      aria-label={sender}
    >
      <span
        aria-hidden
        className="flex size-[32px] shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        {founder ? <Building2 size={16} /> : <Bot size={16} />}
      </span>
      <div
        className={cn(
          "min-w-0 max-w-[90%] rounded-xl border p-[12px] sm:max-w-[85%] sm:p-3",
          founder ? "bg-primary/5" : "bg-background",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <bdi className="font-semibold">{sender}</bdi>
          <span className="text-muted-foreground">{source}</span>
          <time dateTime={message.createdAt} className="text-muted-foreground">
            <bdi>
              {Number.isFinite(date.getTime())
                ? date.toLocaleString(locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "—"}
            </bdi>
          </time>
        </div>
        <p
          dir="auto"
          className="mt-2 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]"
        >
          {message.content}
        </p>
        {message.taskId && (
          <Link
            href={`/projects/${message.taskId}`}
            className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm text-primary"
          >
            {c.project} · #{message.taskId}
          </Link>
        )}
      </div>
    </article>
  );
}
