import { useRef } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetTaskQueryKey,
  getListAgentsQueryKey,
  getListProjectMembersQueryKey,
  getListSubtasksQueryKey,
  getListTaskActivityQueryKey,
  useGetTask,
  useListAgents,
  useListProjectMembers,
  useListSubtasks,
  useListTaskActivity,
  type Agent,
} from "@workspace/api-client-react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CircleStop,
  ExternalLink,
  Radar,
  RotateCcw,
  UsersRound,
} from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { HandoffSpine } from "@/components/studio/handoff-spine";
import { ProjectChatPanel } from "@/components/studio/project-chat-panel";
import { ProjectWorkbench } from "@/components/studio/project-workbench";
import { BlockedTaskResume } from "@/components/tasks/blocked-task-resume";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/i18n/locale-provider";
import { setupMessages } from "@/lib/i18n";
import {
  loadProjectStudioCopy,
  studioText,
  type ProjectStudioCopy,
} from "@/lib/project-studio-copy";
import { ProjectStopControl } from "@/components/studio/project-stop-control";
import {
  PRIORITY_META,
  TASK_STATUS_META,
  taskStatusLabel,
  timeFromNow,
} from "@/lib/format";
import { splitProjectBrief } from "@/lib/project-brief";
import { cn } from "@/lib/utils";

