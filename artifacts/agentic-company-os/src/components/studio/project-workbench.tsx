import { ActivitySummary } from "@/components/activity-summary";
import { type ComponentType } from "react";
import { Link } from "wouter";
import type { ActivityEvent, Agent, Task } from "@workspace/api-client-react";
import {
  Activity,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  Gauge,
  ListChecks,
  MonitorPlay,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { ComputerWorkspace } from "@/components/computer/computer-workspace";
import { ProjectMeetings } from "@/components/studio/project-meetings";
import { DelegationConversation } from "@/components/tasks/delegation-conversation";
import { RunInspector } from "@/components/tasks/run-inspector";
import { Markdown } from "@/lib/markdown";
import { TASK_STATUS_META, taskStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useLocale } from "@/components/i18n/locale-provider";
import {
  ProjectWorkbenchTabs,
  useWorkbenchView,
  type WorkbenchTab,
} from "./project-workbench-tabs";
import { TabsContent } from "@/components/ui/tabs";
import { type ProjectStudioCopy, studioText } from "@/lib/project-studio-copy";
import { useRecordHistory } from "@/hooks/use-record-history";
import { HistoryControls } from "@/components/history-controls";

const TABS: Array<{
  id: WorkbenchTab;
  label: keyof ProjectStudioCopy;
  icon: ComponentType<{ size?: string | number; className?: string }>;
}> = [
  { id: "workspace", label: "workspace", icon: MonitorPlay },
  { id: "plan", label: "planTab", icon: ListChecks },
  { id: "meetings", label: "meetings", icon: CalendarDays },
  { id: "team", label: "teamTab", icon: UsersRound },
  { id: "evidence", label: "evidence", icon: FileCheck2 },
];

export function ProjectWorkbench({
  c,
  project,
  activityKnown,
  owner,
  agents,
  members,
  subtasks,
  activities,
  activityLoading,
  activityError,
  onRetryActivity,
}: {
  c: ProjectStudioCopy;
  activityKnown: boolean;
  project: Task;
  owner: Agent | undefined;
  agents: Agent[];
  members: Agent[];
  subtasks: Task[];
  activities: ActivityEvent[];
  activityLoading: boolean;
  activityError: boolean;
  onRetryActivity: () => void;
}) {
  const { locale } = useLocale();
  const [tab, setTab] = useWorkbenchView(project.parentTaskId === null);
  const visibleTabs = (
    project.parentTaskId === null
      ? TABS
      : TABS.filter((item) => item.id !== "meetings")
  ).map((item) => ({ ...item, label: c[item.label] }));
  return (
    <section className="min-w-0 overflow-hidden rounded-[24px] border border-border/70 bg-card/90">
      <ProjectWorkbenchTabs
        value={tab}
        onChange={setTab}
        label={c.tabs}
        tabs={visibleTabs}
      >
        <TabsContent
          value="workspace"
          id="project-workbench-workspace"
          aria-labelledby="project-workbench-tab-workspace"
          className="mt-0 min-w-0"
        >
          {tab === "workspace" ? (
            owner ? (
              <ComputerWorkspace
                agent={owner}
                taskId={project.id}
                projectTitle={project.title}
                terminalAllowed={owner.permissions.canUseTerminal}
                browserAllowed={owner.permissions.canBrowse}
              />
            ) : (
              <WorkbenchEmpty
                icon={Bot}
                title={c.chatMissing}
                description={c.ownerMissing}
              />
            )
          ) : null}
        </TabsContent>

        <TabsContent
          value="plan"
          id="project-workbench-plan"
          aria-labelledby="project-workbench-tab-plan"
          className="mt-0 min-w-0"
        >
          {tab === "plan" ? (
            <RunInspector task={project} subtasks={subtasks} agents={agents} />
          ) : null}
        </TabsContent>

        <TabsContent
          value="team"
          id="project-workbench-team"
          aria-labelledby="project-workbench-tab-team"
          className="mt-0 min-w-0"
        >
          {tab === "team" ? (
            <div className="space-y-5">
              <section className="overflow-hidden rounded-[22px] border border-border/70 bg-card">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-[16px] py-4 sm:px-5">
                  <div>
                    <h2 className="text-sm font-bold">{c.team}</h2>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {c.rosterHelp}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
                    {studioText(c.members, {
                      count: members.length.toLocaleString(locale),
                    })}
                  </span>
                </header>
                {members.length ? (
                  <div className="grid grid-cols-1 gap-3 p-[12px] sm:grid-cols-2 xl:grid-cols-3">
                    {members.map((agent) => {
                      const owned = subtasks.filter(
                        (candidate) => candidate.ownerAgentId === agent.id,
                      );
                      return (
                        <Link
                          key={agent.id}
                          href={`/agents/${agent.id}`}
                          className="group flex flex-wrap items-center gap-[12px] rounded-2xl border border-border/60 bg-background/35 p-[12px] transition-[background-color,border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent/70"
                        >
                          <AgentAvatar agent={agent} size="sm" showStatus />
                          <div className="min-w-0 flex-1 basis-[100px]">
                            <p className="text-xs font-bold group-hover:text-primary">
                              {agent.name}
                            </p>
                            <p className="text-[12px] text-muted-foreground">
                              {agent.role}
                            </p>
                          </div>
                          <span className="rounded-full bg-secondary/80 px-2 py-1 text-[12px] font-semibold text-muted-foreground">
                            {agent.id === project.ownerAgentId
                              ? c.coordinator
                              : agent.isActive
                                ? owned.length
                                  ? studioText(c.workCount, {
                                      count:
                                        owned.length.toLocaleString(locale),
                                    })
                                  : c.inTeam
                                : c.inactive}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-5 py-10 text-center text-xs text-muted-foreground">
                    {c.emptyTeam}
                  </div>
                )}
              </section>

              <ProjectTaskHistory c={c} task={project} agents={agents} />
            </div>
          ) : null}
        </TabsContent>

        {project.parentTaskId === null ? (
          <TabsContent
            value="meetings"
            id="project-workbench-meetings"
            aria-labelledby="project-workbench-tab-meetings"
            className="mt-0 min-w-0"
          >
            {tab === "meetings" ? (
              <ProjectMeetings projectId={project.id} members={members} />
            ) : null}
          </TabsContent>
        ) : null}

        <TabsContent
          value="evidence"
          id="project-workbench-evidence"
          aria-labelledby="project-workbench-tab-evidence"
          className="mt-0 min-w-0"
        >
          {tab === "evidence" ? (
            <ProjectEvidence
              activityKnown={activityKnown}
              c={c}
              project={project}
              activities={activities}
              activityLoading={activityLoading}
              activityError={activityError}
              onRetry={onRetryActivity}
            />
          ) : null}
        </TabsContent>
      </ProjectWorkbenchTabs>
    </section>
  );
}

function ProjectTaskHistory({
  c,
  task,
  agents,
}: {
  c: ProjectStudioCopy;
  task: Task;
  agents: Agent[];
}) {
  const history = useRecordHistory<Task>(
    { kind: "subtasks", taskId: task.id },
    { interval: 6000 },
  );
  const { t } = useLocale();
  const tasks = history.data ?? [];
  const known = history.page !== null;
  return (
    <div className="min-w-0 space-y-5">
      <section aria-label={c.plan} className="min-w-0">
        <ProjectTaskTable
          c={c}
          tasks={tasks}
          agents={agents}
          known={known}
          loading={history.isLoading}
          error={history.isError}
          onRetry={history.refetch}
        />
        <div className="px-4">
          <p className="pt-3 text-sm text-muted-foreground">
            {t("historyPageFilters")}
          </p>
          <HistoryControls history={history} />
        </div>
      </section>
      <DelegationConversation
        key={task.id}
        task={task}
        subtasks={tasks}
        agents={agents}
        tasksKnown={known}
        tasksLoading={history.isLoading}
        tasksError={history.isError}
        onRetryTasks={history.refetch}
      />
    </div>
  );
}

function ProjectTaskTable({
  known,
  loading,
  error,
  onRetry,
  c,
  tasks,
  agents,
}: {
  c: ProjectStudioCopy;
  known: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  tasks: Task[];
  agents: Agent[];
}) {
  const { locale } = useLocale();
  return (
    <section className="overflow-hidden rounded-[22px] border border-border/70 bg-card">
      <header className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold">{c.plan}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {c.planHelp}
          </p>
        </div>
        <span className="font-mono text-[12px] text-muted-foreground">
          {known
            ? studioText(c.steps, {
                count: tasks.length.toLocaleString(locale),
              })
            : c.unavailable}
        </span>
      </header>
      {error && (
        <p role="status" className="px-5 py-3 text-sm">
          {known ? c.tasksStale : c.tasksMissing}
          <button
            type="button"
            onClick={onRetry}
            className="ms-2 min-h-11 px-2 font-semibold underline"
          >
            {c.retry}
          </button>
        </p>
      )}
      {!known ? (
        loading ? (
          <p role="status" className="p-5 text-sm">
            {c.tasksLoading}
          </p>
        ) : null
      ) : tasks.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <ListChecks
            size={20}
            className="mx-auto text-muted-foreground"
            aria-hidden
          />
          <p className="mt-2 text-xs font-semibold">{c.noTasks}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {c.noTasksHelp}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {tasks.map((task) => {
            const status = TASK_STATUS_META[task.status];
            const owner = agents.find(
              (agent) => agent.id === task.ownerAgentId,
            );
            return (
              <Link
                key={task.id}
                href={`/projects/${task.id}`}
                className="grid gap-3 px-5 py-4 transition-colors duration-300 hover:bg-accent/60 sm:grid-cols-[minmax(0,1fr)_160px_110px] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{task.title}</p>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    #{task.id} · {task.brief}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {owner ? <AgentAvatar agent={owner} size="xs" /> : null}
                  <span className="truncate text-[12px] text-muted-foreground">
                    {owner?.name ??
                      studioText(c.expertId, { id: task.ownerAgentId })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {new Intl.NumberFormat(locale, {
                      style: "percent",
                      maximumFractionDigits: 1,
                    }).format(task.progressPercent / 100)}
                  </span>
                  <span
                    className={cn(
                      "border px-1.5 py-0.5 text-[12px] font-bold uppercase",
                      status.className,
                    )}
                  >
                    {taskStatusLabel(task.status, locale)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProjectEvidence({
  c,
  project,
  activityKnown,
  activities,
  activityLoading,
  activityError,
  onRetry,
}: {
  c: ProjectStudioCopy;
  activityKnown: boolean;
  project: Task;
  activities: ActivityEvent[];
  activityLoading: boolean;
  activityError: boolean;
  onRetry: () => void;
}) {
  const { locale } = useLocale();
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <section className="overflow-hidden rounded-[22px] border border-border/70 bg-card">
        <header className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold">{c.records}</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {activityKnown
                ? studioText(c.recordsHelp, {
                    count: Math.min(80, activities.length).toLocaleString(
                      locale,
                    ),
                  })
                : activityLoading
                  ? c.recordsLoading
                  : c.recordsMissing}
            </p>
          </div>
          <Activity size={15} className="text-primary" aria-hidden />
        </header>
        {activityError && (
          <div className="p-4 text-sm" role="status">
            <p>{activityKnown ? c.recordsError : c.recordsMissing}</p>
            <button
              type="button"
              onClick={onRetry}
              className="min-h-11 px-2 font-semibold underline"
            >
              {c.retry}
            </button>
          </div>
        )}
        {activityLoading && activities.length === 0 ? (
          <div
            className="space-y-2 p-4"
            role="status"
            aria-label={c.recordsLoading}
          >
            <div className="shimmer h-14" />
            <div className="shimmer h-14" />
            <div className="shimmer h-14" />
          </div>
        ) : !activityKnown ? null : activities.length === 0 &&
          !activityError ? (
          <div className="px-5 py-10 text-center">
            <CircleDot
              size={20}
              className="mx-auto text-muted-foreground"
              aria-hidden
            />
            <p className="mt-2 text-xs font-semibold">{c.noRecords}</p>
          </div>
        ) : (
          <ol className="divide-y divide-border/60">
            {activities
              .slice(-80)
              .reverse()
              .map((event) => (
                <li
                  key={event.id}
                  className="grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 px-5 py-4"
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 rounded-full",
                      event.severity === "critical"
                        ? "bg-rose-500"
                        : event.severity === "warning"
                          ? "bg-amber-500"
                          : "bg-emerald-500",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="truncate text-[12px] font-bold uppercase tracking-[0.08em]">
                        <bdi>{event.type}</bdi>
                      </p>
                      <time
                        dateTime={event.createdAt}
                        className="text-[12px] text-muted-foreground"
                      >
                        {new Date(event.createdAt).toLocaleString(locale, {
                          timeZoneName: "short",
                        })}
                      </time>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.source}
                    </p>
                    <p
                      dir="auto"
                      className="mt-1 break-words text-sm leading-6"
                    >
                      <ActivitySummary event={event} />
                    </p>
                  </div>
                </li>
              ))}
          </ol>
        )}
      </section>

      <aside className="space-y-4">
        <section className="rounded-[22px] border border-border/70 bg-card p-5">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            <Gauge size={13} className="text-primary" aria-hidden />{" "}
            {c.runSummary}
          </div>
          <dl className="mt-4 space-y-3 text-xs">
            <Metric
              label={c.progress}
              value={new Intl.NumberFormat(locale, {
                style: "percent",
                maximumFractionDigits: 1,
              }).format(project.progressPercent / 100)}
            />
            <Metric
              label={c.attempts}
              value={project.stepAttempts.toLocaleString(locale)}
            />
            <Metric
              label={c.tokens}
              value={project.tokensUsed.toLocaleString(locale)}
            />
            <Metric
              label={c.records}
              value={
                activityKnown
                  ? activities.length.toLocaleString(locale)
                  : c.unavailable
              }
            />
            <Metric
              label={c.model}
              value={project.lastModelId ?? c.unknownModel}
            />
          </dl>
        </section>

        <section className="rounded-[22px] border border-border/70 bg-card p-5">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {project.status === "completed" ? (
              <CheckCircle2
                size={13}
                className="text-emerald-500"
                aria-hidden
              />
            ) : (
              <ShieldCheck size={13} className="text-primary" aria-hidden />
            )}
            {c.deliverySummary}
          </div>
          <div className="mt-3 text-xs leading-5 text-muted-foreground">
            {project.resultSummary ? (
              <div dir="auto">
                <p className="mb-2 text-xs">{c.source}</p>
                <Markdown content={project.resultSummary} />
              </div>
            ) : (
              <p>{c.noDelivery}</p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[150px] break-words text-end font-mono text-[12px] font-semibold">
        {value}
      </dd>
    </div>
  );
}

function WorkbenchEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ size?: string | number; className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[520px] flex-col items-center justify-center rounded-[22px] border border-dashed border-border/70 bg-card px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Icon size={18} aria-hidden />
      </span>
      <h2 className="mt-3 text-sm font-bold">{title}</h2>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
