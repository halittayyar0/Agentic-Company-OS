import { ActivitySummary } from "@/components/activity-summary";
import { DelegationRecord } from "@/components/tasks/delegation-conversation";
import { TraceCopyBoundary } from "@/components/tasks/trace-shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetCompanyChannelQueryKey,
  getListActivityQueryKey,
  getListCompanyMessagesQueryKey,
  getListTaskActivityQueryKey,
  getListTasksQueryKey,
  useGetCompanyChannel,
  useListActivity,
  useListCompanyMessages,
  useListTaskActivity,
  useListTasks,
  type ActivityEvent,
  type Agent,
  type CompanyMeetingSkip,
  type CompanyMessage,
  type Task,
} from "@workspace/api-client-react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  AtSign,
  Bot,
  Building2,
  ChevronRight,
  Clock3,
  Hash,
  MessageCircleMore,
  Network,
  Radio,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { CompanyRoomComposer } from "@/components/company/company-room-composer";
import roomCopy from "@/lib/company-room-copy/room-tr";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ACTIVITY_TYPE_ICON_HINT,
  TASK_STATUS_META,
  timeAgo,
} from "@/lib/format";
import {
  buildDelegationMessages,
  type DelegationMessage,
} from "@/lib/delegation-conversation";
import { cn } from "@/lib/utils";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { adaptivePollingInterval } from "@/lib/adaptive-polling";
import {
  companyRoomMembersQueryKey,
  listCompanyRoomMembers,
  sendCompanyRoomMessage,
  type SendCompanyRoomMessageInput,
} from "@/lib/company-room";

type CompanyCommsDockProps = {
  agents: Agent[];
  selectedAgentId: number | null;
  onSelectAgent?: (agentId: number) => void;
};

type DockTabValue = "channel" | "command" | "live";

const MESSAGE_PARAMS = { limit: 100 } as const;
const ACTIVITY_PARAMS = { limit: 40 } as const;
const TASK_ACTIVITY_PARAMS = { limit: 200 } as const;
const COMMAND_TASK_PARAMS = { limit: 200 } as const;
const ACTIVE_DELEGATION_STATUSES = new Set<Task["status"]>([
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
  "blocked",
]);

const SKIP_REASON: Record<CompanyMeetingSkip["reason"], string> = {
  busy: "başka bir işte",
  unavailable: "erişilemiyor",
  empty_response: "yanıt vermedi",
  model_error: "model hatası",
  not_relevant: "katkısı olmadığı için yanıtlamadı",
  not_mentioned: "bu mesajda çağrılmadı",
  budget_guard: "bütçe koruması nedeniyle atlandı",
};