export default function TaskDetail() {
  const { locale, t } = useLocale();
  const [, route] = useRoute("/projects/:projectId");
  const [, legacy] = useRoute("/tasks/:taskId");
  const copy = useQuery({
    queryKey: ["project-studio-copy", locale],
    queryFn: () => loadProjectStudioCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <section className="p-6" role={copy.isError ? "alert" : "status"}>
        <h1 className="sr-only">{t("project")}</h1>
        <p>
          {copy.isError
            ? setupMessages[locale].languageFileError
            : t("loadingScreen")}
        </p>
        {copy.isError && (
          <Button className="mt-3 min-h-11" onClick={() => void copy.refetch()}>
            {t("checkAgain")}
          </Button>
        )}
      </section>
    );
  return (
    <ProjectDetail
      key={route?.projectId ?? legacy?.taskId ?? "invalid"}
      c={copy.data}
    />
  );
}

function ProjectDetail({ c }: { c: ProjectStudioCopy }) {
  const { locale, t } = useLocale();
  const [, projectParams] = useRoute("/projects/:projectId");
  const [, legacyParams] = useRoute("/tasks/:taskId");
  const rawId = projectParams?.projectId ?? legacyParams?.taskId;
  const taskId = Number(rawId);
  const validTaskId =
    Number.isInteger(taskId) && taskId > 0 && taskId <= 2_147_483_647;
  const queryClient = useQueryClient();
  const taskHeadingRef = useRef<HTMLHeadingElement>(null);

  const {
    data: project,
    dataUpdatedAt,
    isFetching,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetTask(taskId, {
    query: {
      refetchInterval: 5_000,
      enabled: validTaskId,
      queryKey: getGetTaskQueryKey(taskId),
    },
  });
  const {
    data: subtasks,
    isLoading: subtasksLoading,
    isError: subtasksError,
    refetch: refetchSubtasks,
  } = useListSubtasks(
    taskId,
    { limit: 200 },
    {
      query: {
        refetchInterval: 6_000,
        enabled: validTaskId,
        queryKey: getListSubtasksQueryKey(taskId, { limit: 200 }),
      },
    },
  );
  const {
    data: activities,
    isLoading: activitiesLoading,
    isError: activitiesError,
    refetch: refetchActivities,
  } = useListTaskActivity(
    taskId,
    { limit: 200 },
    {
      query: {
        refetchInterval: 5_000,
        enabled: validTaskId,
        queryKey: getListTaskActivityQueryKey(taskId, { limit: 200 }),
      },
    },
  );
  const {
    data: agents,
    isLoading: agentsLoading,
    isError: agentsError,
    refetch: refetchAgents,
  } = useListAgents(
    { includeInactive: true },
    {
      query: {
        enabled: validTaskId,
        queryKey: getListAgentsQueryKey({ includeInactive: true }),
      },
    },
  );
  const membersQuery = useListProjectMembers(taskId, {
    query: {
      queryKey: getListProjectMembersQueryKey(taskId),
      enabled:
        validTaskId && project !== undefined && project.parentTaskId === null,
      refetchInterval: 15_000,
    },
  });

  if (!validTaskId) {
    return (
      <ProjectUnavailable
        c={c}
        title={c.invalidTitle}
        description={c.invalidHelp}
      />
    );
  }

  if (isLoading) return <ProjectStudioSkeleton c={c} />;

  if (!project) {
    const notFound = error?.status === 404 || (!isError && !project);
    return (
      <ProjectUnavailable
        c={c}
        title={notFound ? c.missingTitle : c.loadError}
        description={
          notFound ? studioText(c.missingHelp, { id: taskId }) : c.loadHelp
        }
        onRetry={notFound ? undefined : () => void refetch()}
      />
    );
  }

  const allAgents = agents ?? [];
  const projectTasks = subtasks ?? [];
  const projectActivity = activities ?? [];
  const owner =
    allAgents.find((agent) => agent.id === project.ownerAgentId) ??
    membersQuery.data?.find((member) => member.agentId === project.ownerAgentId)
      ?.agent;
  const projectMembers = membersQuery.data
    ? membersQuery.data.map((member) => member.agent)
    : allAgents.filter(
        (agent) =>
          agent.id === project.ownerAgentId ||
          projectTasks.some((task) => task.ownerAgentId === agent.id),
      );
  const status = TASK_STATUS_META[project.status];
  const priority = PRIORITY_META[project.priority];
  const projectBrief = splitProjectBrief(project.brief);
  const isRootProject = project.parentTaskId === null;
  const contextFailures = [
    subtasksError ? c.plan : null,
    activitiesError ? c.records : null,
    agentsError ? c.experts : null,
    membersQuery.isError ? c.team : null,
  ].filter((value): value is string => value !== null);
  const terminable = !["completed", "failed", "cancelled"].includes(
    project.status,
  );
  const warning =
    project.lastError && project.blockedReason !== "user_input" ? (
      <div
        className="mx-auto mt-4 max-w-[1680px] rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-xs text-amber-800 dark:text-amber-200"
        role="status"
      >
        <span className="inline-flex items-center gap-2 font-semibold">
          <AlertTriangle size={13} aria-hidden /> {c.warning}:
        </span>{" "}
        <span className="block text-muted-foreground">{c.source}</span>
        <p dir="auto" className="whitespace-pre-wrap break-words">
          {project.lastError}
        </p>
        {project.nextAttemptAt
          ? studioText(c.nextAttempt, {
              time: timeFromNow(project.nextAttemptAt),
            })
          : ""}
      </div>
    ) : null;

  return (
    <div className="project-studio min-h-full bg-background px-[12px] py-3 [overflow-wrap:anywhere] sm:px-5 sm:py-5">
      <header className="mx-auto max-w-[1680px] overflow-hidden rounded-[28px] border border-border/70 bg-card/90 shadow-[0_28px_80px_-58px_rgba(0,0,0,0.8)]">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
            <Link
              href="/projects"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 font-semibold transition-colors hover:text-foreground"
            >
              <ArrowLeft size={13} aria-hidden className="rtl:rotate-180" />{" "}
              {t("projects")}
            </Link>
            {!isRootProject ? (
              <>
                <span aria-hidden>/</span>
                <Link
                  href={`/projects/${project.parentTaskId}`}
                  className="inline-flex min-h-11 items-center truncate transition-colors hover:text-foreground"
                >
                  {c.parent}
                </Link>
              </>
            ) : null}
            <span aria-hidden>/</span>
            <span className="truncate font-mono">#{project.id}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {isRootProject ? (
              <Link
                href={`/projects/${project.id}/operations`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-2.5 text-[12px] font-semibold text-primary transition-colors hover:border-primary/45"
              >
                <Radar size={12} aria-hidden /> {c.operations}
              </Link>
            ) : null}
            <Link
              href="/operations"
              className="hidden min-h-11 items-center gap-1.5 rounded-xl border border-border/70 bg-background/45 px-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground sm:inline-flex"
            >
              <Activity size={12} aria-hidden /> {t("activity")}
              <ExternalLink size={10} aria-hidden />
            </Link>
            <ProjectStopControl
              onClosed={() =>
                taskHeadingRef.current?.focus({ preventScroll: true })
              }
              task={project}
              c={c}
              canStart={terminable && !isError}
              onObserved={(task) =>
                queryClient.setQueryData(getGetTaskQueryKey(task.id), task)
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 px-[16px] py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,auto)] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.1em]",
                  status.className,
                )}
              >
                {taskStatusLabel(project.status, locale)}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.1em]",
                  priority.className,
                )}
              >
                {c[project.priority]}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {project.autonomyMode === "continuous"
                  ? studioText(c.continuous, {
                      count: project.cycleCount.toLocaleString(locale),
                    })
                  : c.finite}
              </span>
              {projectBrief.approach ? (
                <span className="text-[12px] font-semibold text-primary">
                  {studioText(c.mode, { name: projectBrief.approach })}
                </span>
              ) : null}
            </div>
            <h1
              ref={taskHeadingRef}
              dir="auto"
              tabIndex={-1}
              className="mt-3 max-w-4xl font-serif text-3xl font-medium tracking-[-0.045em] outline-none sm:text-4xl"
            >
              {project.title}
            </h1>
            <p
              dir="auto"
              className="mt-2 max-w-4xl whitespace-pre-wrap text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6"
            >
              {projectBrief.outcome}
            </p>
            {project.blockedReason === "budget" ? warning : null}
          </div>

          <ProjectTeamSummary
            c={c}
            members={projectMembers}
            owner={owner}
            loading={agentsLoading || membersQuery.isLoading}
            memberCount={membersQuery.data?.length ?? projectMembers.length}
          />
        </div>

        <HandoffSpine
          activityKnown={activities !== undefined}
          tasksKnown={subtasks !== undefined}
          activityLoading={activitiesLoading}
          tasksLoading={subtasksLoading}
          c={c}
          task={project}
          activities={projectActivity}
          subtasks={projectTasks}
        />
      </header>

      {isError && (
        <div
          className="mx-auto mt-4 max-w-[1680px] rounded-2xl border border-border bg-card p-4"
          role="status"
        >
          <p>{c.stale}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {studioText(c.snapshot, {
              time: new Date(dataUpdatedAt).toLocaleString(locale, {
                timeZoneName: "short",
              }),
            })}
          </p>
          <Button
            className="mt-3 min-h-11"
            disabled={isFetching}
            aria-busy={isFetching}
            onClick={() => void refetch()}
          >
            {c.checkState}
          </Button>
        </div>
      )}
      {project.blockedReason !== "budget" ? warning : null}

      <BlockedTaskResume
        task={project}
        owner={owner}
        c={c}
        disabled={isError}
        onResumed={() => taskHeadingRef.current?.focus({ preventScroll: true })}
      />

      {subtasksError ||
      activitiesError ||
      agentsError ||
      membersQuery.isError ? (
        <div
          className="mx-auto mt-4 flex max-w-[1680px] flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-800 dark:text-amber-200"
          role="status"
        >
          <span>
            {studioText(c.partial, { sections: contextFailures.join(", ") })}
          </span>
          {subtasksError ||
          activitiesError ||
          agentsError ||
          membersQuery.isError ? (
            <button
              type="button"
              className="min-h-11 px-2 font-semibold underline underline-offset-2"
              onClick={() => {
                if (subtasksError) void refetchSubtasks();
                if (activitiesError) void refetchActivities();
                if (agentsError) void refetchAgents();
                if (membersQuery.isError) void membersQuery.refetch();
              }}
            >
              {c.retry}
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="mx-auto mt-4 grid max-w-[1680px] gap-4 lg:grid-cols-[350px_minmax(0,1fr)]">
        <div className="order-2 min-w-0 [&>section]:rounded-[24px] [&>section]:border-border/70 [&>section]:shadow-[0_24px_70px_-52px_rgba(0,0,0,0.75)] lg:order-1">
          {owner ? (
            <ProjectChatPanel
              project={project}
              owner={owner}
              canStart={!isError && !agentsError}
            />
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[24px] border border-dashed border-border/70 bg-card px-6 text-center lg:min-h-[660px]">
              <CircleStop
                size={20}
                className="text-muted-foreground"
                aria-hidden
              />
              <p className="mt-3 text-sm font-bold">{c.chatMissing}</p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                {c.ownerMissing}
              </p>
            </div>
          )}
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          <ProjectWorkbench
            c={c}
            project={project}
            owner={owner}
            agents={allAgents}
            members={projectMembers}
            subtasks={projectTasks}
            activities={projectActivity}
            activityLoading={activitiesLoading}
            activityKnown={activities !== undefined}
            activityError={activitiesError}
            onRetryActivity={() => void refetchActivities()}
          />
        </div>
      </section>
    </div>
  );
}

function ProjectTeamSummary({
  c,
  members,
  owner,
  loading,
  memberCount,
}: {
  c: ProjectStudioCopy;
  members: Agent[];
  owner: Agent | undefined;
  loading: boolean;
  memberCount: number;
}) {
  const { locale } = useLocale();
  if (loading) {
    return (
      <div className="rounded-[22px] border border-border/70 bg-background/35 p-4">
        <Skeleton className="h-5 w-28 rounded-full" />
        <div className="mt-3 flex gap-1">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="size-9 rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="rounded-[22px] border border-border/70 bg-background/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
          <UsersRound size={14} className="text-primary" aria-hidden /> {c.team}
        </p>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
          {studioText(c.members, { count: memberCount.toLocaleString(locale) })}
        </span>
      </div>

      {members.length ? (
        <div className="mt-3 flex items-center" aria-label={c.memberLabel}>
          <div className="flex flex-wrap gap-1">
            {members.slice(0, 8).map((member) => (
              <Link
                key={member.id}
                href={`/agents/${member.id}`}
                aria-label={`${member.name}, ${member.role}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ring-2 ring-card transition-transform duration-300 hover:z-10 hover:-translate-y-1"
              >
                <AgentAvatar agent={member} size="sm" showStatus />
              </Link>
            ))}
          </div>
          {memberCount > 8 ? (
            <span className="ms-2 flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-[12px] font-bold">
              +{memberCount - 8}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{c.emptyTeam}</p>
      )}

      {owner ? (
        <p className="mt-3 text-[12px] leading-4 text-muted-foreground">
          {studioText(c.coordinatorHelp, { name: owner.name })}
        </p>
      ) : null}
    </aside>
  );
}

function ProjectStudioSkeleton({ c }: { c: ProjectStudioCopy }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label={c.loading}>
      <h1 className="sr-only">{c.loading}</h1>
      <Skeleton className="h-44 w-full rounded-[28px]" />
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Skeleton className="h-[660px] rounded-[24px]" />
        <Skeleton className="h-[660px] rounded-[24px]" />
      </div>
    </div>
  );
}

function ProjectUnavailable({
  c,
  title,
  description,
  onRetry,
}: {
  c: ProjectStudioCopy;
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center"
      role="alert"
    >
      <span className="flex size-12 items-center justify-center rounded-full border border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300">
        <AlertTriangle size={21} aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <div className="mt-5 flex items-center gap-2">
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold transition-colors hover:border-primary/45"
        >
          <ArrowLeft size={13} aria-hidden className="rtl:rotate-180" />{" "}
          {c.back}
        </Link>
        {onRetry ? (
          <Button type="button" className="min-h-11" onClick={onRetry}>
            <RotateCcw size={13} aria-hidden /> {c.retry}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
