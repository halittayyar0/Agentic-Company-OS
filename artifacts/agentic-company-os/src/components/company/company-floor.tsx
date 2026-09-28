import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@workspace/api-client-react";
import {
  getGetAgentQueryKey,
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  GripVertical,
  Laptop,
  MessageCircle,
  Move3d,
  Network,
  Pencil,
  RotateCcw,
  Save,
  UsersRound,
  X,
} from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { AgentStatusPill } from "@/components/fx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { controlPlaneFetch } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type MoveRequest = { agentId: number; parentAgentId: number | null };
type RenameRequest = { agentId: number; name: string; previousName: string };

export function CompanyFloor({ agents }: { agents: Agent[] }) {
  const hierarchy = useMemo(() => buildHierarchy(agents), [agents]);
  const ceo =
    hierarchy.roots.find((agent) => agent.templateKey === "ceo") ??
    hierarchy.roots[0];
  const team = agents.filter((agent) => agent.id !== ceo?.id);

  const [organizeMode, setOrganizeMode] = useState(false);
  const [draggedAgentId, setDraggedAgentId] = useState<number | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    ceo ? String(ceo.id) : "root",
  );
  const [renamingAgentId, setRenamingAgentId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const refreshAgentQueries = (agentId: number) => {
    void queryClient.invalidateQueries({
      queryKey: getListAgentsQueryKey({ includeInactive: false }),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetAgentQueryKey(agentId),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetOrgSummaryQueryKey(),
    });
  };

  const moveAgent = useMutation({
    mutationFn: ({ agentId, parentAgentId }: MoveRequest) =>
      controlPlaneFetch<Agent>(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentAgentId }),
      }),
    onSuccess: (updated) => {
      refreshAgentQueries(updated.id);
      toast({
        title: "Komuta zinciri güncellendi",
        description: `${updated.name} yeni yöneticisine bağlandı.`,
      });
      setDraggedAgentId(null);
    },
    onError: (error) => {
      toast({
        title: "Raporlama hattı değiştirilemedi",
        description:
          error instanceof Error
            ? error.message
            : "Komuta zincirini kontrol edip yeniden deneyin.",
        variant: "destructive",
      });
      setDraggedAgentId(null);
    },
  });

  const renameAgent = useMutation({
    mutationFn: ({ agentId, name }: RenameRequest) =>
      controlPlaneFetch<Agent>(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: (updated, request) => {
      refreshAgentQueries(updated.id);
      toast({
        title: "Ajanın adı değiştirildi",
        description: `${request.previousName} artık ${updated.name} adıyla görünecek.`,
      });
      setRenamingAgentId(null);
      setRenameDraft("");
    },
    onError: (error) => {
      toast({
        title: "Ajanın adı değiştirilemedi",
        description:
          error instanceof Error
            ? error.message
            : "Adı kontrol edip yeniden deneyin.",
        variant: "destructive",
      });
    },
  });

  const selectedAgent = selectedAgentId
    ? hierarchy.byId.get(Number(selectedAgentId))
    : undefined;
  const unavailableManagerIds = useMemo(() => {
    if (!selectedAgent) return new Set<number>();
    return collectDescendantIds(selectedAgent.id, hierarchy.childrenByParent);
  }, [hierarchy.childrenByParent, selectedAgent]);

  const requestedParentAgentId =
    selectedManagerId === "root" ? null : Number(selectedManagerId);
  const managerSelectionValid =
    selectedManagerId === "root" ||
    (Number.isFinite(requestedParentAgentId) &&
      !unavailableManagerIds.has(requestedParentAgentId as number));
  const managerChanged =
    selectedAgent !== undefined &&
    selectedAgent.parentAgentId !== requestedParentAgentId;

  const move = (agentId: number, parentAgentId: number | null) => {
    if (agentId === parentAgentId || moveAgent.isPending) return;
    moveAgent.mutate({ agentId, parentAgentId });
  };

  const selectAgentToMove = (value: string) => {
    setSelectedAgentId(value);
    const agent = hierarchy.byId.get(Number(value));
    const nextManagerId = agent?.parentAgentId ?? ceo?.id ?? null;
    setSelectedManagerId(
      nextManagerId === null ? "root" : String(nextManagerId),
    );
  };

  const startRename = (agent: Agent) => {
    setRenamingAgentId(agent.id);
    setRenameDraft(agent.name);
  };
  const cancelRename = () => {
    if (renameAgent.isPending) return;
    setRenamingAgentId(null);
    setRenameDraft("");
  };
  const submitRename = (event: FormEvent<HTMLFormElement>, agent: Agent) => {
    event.preventDefault();
    const name = renameDraft.trim();
    if (!name) {
      toast({
        title: "Ajan adı boş bırakılamaz",
        description: "Kaydetmeden önce görünür bir ad yazın.",
        variant: "destructive",
      });
      return;
    }
    if (name === agent.name) {
      cancelRename();
      return;
    }
    renameAgent.mutate({ agentId: agent.id, name, previousName: agent.name });
  };

  const toggleOrganizeMode = () => {
    if (organizeMode) {
      cancelRename();
      setDraggedAgentId(null);
    }
    setOrganizeMode((value) => !value);
  };

  return (
    <section className="company-floor overflow-hidden rounded-[1.6rem] border border-card-border bg-card/72 shadow-md">
      <header className="flex flex-col gap-4 border-b border-border/80 px-5 py-5 md:flex-row md:items-center md:justify-between md:px-7">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Network size={18} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold tracking-[-0.025em]">
                Komuta zinciri
              </h2>
              <span className="rounded-full border border-border bg-secondary/55 px-2 py-0.5 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {agents.length} çalışan ·{" "}
                {agents.filter((agent) => agent.status === "working").length}{" "}
                sahada
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Komut CEO'dan başlayıp yukarıdan aşağı akar. Kartları izleyerek
              kimin kime rapor verdiğini görebilirsin.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant={organizeMode ? "default" : "outline"}
          size="sm"
          className="gap-2 self-start md:self-auto"
          onClick={toggleOrganizeMode}
        >
          {organizeMode ? <Check size={14} /> : <Move3d size={14} />}
          {organizeMode ? "Düzenlemeyi bitir" : "Kadroyu düzenle"}
        </Button>
      </header>

      {organizeMode ? (
        <div className="border-b border-primary/15 bg-primary/[0.045] px-5 py-4 md:px-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground/85">
              Raporlama hattını değiştir
            </p>
            <p className="text-[12px] text-muted-foreground">
              Kartı yöneticinin üzerine sürükle · adı değiştirmek için kaleme
              bas
            </p>
          </div>
          <div className="grid gap-2 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto]">
            <Select value={selectedAgentId} onValueChange={selectAgentToMove}>
              <SelectTrigger aria-label="Taşınacak çalışan">
                <SelectValue placeholder="Çalışanı seç" />
              </SelectTrigger>
              <SelectContent>
                {team.map((agent) => (
                  <SelectItem key={agent.id} value={String(agent.id)}>
                    {agent.name} · {agent.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedManagerId}
              onValueChange={setSelectedManagerId}
            >
              <SelectTrigger aria-label="Yeni yönetici">
                <SelectValue placeholder="Yeni yöneticiyi seç" />
              </SelectTrigger>
              <SelectContent>
                {ceo ? (
                  <SelectItem
                    value={String(ceo.id)}
                    disabled={unavailableManagerIds.has(ceo.id)}
                  >
                    {ceo.name} · CEO (doğrudan)
                  </SelectItem>
                ) : (
                  <SelectItem value="root">Kurucuya doğrudan bağlı</SelectItem>
                )}
                {team.map((agent) => (
                  <SelectItem
                    key={agent.id}
                    value={String(agent.id)}
                    disabled={unavailableManagerIds.has(agent.id)}
                  >
                    {agent.name} · {agent.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={
                !selectedAgent ||
                !managerSelectionValid ||
                !managerChanged ||
                moveAgent.isPending
              }
              onClick={() =>
                selectedAgent &&
                move(selectedAgent.id, requestedParentAgentId as number | null)
              }
              className="gap-1.5"
            >
              {moveAgent.isPending ? (
                <RotateCcw size={13} className="animate-spin" />
              ) : (
                <ArrowRight size={13} />
              )}
              Yeni yöneticiye bağla
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto p-4 md:p-6">
        <div className="mx-auto flex w-max min-w-full items-start justify-center gap-8">
          {hierarchy.roots.map((root) => (
            <CommandBranch
              key={root.id}
              agent={root}
              ceoId={ceo?.id}
              childrenByParent={hierarchy.childrenByParent}
              organizeMode={organizeMode}
              draggedAgentId={draggedAgentId}
              renamingAgentId={renamingAgentId}
              renameDraft={renameDraft}
              movePending={moveAgent.isPending}
              renamePending={renameAgent.isPending}
              onDragStart={setDraggedAgentId}
              onDragEnd={() => setDraggedAgentId(null)}
              onDropAgent={move}
              onStartRename={startRename}
              onRenameDraftChange={setRenameDraft}
              onCancelRename={cancelRename}
              onSubmitRename={submitRename}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CommandBranch({
  agent,
  ceoId,
  childrenByParent,
  organizeMode,
  draggedAgentId,
  renamingAgentId,
  renameDraft,
  movePending,
  renamePending,
  onDragStart,
  onDragEnd,
  onDropAgent,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onSubmitRename,
  path = new Set<number>(),
}: {
  agent: Agent;
  ceoId?: number;
  childrenByParent: ReadonlyMap<number, Agent[]>;
  organizeMode: boolean;
  draggedAgentId: number | null;
  renamingAgentId: number | null;
  renameDraft: string;
  movePending: boolean;
  renamePending: boolean;
  onDragStart: (agentId: number | null) => void;
  onDragEnd: () => void;
  onDropAgent: (agentId: number, parentAgentId: number | null) => void;
  onStartRename: (agent: Agent) => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>, agent: Agent) => void;
  path?: ReadonlySet<number>;
}) {
  if (path.has(agent.id)) return null;
  const nextPath = new Set(path).add(agent.id);
  const children = (childrenByParent.get(agent.id) ?? []).filter(
    (child) => !nextPath.has(child.id),
  );
  const featured = agent.id === ceoId;

  return (
    <div className="flex w-full flex-col items-center md:w-max">
      <AgentWorkstation
        agent={agent}
        featured={featured}
        directReportCount={children.length}
        organizeMode={organizeMode}
        draggable={agent.id !== ceoId && !movePending}
        dragged={draggedAgentId === agent.id}
        renaming={renamingAgentId === agent.id}
        renameDraft={renameDraft}
        renamePending={renamePending}
        onDragStart={() => onDragStart(agent.id)}
        onDragEnd={onDragEnd}
        onDropAgent={(agentId) => onDropAgent(agentId, agent.id)}
        onStartRename={() => onStartRename(agent)}
        onRenameDraftChange={onRenameDraftChange}
        onCancelRename={onCancelRename}
        onSubmitRename={(event) => onSubmitRename(event, agent)}
      />

      {children.length > 0 ? (
        <>
          <div
            aria-hidden="true"
            className="h-5 w-px bg-gradient-to-b from-primary/70 to-primary/20"
          />
          <div className="relative flex w-full flex-col gap-3 border-l border-primary/25 pl-5 md:w-max md:flex-row md:gap-0 md:border-l-0 md:pl-0">
            <span
              aria-hidden="true"
              className="absolute -top-px left-0 right-1/2 border-t border-primary/25 md:hidden"
            />
            {children.map((child, index) => (
              <div
                key={child.id}
                className="relative flex flex-col items-center md:px-2 md:pt-6"
              >
                <span
                  aria-hidden="true"
                  className="absolute -left-5 top-8 w-5 border-t border-primary/25 md:hidden"
                />
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 right-1/2 top-0 hidden border-t border-primary/25 md:block"
                  />
                ) : null}
                {index < children.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 right-0 top-0 hidden border-t border-primary/25 md:block"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-0 hidden h-6 border-l border-primary/25 md:block"
                />
                <CommandBranch
                  agent={child}
                  ceoId={ceoId}
                  childrenByParent={childrenByParent}
                  organizeMode={organizeMode}
                  draggedAgentId={draggedAgentId}
                  renamingAgentId={renamingAgentId}
                  renameDraft={renameDraft}
                  movePending={movePending}
                  renamePending={renamePending}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDropAgent={onDropAgent}
                  onStartRename={onStartRename}
                  onRenameDraftChange={onRenameDraftChange}
                  onCancelRename={onCancelRename}
                  onSubmitRename={onSubmitRename}
                  path={nextPath}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AgentWorkstation({
  agent,
  featured = false,
  directReportCount,
  organizeMode,
  draggable = false,
  dragged,
  renaming,
  renameDraft,
  renamePending,
  onDragStart,
  onDragEnd,
  onDropAgent,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onSubmitRename,
}: {
  agent: Agent;
  featured?: boolean;
  directReportCount: number;
  organizeMode: boolean;
  draggable?: boolean;
  dragged: boolean;
  renaming: boolean;
  renameDraft: string;
  renamePending: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropAgent: (agentId: number) => void;
  onStartRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const heartbeat = agent.lastActiveAt
    ? timeAgo(agent.lastActiveAt)
    : "sinyal yok";
  const active = agent.status === "working";

  return (
    <article
      draggable={organizeMode && draggable}
      onDragStart={(event) => {
        const target = event.target;
        if (
          !draggable ||
          (target instanceof Element &&
            target.closest("a, button, input, form, [data-no-drag]"))
        ) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/agent-id", String(agent.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!organizeMode) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        const encodedAgentId = event.dataTransfer.getData("text/agent-id");
        if (!/^\d+$/u.test(encodedAgentId)) return;
        const agentId = Number(encodedAgentId);
        if (Number.isFinite(agentId) && agentId !== agent.id) {
          onDropAgent(agentId);
        }
      }}
      className={cn(
        "group relative w-full overflow-hidden rounded-[1.2rem] border bg-background/72 shadow-sm transition-[border-color,box-shadow,transform,opacity] md:w-[17rem]",
        featured
          ? "border-primary/30 shadow-md md:w-[21rem]"
          : "border-card-border hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md",
        active && "ring-1 ring-emerald-500/15",
        organizeMode && draggable && "cursor-grab active:cursor-grabbing",
        dragged && "scale-[0.98] opacity-45",
        dropActive && "border-primary ring-2 ring-primary/25",
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-20 opacity-35"
        style={{
          background: `linear-gradient(110deg, ${agent.avatarColor}55, transparent 70%)`,
        }}
      />
      <div className="relative p-4">
        {organizeMode && draggable ? (
          <GripVertical
            size={15}
            className="absolute right-3 top-3 text-muted-foreground/55"
            aria-hidden="true"
          />
        ) : null}

        <div className="flex min-w-0 items-start gap-3">
          <AgentAvatar
            agent={agent}
            size={featured ? "lg" : "md"}
            showStatus
            className={featured ? "shadow-lg" : "shadow-md"}
          />

          <div className="min-w-0 flex-1">
            {renaming ? (
              <form
                data-no-drag
                className="flex items-center gap-1.5 pr-4"
                onSubmit={onSubmitRename}
              >
                <Input
                  aria-label={`${agent.name} için yeni ad`}
                  value={renameDraft}
                  maxLength={200}
                  disabled={renamePending}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  className="h-8 min-w-0 bg-background/90 px-2 text-xs font-bold"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={!renameDraft.trim() || renamePending}
                  aria-label="Yeni adı kaydet"
                >
                  {renamePending ? (
                    <RotateCcw size={13} className="animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={renamePending}
                  onClick={onCancelRename}
                  aria-label="Ad değişikliğini iptal et"
                >
                  <X size={13} />
                </Button>
              </form>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 pr-5">
                <Link
                  href={`/agents/${agent.id}`}
                  className={cn(
                    "max-w-full truncate font-extrabold tracking-[-0.02em] hover:text-primary",
                    featured ? "text-lg" : "text-sm",
                  )}
                >
                  {agent.name}
                </Link>
                {featured ? (
                  <span className="rounded-full bg-foreground px-2 py-0.5 text-[12px] font-black uppercase tracking-[0.12em] text-background">
                    CEO · kök komuta
                  </span>
                ) : null}
                {organizeMode ? (
                  <button
                    type="button"
                    data-no-drag
                    onClick={onStartRename}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${agent.name} adını değiştir`}
                    title="Adını değiştir"
                  >
                    <Pencil size={12} />
                  </button>
                ) : null}
              </div>
            )}

            <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
              {agent.role}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <AgentStatusPill status={agent.status} />
              <span className="rounded-md border border-border/75 bg-card/70 px-1.5 py-0.5 font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Kademe {agent.depth}
              </span>
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
                <UsersRound size={10} /> {directReportCount} doğrudan rapor
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-border/75 bg-card/75 p-2.5 shadow-inner">
          <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <Laptop size={10} /> agent-{agent.id}
            </span>
            <span>{heartbeat}</span>
          </div>
          <p
            className={cn(
              "line-clamp-2 min-h-8 text-[12px] leading-4",
              active ? "text-foreground" : "text-muted-foreground",
            )}
            title={agent.currentAction ?? undefined}
          >
            {agent.currentAction?.trim() ||
              (active
                ? "Çalışma adımı raporlanıyor…"
                : "Yeni bir komut veya planlı çalışma bekliyor.")}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={`/agents/${agent.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1.5 text-[12px] font-bold text-background transition-opacity hover:opacity-85"
          >
            <MessageCircle size={11} /> Konuş
          </Link>
          <Link
            href={`/agents/${agent.id}?tab=computer`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/70 px-2.5 py-1.5 text-[12px] font-bold text-foreground transition-colors hover:border-primary/35 hover:text-primary"
          >
            <Laptop size={11} /> Bilgisayar
          </Link>
          {agent.currentTaskId ? (
            <Link
              href={`/projects/${agent.currentTaskId}`}
              className="ml-auto inline-flex items-center gap-1 font-mono text-[12px] font-bold text-primary hover:underline"
            >
              <BriefcaseBusiness size={10} /> iş #{agent.currentTaskId}
            </Link>
          ) : null}
        </div>
      </div>

      {organizeMode && dropActive ? (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-[1rem] border border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <span className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-xs font-bold shadow-md">
            <UsersRound size={13} /> {agent.name} yönetimine bırak
          </span>
        </div>
      ) : null}
    </article>
  );
}

function buildHierarchy(agents: Agent[]) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const childrenByParent = new Map<number, Agent[]>();
  const roots: Agent[] = [];

  for (const agent of agents) {
    const parentId = agent.parentAgentId;
    if (parentId === null || parentId === agent.id || !byId.has(parentId)) {
      roots.push(agent);
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(agent);
    childrenByParent.set(parentId, children);
  }

  const sortAgents = (left: Agent, right: Agent) => {
    const leftIsCeo = left.templateKey === "ceo" ? 0 : 1;
    const rightIsCeo = right.templateKey === "ceo" ? 0 : 1;
    return (
      leftIsCeo - rightIsCeo || left.depth - right.depth || left.id - right.id
    );
  };
  roots.sort(sortAgents);
  for (const children of childrenByParent.values()) children.sort(sortAgents);

  if (roots.length === 0 && agents.length > 0) roots.push(agents[0]);
  return { byId, childrenByParent, roots };
}

function collectDescendantIds(
  agentId: number,
  childrenByParent: ReadonlyMap<number, Agent[]>,
): Set<number> {
  const ids = new Set<number>([agentId]);
  const queue = [agentId];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (parentId === undefined) break;
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}