export function CompanyCommsDock({
  agents,
  selectedAgentId,
  onSelectAgent,
}: CompanyCommsDockProps) {
  const documentVisible = useDocumentVisible();
  const [mobileExpanded, setMobileExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<DockTabValue>("channel");
  const [messageStreamError, setMessageStreamError] = useState(false);
  const previousSelectedAgentId = useRef(selectedAgentId);
  const hasInitialSelection = useRef(selectedAgentId !== null);
  const workingCount = agents.filter(
    (agent) => agent.status === "working",
  ).length;
  const channel = useGetCompanyChannel({
    query: {
      queryKey: getGetCompanyChannelQueryKey(),
      refetchInterval: adaptivePollingInterval({
        documentVisible,
        live: workingCount > 0,
        liveMs: 10_000,
        idleMs: 20_000,
      }),
    },
  });
  const channelOffline = channel.isError || messageStreamError;
  const channelConnecting = channel.isLoading && !channel.data;

  useEffect(() => {
    if (!hasInitialSelection.current) {
      if (selectedAgentId !== null) {
        hasInitialSelection.current = true;
        previousSelectedAgentId.current = selectedAgentId;
      }
      return;
    }

    if (
      selectedAgentId !== null &&
      selectedAgentId !== previousSelectedAgentId.current
    ) {
      setActiveTab("command");
    }
    previousSelectedAgentId.current = selectedAgentId;
  }, [selectedAgentId]);

  return (
    <aside
      aria-label="Şirket iletişim merkezi"
      className={cn(
        "relative z-20 flex w-full shrink-0 flex-col overflow-hidden rounded-[1.65rem] border border-border/80 bg-card/92 shadow-[0_24px_80px_-38px_hsl(var(--foreground)/.5)] backdrop-blur-xl transition-[height] duration-300",
        "max-xl:max-h-[700px]",
        mobileExpanded ? "h-[72svh]" : "h-[18.5rem]",
        "xl:sticky xl:top-4 xl:h-[calc(100dvh-8rem)] xl:min-h-[600px] xl:max-h-[820px] xl:w-[22.5rem]",
      )}
    >
      <button
        type="button"
        onClick={() => setMobileExpanded((expanded) => !expanded)}
        className="group flex h-6 shrink-0 items-center justify-center border-b border-border/60 bg-secondary/35 xl:hidden"
        aria-expanded={mobileExpanded}
        aria-label={
          mobileExpanded
            ? "İletişim panelini daralt"
            : "İletişim panelini büyüt"
        }
      >
        <span className="h-1 w-10 rounded-full bg-muted-foreground/25 transition-colors group-hover:bg-muted-foreground/50" />
        {mobileExpanded ? (
          <ArrowDown
            size={12}
            className="absolute right-4 text-muted-foreground"
          />
        ) : (
          <ArrowUp
            size={12}
            className="absolute right-4 text-muted-foreground"
          />
        )}
      </button>

      <div className="relative shrink-0 overflow-hidden border-b border-border/70 px-4 pb-3 pt-4">
        <div className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className={cn(
                "flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.2em]",
                channelOffline
                  ? "text-amber-600 dark:text-amber-300"
                  : channelConnecting
                    ? "text-muted-foreground"
                    : "text-emerald-600 dark:text-emerald-300",
              )}
              role="status"
            >
              <span className="relative flex size-2">
                {!channelOffline && !channelConnecting ? (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:animate-none" />
                ) : null}
                <span
                  className={cn(
                    "relative inline-flex size-2 rounded-full",
                    channelOffline
                      ? "bg-amber-500"
                      : channelConnecting
                        ? "bg-slate-400"
                        : "bg-emerald-500",
                  )}
                />
              </span>
              {channelOffline
                ? "Şirket frekansı çevrimdışı"
                : channelConnecting
                  ? "Şirket frekansına bağlanıyor"
                  : "Şirket frekansı canlı"}
            </div>
            <h2 className="mt-1.5 truncate text-base font-black tracking-[-0.025em]">
              {channel.data?.name ?? "İletişim Merkezi"}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-2.5 py-1.5 text-[12px] font-bold text-muted-foreground shadow-sm">
            <UsersRound size={11} />
            <span>{channel.data?.activeAgentCount ?? agents.length}</span>
            <span className="text-border">/</span>
            <Zap size={10} className="text-emerald-500" />
            <span>{workingCount}</span>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as DockTabValue)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="grid h-12 w-full shrink-0 grid-cols-3 rounded-none border-b border-border/70 bg-secondary/25 p-1.5">
          <DockTab value="channel" icon={Hash} label="Ortak" />
          <DockTab value="command" icon={Network} label="Komuta" />
          <DockTab value="live" icon={Activity} label="Canlı" />
        </TabsList>

        <TabsContent
          forceMount
          value="channel"
          className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          <CompanyChannelPanel
            agents={agents}
            active={activeTab === "channel"}
            onErrorChange={setMessageStreamError}
            onSelectAgent={onSelectAgent}
          />
        </TabsContent>

        <TabsContent value="command" className="mt-0 min-h-0 flex-1">
          <CommandLinePanel
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
          />
        </TabsContent>

        <TabsContent value="live" className="mt-0 min-h-0 flex-1">
          <LiveActivityPanel
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function DockTab({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: typeof Hash;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="group h-9 gap-1.5 rounded-xl px-2 text-[12px] font-extrabold data-[state=active]:bg-background data-[state=active]:shadow-sm"
    >
      <Icon
        size={13}
        className="text-muted-foreground group-data-[state=active]:text-primary"
      />
      {label}
    </TabsTrigger>
  );
}

function CompanyChannelPanel({
  agents,
  active,
  onErrorChange,
  onSelectAgent,
}: {
  agents: Agent[];
  active: boolean;
  onErrorChange: (error: boolean) => void;
  onSelectAgent?: (agentId: number) => void;
}) {
  const documentVisible = useDocumentVisible();
  const [draft, setDraft] = useState("");
  const [skipped, setSkipped] = useState<CompanyMeetingSkip[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const followLatestMessage = useRef(true);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const messages = useListCompanyMessages(MESSAGE_PARAMS, {
    query: {
      queryKey: getListCompanyMessagesQueryKey(MESSAGE_PARAMS),
      refetchInterval: adaptivePollingInterval({
        active,
        documentVisible,
        live: agents.some((agent) => agent.status === "working"),
        liveMs: 5_000,
      }),
    },
  });
  const members = useQuery({
    queryKey: companyRoomMembersQueryKey,
    queryFn: listCompanyRoomMembers,
    refetchInterval: adaptivePollingInterval({
      active,
      documentVisible,
      live: agents.some((agent) => agent.status === "working"),
      liveMs: 10_000,
    }),
  });
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const lastMessageId = messages.data?.at(-1)?.id ?? null;

  useEffect(() => {
    onErrorChange(messages.isError);
  }, [messages.isError, onErrorChange]);

  useEffect(() => {
    const log = logRef.current;
    if (
      !active ||
      !log ||
      lastMessageId === null ||
      !followLatestMessage.current
    )
      return;

    const frame = window.requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, lastMessageId]);

  const sendMessage = useMutation({
    mutationFn: ({
      content,
      mentionedAgentIds,
    }: {
      content: string;
      mentionedAgentIds: number[];
    }) =>
      sendCompanyRoomMessage({
        content,
        mentionedAgentIds,
      } satisfies SendCompanyRoomMessageInput),
    onSuccess: (response) => {
      setDraft("");
      setSkipped(response.skippedParticipants);
      void queryClient.invalidateQueries({
        queryKey: getListCompanyMessagesQueryKey(MESSAGE_PARAMS),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetCompanyChannelQueryKey(),
      });
      toast({
        title: "Mesaj şirket odasında",
        description: response.agentMessages.length
          ? `${response.agentMessages.length} üye katkı sundu.`
          : "Mesaj kalıcı oda kaydına eklendi.",
      });
    },
    onError: (error) =>
      toast({
        title: "Mesaj gönderilemedi",
        description:
          error instanceof Error ? error.message : "Bağlantıyı kontrol edin.",
        variant: "destructive",
      }),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/55 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Radio size={11} className="shrink-0 text-emerald-500" />
          <span className="truncate text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            yalnızca kayıtlı mesajlar
          </span>
        </div>
        <button
          type="button"
          onClick={() => void messages.refetch()}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Ortak kanalı yenile"
        >
          <RefreshCw
            size={12}
            className={cn(messages.isFetching && "animate-spin")}
          />
        </button>
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const log = event.currentTarget;
          followLatestMessage.current =
            log.scrollHeight - log.scrollTop - log.clientHeight < 48;
        }}
        className="scrollbar-slim min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/.045),transparent_42%)] p-3"
      >
        {messages.isLoading ? (
          <ChannelSkeleton />
        ) : messages.isError ? (
          <InlineState
            icon={MessageCircleMore}
            title="Ortak kanal alınamadı"
            action="Yenile"
            onAction={() => void messages.refetch()}
          />
        ) : (messages.data?.length ?? 0) === 0 ? (
          <InlineState
            icon={UsersRound}
            title="Şirket meydanı sessiz"
            description="İlk kurucu notunu yaz veya bir oda üyesini @ ile çağır."
          />
        ) : (
          messages.data?.map((message) => (
            <CompactCompanyMessage
              key={message.id}
              message={message}
              agent={
                message.senderAgentId === null
                  ? undefined
                  : agentsById.get(message.senderAgentId)
              }
              onSelectAgent={onSelectAgent}
            />
          ))
        )}
      </div>

      <div className="shrink-0 min-w-0 border-t border-border/70 bg-background/78 p-3">
        {members.isSuccess ? (
          <div
            className="scrollbar-none -mx-1 mb-2 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1"
            aria-label="Şirket odası üyeleri"
          >
            {members.data.map((member) => {
              const agent = agentsById.get(member.agentId);
              return agent ? (
                <div
                  key={member.agentId}
                  className="shrink-0 rounded-xl border border-border bg-secondary/35 p-1"
                  title={`${member.name} · oda üyesi`}
                >
                  <AgentAvatar agent={agent} size="xs" showStatus />
                </div>
              ) : null;
            })}
            <Link
              href="/company-chat"
              className="inline-flex shrink-0 items-center px-2 text-[12px] font-bold text-primary hover:underline"
            >
              üyeleri yönet
            </Link>
          </div>
        ) : null}

        {skipped.length > 0 ? (
          <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-2 py-1.5 text-[12px] leading-relaxed text-amber-700 dark:text-amber-200">
            <Clock3 size={10} className="mt-0.5 shrink-0" />
            <span>
              {skipped
                .map(
                  (entry) =>
                    `${agentsById.get(entry.agentId)?.name ?? `#${entry.agentId}`} ${SKIP_REASON[entry.reason]}`,
                )
                .join(" · ")}
            </span>
            <button
              type="button"
              aria-label="Uyarıyı kapat"
              onClick={() => setSkipped([])}
              className="ml-auto shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ) : null}

        <CompanyRoomComposer
          copy={roomCopy}
          value={draft}
          onChange={setDraft}
          members={members.data ?? []}
          agentsById={agentsById}
          onSubmit={(content, mentionedAgentIds) =>
            sendMessage.mutate({ content, mentionedAgentIds })
          }
          pending={sendMessage.isPending}
          disabled={members.isError}
          compact
        />
        {members.isError ? (
          <p className="mt-2 text-[12px] leading-4 text-amber-700 dark:text-amber-300">
            Oda üyeleri alınamadı. Üyeleri yenilemek için Şirket Odası'nı aç.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CompactCompanyMessage({
  message,
  agent,
  onSelectAgent,
}: {
  message: CompanyMessage;
  agent?: Agent;
  onSelectAgent?: (agentId: number) => void;
}) {
  const founder = message.senderType === "founder";
  const source = message.source as string;
  const sourceLabel =
    source === "room_reply" || source === "meeting"
      ? "oda yanıtı"
      : source === "agent_tool"
        ? "sahadan"
        : "kurucu";
  const sender = founder
    ? "Kurucu"
    : message.senderName || agent?.name || "Ajan";

  return (
    <article className={cn("flex items-end gap-2", founder && "justify-end")}>
      {!founder ? (
        agent ? (
          <button
            type="button"
            onClick={() => onSelectAgent?.(agent.id)}
            className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`${agent.name} çalışanını seç`}
          >
            <AgentAvatar agent={agent} size="xs" showStatus />
          </button>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
            <Bot size={13} />
          </span>
        )
      ) : null}

      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl border px-3 py-2.5 shadow-sm",
          founder
            ? "rounded-br-sm border-primary/20 bg-primary/[0.075]"
            : message.source === "agent_tool"
              ? "rounded-bl-sm border-cyan-500/20 bg-cyan-500/[0.055]"
              : "rounded-bl-sm border-border/80 bg-background/86",
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="truncate text-[12px] font-black">{sender}</span>
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[12px] font-black uppercase tracking-[0.12em] text-muted-foreground">
            {sourceLabel}
          </span>
          <time
            className="font-mono text-[12px] text-muted-foreground/65"
            dateTime={message.createdAt}
          >
            {timeAgo(message.createdAt)}
          </time>
        </div>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-foreground/88">
          {message.content}
        </p>
        {message.taskId ? (
          <Link
            href={`/projects/${message.taskId}`}
            className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline"
          >
            <Workflow size={9} /> görev #{message.taskId}
          </Link>
        ) : null}
      </div>

      {founder ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
          <Building2 size={13} />
        </span>
      ) : null}
    </article>
  );
}

function compareDelegations(left: Task, right: Task): number {
  const activeDifference =
    Number(ACTIVE_DELEGATION_STATUSES.has(right.status)) -
    Number(ACTIVE_DELEGATION_STATUSES.has(left.status));
  if (activeDifference !== 0) return activeDifference;

  const updatedDifference =
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  if (updatedDifference !== 0) return updatedDifference;
  return right.id - left.id;
}

function CommandLinePanel({
  agents,
  selectedAgentId,
  onSelectAgent,
}: CompanyCommsDockProps) {
  const documentVisible = useDocumentVisible();
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const tasks = useListTasks(COMMAND_TASK_PARAMS, {
    query: {
      enabled: selectedAgentId !== null,
      queryKey: getListTasksQueryKey(COMMAND_TASK_PARAMS),
      refetchInterval: adaptivePollingInterval({
        active: selectedAgentId !== null,
        documentVisible,
        live: selectedAgent?.status === "working",
        liveMs: 6_000,
      }),
    },
  });
  const delegatedTask = useMemo(
    () =>
      (tasks.data ?? [])
        .filter(
          (task) =>
            task.assignedByAgentId !== null &&
            (task.ownerAgentId === selectedAgentId ||
              task.assignedByAgentId === selectedAgentId),
        )
        .sort(compareDelegations)[0],
    [selectedAgentId, tasks.data],
  );
  const activityTaskId = delegatedTask?.id ?? 0;
  const activity = useListTaskActivity(activityTaskId, TASK_ACTIVITY_PARAMS, {
    query: {
      enabled: Boolean(delegatedTask),
      queryKey: getListTaskActivityQueryKey(
        activityTaskId,
        TASK_ACTIVITY_PARAMS,
      ),
      refetchInterval: adaptivePollingInterval({
        active: Boolean(delegatedTask),
        documentVisible,
        live: ACTIVE_DELEGATION_STATUSES.has(
          delegatedTask?.status ?? "completed",
        ),
        liveMs: 5_000,
      }),
    },
  });
  const manager = delegatedTask
    ? agents.find((agent) => agent.id === delegatedTask.assignedByAgentId)
    : undefined;
  const employee = delegatedTask
    ? agents.find((agent) => agent.id === delegatedTask.ownerAgentId)
    : undefined;
  const dialogue = delegatedTask
    ? buildDelegationMessages(delegatedTask, activity.data ?? [])
    : [];

  if (!selectedAgentId || !selectedAgent) {
    return (
      <InlineState
        icon={AtSign}
        title="Bir çalışan seç"
        description="Kadrodan bir çalışana dokun; en güncel gerçek komuta hattı burada açılır."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/65 bg-secondary/20 p-3">
        <div className="flex items-center gap-2.5">
          <AgentAvatar agent={selectedAgent} size="sm" showStatus />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black">{selectedAgent.name}</p>
            <p className="truncate text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {selectedAgent.role}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-2 py-1 text-[12px] font-black uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">
            <ShieldCheck size={9} /> gerçek kayıt
          </span>
        </div>
      </div>

      {tasks.isLoading || (delegatedTask && activity.isLoading) ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-24 w-4/5 rounded-2xl" />
          <Skeleton className="ml-auto h-20 w-3/4 rounded-2xl" />
        </div>
      ) : tasks.isError || activity.isError ? (
        <InlineState
          icon={Network}
          title="Komuta kayıtları alınamadı"
          action="Yenile"
          onAction={() => {
            void tasks.refetch();
            if (delegatedTask) void activity.refetch();
          }}
        />
      ) : !delegatedTask || !manager || !employee ? (
        <InlineState
          icon={Network}
          title="Kayıtlı devir yok"
          description={`${selectedAgent.name} için bir yönetici tarafından devredilmiş görev bulunamadı.`}
        />
      ) : (
        <DelegationThread
          task={delegatedTask}
          manager={manager}
          employee={employee}
          messages={dialogue}
          onSelectAgent={onSelectAgent}
        />
      )}
    </div>
  );
}

function DelegationThread({
  task,
  manager,
  employee,
  messages,
  onSelectAgent,
}: {
  task: Task;
  manager: Agent;
  employee: Agent;
  messages: DelegationMessage[];
  onSelectAgent?: (agentId: number) => void;
}) {
  const status = TASK_STATUS_META[task.status];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Link
        href={`/projects/${task.id}`}
        className="group shrink-0 border-b border-border/60 px-3 py-3 transition-colors hover:bg-secondary/30"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onSelectAgent?.(manager.id);
            }}
            className="rounded-lg"
            title={`${manager.name} çalışanını seç`}
          >
            <AgentAvatar agent={manager} size="xs" showStatus />
          </button>
          <div className="relative h-px flex-1 bg-gradient-to-r from-primary/40 via-primary to-emerald-500/45">
            <ChevronRight
              size={12}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background text-primary"
            />
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onSelectAgent?.(employee.id);
            }}
            className="rounded-lg"
            title={`${employee.name} çalışanını seç`}
          >
            <AgentAvatar agent={employee} size="xs" showStatus />
          </button>
        </div>
        <div className="mt-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-black group-hover:text-primary">
              {task.title}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {manager.name} → {employee.name} · görev #{task.id}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[12px] font-black uppercase",
              status.className,
            )}
          >
            {status.label}
          </span>
        </div>
      </Link>

      <ol
        className="scrollbar-slim min-h-0 flex-1 space-y-3 overflow-y-auto bg-[linear-gradient(90deg,transparent_31px,hsl(var(--border)/.5)_32px,transparent_33px)] p-3"
        aria-label={`${task.title} komuta konuşması`}
      >
        {messages.map((message) => (
          <CompactDelegationMessage
            key={message.key}
            message={message}
            manager={manager}
            employee={employee}
          />
        ))}
      </ol>
    </div>
  );
}

