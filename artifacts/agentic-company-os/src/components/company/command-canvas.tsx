import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetAgentQueryKey,
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
  type Agent,
} from "@workspace/api-client-react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  GitBranch,
  Laptop,
  MessageCircle,
  Pencil,
  Radio,
  Save,
  UsersRound,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { useToast } from "@/hooks/use-toast";
import { controlPlaneFetch } from "@/lib/auth";
import { AGENT_STATUS_META, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import "./command-canvas.css";

export type CommandCanvasProps = {
  agents: Agent[];
  selectedAgentId: number | null;
  onSelectedAgentIdChange: (agentId: number) => void;
  onOpenWorkspace: (agentId: number) => void;
  activeDelegationAgentIds?: number[];
  className?: string;
};

type CommandEdge = {
  parentId: number;
  childId: number;
  path: string;
  active: boolean;
  blocked: boolean;
};

type MeasuredCanvas = {
  width: number;
  height: number;
  edges: CommandEdge[];
};

type RenameRequest = {
  agentId: number;
  name: string;
  previousName: string;
};

const EMPTY_CANVAS: MeasuredCanvas = { width: 1, height: 1, edges: [] };

export function CommandCanvas({
  agents,
  selectedAgentId,
  onSelectedAgentIdChange,
  onOpenWorkspace,
  activeDelegationAgentIds,
  className,
}: CommandCanvasProps) {
  const organization = useMemo(
    () => buildCommandOrganization(agents),
    [agents],
  );
  const stageRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<number, HTMLElement>());
  const [measured, setMeasured] = useState<MeasuredCanvas>(EMPTY_CANVAS);
  const [renamingAgentId, setRenamingAgentId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeDelegationAgentIdSet = useMemo(
    () => new Set(activeDelegationAgentIds ?? []),
    [activeDelegationAgentIds],
  );

  const selectedAgent =
    selectedAgentId !== null
      ? organization.byId.get(selectedAgentId)
      : undefined;

  const registerNode = useCallback(
    (agentId: number, element: HTMLElement | null) => {
      if (element) nodeRefs.current.set(agentId, element);
      else nodeRefs.current.delete(agentId);
    },
    [],
  );

  const measureConnections = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const edges = organization.connections.flatMap((connection) => {
      const parentNode = nodeRefs.current.get(connection.parent.id);
      const childNode = nodeRefs.current.get(connection.child.id);
      if (!parentNode || !childNode) return [];

      const parentRect = parentNode.getBoundingClientRect();
      const childRect = childNode.getBoundingClientRect();
      const startX = parentRect.left - stageRect.left + parentRect.width / 2;
      const startY = parentRect.bottom - stageRect.top - 2;
      const endX = childRect.left - stageRect.left + childRect.width / 2;
      const endY = childRect.top - stageRect.top + 2;
      const distance = Math.max(48, endY - startY);
      const parentPull = Math.min(76, distance * 0.38);
      const childPull = Math.min(64, distance * 0.32);
      const path = [
        `M ${round(startX)} ${round(startY)}`,
        `C ${round(startX)} ${round(startY + parentPull)}`,
        `${round(endX)} ${round(endY - childPull)}`,
        `${round(endX)} ${round(endY)}`,
      ].join(" ");

      return [
        {
          parentId: connection.parent.id,
          childId: connection.child.id,
          path,
          active: activeDelegationAgentIdSet.has(connection.child.id),
          blocked: connection.child.status === "blocked",
        },
      ];
    });

    setMeasured({
      width: Math.max(1, round(stageRect.width)),
      height: Math.max(1, round(stageRect.height)),
      edges,
    });
  }, [activeDelegationAgentIdSet, organization.connections]);

  useLayoutEffect(() => {
    let animationFrame = window.requestAnimationFrame(measureConnections);
    const scheduleMeasurement = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measureConnections);
    };
    const observer = new ResizeObserver(scheduleMeasurement);
    if (stageRef.current) observer.observe(stageRef.current);
    for (const node of nodeRefs.current.values()) observer.observe(node);
    window.addEventListener("resize", scheduleMeasurement);
    void document.fonts?.ready.then(scheduleMeasurement);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasurement);
    };
  }, [measureConnections, organization.levels.length, selectedAgentId]);

  const renameAgent = useMutation({
    mutationFn: ({ agentId, name }: RenameRequest) =>
      controlPlaneFetch<Agent>(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: (updated, request) => {
      void queryClient.invalidateQueries({
        queryKey: getListAgentsQueryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetAgentQueryKey(updated.id),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetOrgSummaryQueryKey(),
      });
      toast({
        title: "Çalışan adı güncellendi",
        description: `${request.previousName} artık ${updated.name} adıyla çalışacak.`,
      });
      setRenamingAgentId(null);
      setRenameDraft("");
    },
    onError: (error) => {
      toast({
        title: "Çalışan adı güncellenemedi",
        description:
          error instanceof Error
            ? error.message
            : "Adı kontrol edip yeniden deneyin.",
        variant: "destructive",
      });
    },
  });

  const startRename = (agent: Agent) => {
    onSelectedAgentIdChange(agent.id);
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
        title: "Çalışan adı boş bırakılamaz",
        description: "Kaydetmeden önce görünür bir ad yazın.",
        variant: "destructive",
      });
      return;
    }
    if (name === agent.name) {
      cancelRename();
      return;
    }
    renameAgent.mutate({
      agentId: agent.id,
      name,
      previousName: agent.name,
    });
  };

  if (agents.length === 0) {
    return (
      <section className={cn("command-canvas cc-empty", className)}>
        <UsersRound aria-hidden="true" />
        <h2>Şirket kadrosu boş</h2>
        <p>Komuta ağını görmek için önce bir çalışan oluşturun.</p>
      </section>
    );
  }

  const workingCount = agents.filter(
    (agent) => agent.status === "working",
  ).length;
  const blockedCount = agents.filter(
    (agent) => agent.status === "blocked",
  ).length;

  return (
    <section className={cn("command-canvas", className)}>
      <header className="cc-header">
        <div className="cc-heading">
          <span className="cc-eyebrow">
            <Radio aria-hidden="true" size={13} /> Canlı organizasyon ağı
          </span>
          <div className="cc-title-line">
            <h2>Komuta katı</h2>
            <span className="cc-roster-count">{agents.length} çalışan</span>
          </div>
          <p>
            Yetki yukarıdan aşağı akar; çalışma sinyalleri hatlarda görünür.
          </p>
        </div>

        <div className="cc-live-ledger" aria-label="Kadro durumu">
          <span>
            <i className="cc-ledger-dot cc-ledger-dot-working" />
            <strong>{workingCount}</strong> çalışıyor
          </span>
          <span>
            <i className="cc-ledger-dot cc-ledger-dot-blocked" />
            <strong>{blockedCount}</strong> beklemede
          </span>
          <span>
            <GitBranch aria-hidden="true" size={13} />
            <strong>{organization.connections.length}</strong> komuta hattı
          </span>
        </div>
      </header>

      <div className="cc-stage" ref={stageRef}>
        <svg
          className="cc-connections"
          viewBox={`0 0 ${measured.width} ${measured.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <filter
              id="cc-line-glow"
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {measured.edges.map((edge) => {
            const selected =
              edge.parentId === selectedAgent?.id ||
              edge.childId === selectedAgent?.id;
            return (
              <g
                key={`${edge.parentId}-${edge.childId}`}
                className={cn(
                  "cc-edge",
                  edge.active && "is-active",
                  edge.blocked && "is-blocked",
                  selected && "is-selected",
                )}
              >
                <path className="cc-edge-bed" d={edge.path} />
                <path className="cc-edge-signal" d={edge.path} />
                <circle className="cc-edge-terminal" r={selected ? 4 : 3}>
                  <animateMotion
                    dur="2.8s"
                    repeatCount="indefinite"
                    path={edge.path}
                  />
                </circle>
              </g>
            );
          })}
        </svg>

        <div className="cc-levels">
          {organization.levels.map((level) => (
            <div
              className="cc-level"
              key={level.depth}
              data-depth={level.depth}
            >
              {level.depth > 0 ? (
                <div className="cc-level-marker" aria-hidden="true">
                  <span>{String(level.depth).padStart(2, "0")}</span>
                </div>
              ) : null}
              <div
                className="cc-level-grid"
                style={
                  {
                    "--cc-columns": Math.min(3, level.agents.length),
                  } as CSSProperties
                }
              >
                {level.agents.map((agent) => (
                  <CommandNode
                    key={agent.id}
                    agent={agent}
                    featured={agent.id === organization.ceo?.id}
                    selected={agent.id === selectedAgent?.id}
                    renaming={agent.id === renamingAgentId}
                    renameDraft={renameDraft}
                    renamePending={renameAgent.isPending}
                    directReportCount={
                      organization.childrenByParent.get(agent.id)?.length ?? 0
                    }
                    registerNode={registerNode}
                    onSelect={() => onSelectedAgentIdChange(agent.id)}
                    onOpenWorkspace={() => onOpenWorkspace(agent.id)}
                    onStartRename={() => startRename(agent)}
                    onRenameDraftChange={setRenameDraft}
                    onCancelRename={cancelRename}
                    onSubmitRename={(event) => submitRename(event, agent)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CommandNode({
  agent,
  featured,
  selected,
  renaming,
  renameDraft,
  renamePending,
  directReportCount,
  registerNode,
  onSelect,
  onOpenWorkspace,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onSubmitRename,
}: {
  agent: Agent;
  featured: boolean;
  selected: boolean;
  renaming: boolean;
  renameDraft: string;
  renamePending: boolean;
  directReportCount: number;
  registerNode: (agentId: number, element: HTMLElement | null) => void;
  onSelect: () => void;
  onOpenWorkspace: () => void;
  onStartRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const status = AGENT_STATUS_META[agent.status];
  return (
    <article
      ref={(element) => registerNode(agent.id, element)}
      className={cn(
        "cc-node",
        featured && "is-featured",
        selected && "is-selected",
        agent.status === "working" && "is-working",
        agent.status === "blocked" && "is-blocked",
      )}
      style={{ "--cc-agent-color": agent.avatarColor } as CSSProperties}
    >
      <button
        type="button"
        className="cc-node-select-control"
        aria-pressed={selected}
        aria-label={`${agent.name}, ${agent.role} çalışanını seç`}
        title={`${agent.name} çalışanını seç`}
        onClick={onSelect}
      />
      <span className="cc-node-notch" aria-hidden="true" />
      <div className="cc-node-identity">
        <div className="cc-portrait-wrap">
          <AgentAvatar
            agent={agent}
            size={featured ? "xl" : "lg"}
            showStatus
            className="cc-portrait"
          />
          <span className="cc-agent-index">
            A-{String(agent.id).padStart(2, "0")}
          </span>
        </div>

        <div className="cc-node-copy">
          <div className="cc-node-meta">
            {featured ? (
              <span className="cc-command-badge">Kök komuta</span>
            ) : null}
            {agent.department ? <span>{agent.department}</span> : null}
            <span className={cn("cc-status", `cc-status-${agent.status}`)}>
              <i className={status.dot} /> {status.label}
            </span>
          </div>

          {renaming ? (
            <form
              className="cc-rename-form"
              onSubmit={onSubmitRename}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                autoFocus
                aria-label={`${agent.name} için yeni ad`}
                value={renameDraft}
                maxLength={200}
                disabled={renamePending}
                onChange={(event) => onRenameDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") onCancelRename();
                }}
              />
              <button
                type="submit"
                aria-label="Yeni adı kaydet"
                disabled={!renameDraft.trim() || renamePending}
              >
                {renamePending ? <Radio size={14} /> : <Save size={14} />}
              </button>
              <button
                type="button"
                aria-label="Ad değişikliğini iptal et"
                disabled={renamePending}
                onClick={onCancelRename}
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <div className="cc-name-line">
              <h3>{agent.name}</h3>
              <button
                type="button"
                className="cc-rename-button"
                aria-label={`${agent.name} adını değiştir`}
                title="Adını değiştir"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartRename();
                }}
              >
                <Pencil size={13} />
              </button>
            </div>
          )}

          <p className="cc-role">{agent.role}</p>

          <div className="cc-command-facts">
            <span>
              <UsersRound aria-hidden="true" size={12} /> {directReportCount}{" "}
              doğrudan rapor
            </span>
            {agent.lastActiveAt ? (
              <span
                title={new Date(agent.lastActiveAt).toLocaleString("tr-TR")}
              >
                <Radio aria-hidden="true" size={12} />{" "}
                {timeAgo(agent.lastActiveAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {(agent.currentAction || agent.currentTaskId) && (
        <div className="cc-current-work">
          <span className="cc-work-rail" aria-hidden="true" />
          <div>
            <span className="cc-work-label">
              {agent.currentTaskId
                ? `Görev #${agent.currentTaskId}`
                : "Güncel çalışma"}
            </span>
            {agent.currentAction ? (
              <p title={agent.currentAction}>{agent.currentAction}</p>
            ) : null}
          </div>
        </div>
      )}

      <div className="cc-node-actions" aria-label={`${agent.name} araçları`}>
        <Link
          href={`/agents/${agent.id}?tab=chat`}
          aria-label={`${agent.name} ile konuş`}
          title={`${agent.name} ile konuş`}
          onClick={(event) => event.stopPropagation()}
        >
          <MessageCircle aria-hidden="true" size={14} />
          <span>Konuş</span>
        </Link>
        <button
          type="button"
          aria-label={`${agent.name} bilgisayarını izle`}
          title={`${agent.name} bilgisayarını izle`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenWorkspace();
          }}
        >
          <Laptop aria-hidden="true" size={14} />
          <span>Bilgisayarı izle</span>
        </button>
        {agent.currentTaskId ? (
          <Link
            href={`/projects/${agent.currentTaskId}`}
            aria-label={`${agent.name} için görev #${agent.currentTaskId} ayrıntısını aç`}
            title={`Görev #${agent.currentTaskId} ayrıntısını aç`}
            onClick={(event) => event.stopPropagation()}
          >
            <BriefcaseBusiness aria-hidden="true" size={14} />
            <span>Görev</span>
          </Link>
        ) : null}
        <Link
          className="cc-profile-link"
          href={`/agents/${agent.id}`}
          aria-label={`${agent.name} profilini aç`}
          title={`${agent.name} profilini aç`}
          onClick={(event) => event.stopPropagation()}
        >
          <span>Profil</span> <ArrowUpRight aria-hidden="true" size={14} />
        </Link>
      </div>

      {selected ? (
        <span className="cc-selected-mark" aria-hidden="true">
          <Check size={12} /> seçili
        </span>
      ) : null}
    </article>
  );
}

function buildCommandOrganization(agents: Agent[]) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const childrenByParent = new Map<number, Agent[]>();
  const validConnections: Array<{ parent: Agent; child: Agent }> = [];

  for (const agent of agents) {
    if (
      agent.parentAgentId === null ||
      agent.parentAgentId === agent.id ||
      !byId.has(agent.parentAgentId)
    ) {
      continue;
    }
    const parent = byId.get(agent.parentAgentId);
    if (!parent) continue;
    const children = childrenByParent.get(parent.id) ?? [];
    children.push(agent);
    childrenByParent.set(parent.id, children);
    validConnections.push({ parent, child: agent });
  }

  const ceo =
    agents.find((agent) => agent.templateKey === "ceo") ??
    agents.find((agent) => agent.parentAgentId === null) ??
    agents[0];
  const depthById = new Map<number, number>();
  if (ceo) {
    depthById.set(ceo.id, 0);
    const queue = [ceo.id];
    while (queue.length > 0) {
      const parentId = queue.shift();
      if (parentId === undefined) break;
      const parentDepth = depthById.get(parentId) ?? 0;
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (depthById.has(child.id)) continue;
        depthById.set(child.id, parentDepth + 1);
        queue.push(child.id);
      }
    }
  }

  for (const agent of agents) {
    if (depthById.has(agent.id)) continue;
    depthById.set(agent.id, Math.max(1, agent.depth));
  }

  const levelsByDepth = new Map<number, Agent[]>();
  for (const agent of agents) {
    const depth = depthById.get(agent.id) ?? 1;
    const level = levelsByDepth.get(depth) ?? [];
    level.push(agent);
    levelsByDepth.set(depth, level);
  }

  const sortAgents = (left: Agent, right: Agent) => left.id - right.id;
  for (const level of levelsByDepth.values()) level.sort(sortAgents);
  for (const children of childrenByParent.values()) children.sort(sortAgents);

  const levels = [...levelsByDepth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([depth, levelAgents]) => ({ depth, agents: levelAgents }));

  return {
    ceo,
    byId,
    childrenByParent,
    connections: validConnections,
    levels,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