function CompactDelegationMessage({
  message,
  manager,
  employee,
}: {
  message: DelegationMessage;
  manager: Agent;
  employee: Agent;
}) {
  return (
    <TraceCopyBoundary>
      {(c) => (
        <DelegationRecord
          message={message}
          agents={[manager, employee]}
          c={c}
        />
      )}
    </TraceCopyBoundary>
  );
}

function LiveActivityPanel({
  agents,
  selectedAgentId,
  onSelectAgent,
}: CompanyCommsDockProps) {
  const documentVisible = useDocumentVisible();
  const activities = useListActivity(ACTIVITY_PARAMS, {
    query: {
      queryKey: getListActivityQueryKey(ACTIVITY_PARAMS),
      refetchInterval: adaptivePollingInterval({
        documentVisible,
        live: true,
      }),
    },
  });
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2.5">
        <div>
          <p className="text-[12px] font-black">Operasyon telemetrisi</p>
          <p
            className={cn(
              "text-[12px]",
              activities.isError
                ? "text-amber-600 dark:text-amber-300"
                : "text-muted-foreground",
            )}
          >
            {activities.isError
              ? "Canlı kayıt bağlantısı kesildi"
              : "4 saniyede bir gerçek kayıt"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] font-black",
            activities.isError
              ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-600 dark:text-amber-300"
              : "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-300",
          )}
          role="status"
        >
          <Radio
            size={8}
            className={cn(
              !activities.isError && "animate-pulse motion-reduce:animate-none",
            )}
          />
          {activities.isError ? "OFFLINE" : "LIVE"}
        </span>
      </div>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-3">
        {activities.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : activities.isError ? (
          <InlineState
            icon={Activity}
            title="Canlı akış alınamadı"
            action="Yenile"
            onAction={() => void activities.refetch()}
          />
        ) : (activities.data?.length ?? 0) === 0 ? (
          <InlineState icon={Radio} title="Henüz operasyon sinyali yok" />
        ) : (
          <ol className="relative space-y-1.5 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-gradient-to-b before:from-primary/35 before:via-border before:to-transparent">
            {activities.data?.map((event) => (
              <CompactActivityEvent
                key={event.id}
                event={event}
                agent={
                  event.agentId === null
                    ? undefined
                    : agentsById.get(event.agentId)
                }
                selected={
                  event.agentId !== null && event.agentId === selectedAgentId
                }
                onSelectAgent={onSelectAgent}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function CompactActivityEvent({
  event,
  agent,
  selected,
  onSelectAgent,
}: {
  event: ActivityEvent;
  agent?: Agent;
  selected: boolean;
  onSelectAgent?: (agentId: number) => void;
}) {
  const toolEvent = event.type === "vm_command" || event.type === "vm_file";

  return (
    <li
      className={cn(
        "group relative ml-8 rounded-xl border p-2.5 transition-colors",
        selected
          ? "border-primary/25 bg-primary/[0.055]"
          : "border-transparent hover:border-border hover:bg-secondary/30",
      )}
    >
      <span
        className={cn(
          "absolute -left-[25px] top-4 z-10 size-2.5 rounded-full border-2 border-background",
          event.severity === "critical"
            ? "bg-rose-500"
            : event.severity === "warning"
              ? "bg-amber-500"
              : toolEvent
                ? "bg-cyan-500"
                : "bg-emerald-500",
        )}
      />
      <div className="flex items-start gap-2">
        {agent ? (
          <button
            type="button"
            onClick={() => onSelectAgent?.(agent.id)}
            className="shrink-0 rounded-lg"
            title={`${agent.name} çalışanını seç`}
          >
            <AgentAvatar agent={agent} size="xs" showStatus />
          </button>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            {toolEvent ? <TerminalSquare size={12} /> : <Radio size={12} />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12px] font-black">
              {agent?.name ?? "Sistem"}
            </span>
            <time
              className="shrink-0 font-mono text-[12px] text-muted-foreground/60"
              dateTime={event.createdAt}
            >
              {timeAgo(event.createdAt)}
            </time>
          </div>
          <p className="mt-0.5 break-words text-[12px] leading-[1.45] text-foreground/85">
            <ActivitySummary event={event} />
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.09em] text-muted-foreground/65">
            <span
              className={cn(toolEvent && "text-cyan-600 dark:text-cyan-300")}
            >
              {ACTIVITY_TYPE_ICON_HINT[event.type] ?? event.type}
            </span>
            {event.taskId ? (
              <Link
                href={`/projects/${event.taskId}`}
                className="normal-case tracking-normal text-primary hover:underline"
              >
                görev #{event.taskId}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function ChannelSkeleton() {
  return (
    <div
      className="space-y-3"
      aria-label="Ortak kanal yükleniyor"
      role="status"
    >
      <Skeleton className="h-20 w-4/5 rounded-2xl" />
      <Skeleton className="ml-auto h-16 w-3/4 rounded-2xl" />
      <Skeleton className="h-24 w-[86%] rounded-2xl" />
    </div>
  );
}

function InlineState({
  icon: Icon,
  title,
  description,
  action,
  onAction,
}: {
  icon: typeof Hash;
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center px-7 text-center">
      <span className="mb-3 flex size-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.06] text-primary shadow-inner">
        <Icon size={19} />
      </span>
      <p className="text-xs font-black">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[16rem] text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 text-[12px] font-bold text-primary underline underline-offset-4"
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}
