import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getListAgentsQueryKey,
  getListTasksQueryKey,
  useListAgents,
  useListTasks,
  type Agent,
  type Task,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  CircleAlert,
  FolderKanban,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Settings2,
  ListChecks,
  UsersRound,
  PackageCheck,
} from "lucide-react";

import { AgentAvatar } from "@/components/agent/agent-avatar";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { HomeProjectComposer } from "@/components/studio/home-project-composer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { adaptivePollingInterval } from "@/lib/adaptive-polling";
import { TASK_STATUS_META, taskStatusLabel, timeAgo } from "@/lib/format";
import { loadHomeCopy, type HomeCopy } from "@/lib/home-copy";
import type { Locale } from "@/lib/i18n";
import { splitProjectBrief } from "@/lib/project-brief";
import { cn } from "@/lib/utils";

const HOME_PROJECT_PARAMS = { rootOnly: true, limit: 100 } as const;
const LIVE_PROJECT_STATUSES = new Set<Task["status"]>([
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
]);

export default function Dashboard() {
  const { locale, t } = useLocale();
  const copyQuery = useQuery({
    queryKey: ["home-copy", locale],
    queryFn: () => loadHomeCopy(locale),
    staleTime: Infinity,
    retry: 1,
  });

  if (copyQuery.isError) {
    return (
      <div
        role="alert"
        className="mx-auto w-full max-w-[1160px] rounded-panel border border-attention/25 bg-attention/5 p-6 text-center"
      >
        <p className="text-sm font-semibold">{t("homeCopyError")}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 min-h-11"
          onClick={() => window.location.reload()}
        >
          {t("checkAgain")}
        </Button>
      </div>
    );
  }

  if (!copyQuery.data) {
    return (
      <div
        className="mx-auto w-full max-w-[1160px]"
        role="status"
        aria-label={t("loadingScreen")}
      >
        <Skeleton className="h-72 w-full rounded-panel" />
      </div>
    );
  }

  return <DashboardContent copy={copyQuery.data} locale={locale} />;
}

function DashboardContent({
  copy,
  locale,
}: {
  copy: HomeCopy;
  locale: Locale;
}) {
  const documentVisible = useDocumentVisible();
  const { isScopeBlocked } = useOpsControl();
  const agentsQuery = useListAgents(
    { includeInactive: false },
    {
      query: {
        queryKey: getListAgentsQueryKey({ includeInactive: false }),
      },
    },
  );
  const projectsQuery = useListTasks(HOME_PROJECT_PARAMS, {
    query: {
      queryKey: getListTasksQueryKey(HOME_PROJECT_PARAMS),
      refetchInterval: (query) =>
        adaptivePollingInterval({
          documentVisible,
          live: ((query.state.data as Task[] | undefined) ?? []).some(
            (project) => LIVE_PROJECT_STATUSES.has(project.status),
          ),
        }),
    },
  });

  const agents = agentsQuery.data ?? [];
  const projects = useMemo(
    () => (projectsQuery.data ?? []).slice().sort(newestProjectFirst),
    [projectsQuery.data],
  );

  return (
    <div className="mx-auto w-full max-w-[1160px] pb-12">
      <section className="grid grid-cols-1 gap-8 pb-10 pt-2 lg:grid-cols-[minmax(0,1fr)_270px] lg:gap-10 lg:pb-12 lg:pt-5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">{copy.deskKicker}</p>
          <h1 className="editorial-display mt-3 max-w-[680px] break-words text-balance text-[clamp(1.875rem,3.2vw,2.875rem)] leading-[1.18] text-foreground">
            {copy.heroTitle}
          </h1>
          <p className="mt-4 max-w-[600px] text-sm leading-6 text-muted-foreground">
            {copy.heroDescription}
          </p>
          <div className="mt-6 w-full">
            {agentsQuery.isLoading && agents.length === 0 ? (
              <ComposerSkeleton />
            ) : agentsQuery.isError && agents.length === 0 ? (
              <LoadFailure
                copy={copy}
                onRetry={() => void agentsQuery.refetch()}
              />
            ) : (
              <HomeProjectComposer
                agents={agents}
                blocked={isScopeBlocked("task_scheduler")}
                copy={copy}
                locale={locale}
              />
            )}
          </div>
          <Link
            href="/skills"
            className="mt-4 flex min-h-14 min-w-0 items-center justify-between gap-4 rounded-panel border border-border bg-card px-5 py-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {copy.quickToolsTitle}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {copy.quickToolsDescription}
              </span>
            </span>
            <ArrowRight
              className="size-4 shrink-0 text-primary rtl:rotate-180"
              aria-hidden
            />
          </Link>
        </div>
        <aside
          className="flex min-w-0 flex-col border-t border-border pt-6 lg:border-s lg:border-t-0 lg:ps-7 lg:pt-0"
          aria-label={copy.guideLabel}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="size-4 text-primary" aria-hidden />
            {copy.guideTitle}
          </div>
          <ol className="mt-5 space-y-6">
            {copy.guideSteps.map((step, index) => (
              <li key={step.title} className="relative flex gap-3">
                {index < 2 ? (
                  <span
                    className="absolute start-[13px] top-8 h-[calc(100%_-_10px)] border-s border-border"
                    aria-hidden
                  />
                ) : null}
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/5 font-mono text-xs text-primary"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div>
                  <p className="pt-0.5 text-sm font-medium">{step.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {step.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-7 border-t border-border pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <ShieldCheck
                className="size-4 text-verified-foreground"
                aria-hidden
              />
              {copy.controlTitle}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {copy.controlDescription}
            </p>
            <Link
              href="/settings"
              className="mt-4 inline-flex min-h-10 items-center gap-2 text-xs font-medium text-primary hover:underline"
            >
              <Settings2 className="size-3.5" aria-hidden />
              {copy.firstUse}
              <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
            </Link>
          </div>
          {!agentsQuery.isError && agents.length > 0 ? (
            <Link
              href="/agents"
              className="mt-5 rounded-panel border border-border bg-card p-4 transition-colors hover:border-primary/35"
            >
              <div className="flex justify-start">
                <TeamCrest
                  agents={agents.slice(0, 4)}
                  loading={false}
                  copy={copy}
                  locale={locale}
                />
              </div>
              <p className="mt-3 flex items-center justify-between text-sm font-medium">
                {copy.meetExperts.replace(
                  "{count}",
                  new Intl.NumberFormat(locale).format(agents.length),
                )}{" "}
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {copy.seeRoles}
              </p>
            </Link>
          ) : null}
        </aside>
      </section>

      <section aria-labelledby="recent-projects-heading">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {copy.resumeKicker}
            </p>
            <h2
              id="recent-projects-heading"
              className="mt-1.5 text-2xl font-semibold tracking-[-0.035em]"
            >
              {copy.recentProjects}
            </h2>
          </div>
          <Link
            href="/projects"
            className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-8"
          >
            {copy.viewAll}{" "}
            <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        </header>

        {projectsQuery.isLoading && projects.length === 0 ? (
          <div
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
            role="status"
          >
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="h-52 rounded-2xl" />
            ))}
          </div>
        ) : projectsQuery.isError && projects.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <CircleAlert
              className="mx-auto size-5 text-amber-400"
              aria-hidden
            />
            <p className="mt-3 text-sm font-semibold">
              {copy.projectsLoadError}
            </p>
            <button
              type="button"
              onClick={() => void projectsQuery.refetch()}
              className="mt-2 text-xs font-semibold text-primary hover:underline"
            >
              {copy.retry}
            </button>
          </div>
        ) : projects.length === 0 ? (
          <EmptyProjects copy={copy} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {projects.slice(0, 6).map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                agents={agents}
                copy={copy}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>

      <section
        aria-label={copy.sharedSpacesLabel}
        className="mt-16 grid gap-3 md:grid-cols-3"
      >
        <CapabilityLink
          href="/company-chat"
          icon={MessageSquareText}
          copy={copy}
          title={copy.companyRoomTitle}
          description={copy.companyRoomDescription}
        />
        <CapabilityLink
          href="/projects"
          icon={PackageCheck}
          copy={copy}
          title={copy.trackProjectsTitle}
          description={copy.trackProjectsDescription}
        />
        <CapabilityLink
          href="/workforces"
          icon={UsersRound}
          copy={copy}
          title={copy.buildTeamTitle}
          description={copy.buildTeamDescription}
        />
      </section>
    </div>
  );
}

function TeamCrest({
  agents,
  loading,
  copy,
  locale,
}: {
  agents: Agent[];
  loading: boolean;
  copy: HomeCopy;
  locale: Locale;
}) {
  if (loading && agents.length === 0) {
    return (
      <div
        className="flex max-w-full flex-wrap justify-center gap-2"
        role="status"
        aria-label={copy.teamLoading}
      >
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Skeleton
            key={item}
            className="size-10 rounded-full ring-2 ring-background"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 max-w-full items-center justify-center"
      aria-label={copy.activeTeamMembers.replace(
        "{count}",
        new Intl.NumberFormat(locale).format(agents.length),
      )}
    >
      <div className="flex min-w-0 max-w-full flex-wrap justify-center gap-2">
        {agents.slice(0, 9).map((agent) => (
          <span
            key={agent.id}
            className="rounded-full ring-2 ring-background transition-transform hover:z-10 hover:-translate-y-1"
            title={`${agent.name} · ${agent.role}`}
          >
            <AgentAvatar agent={agent} size="md" />
          </span>
        ))}
        {agents.length > 9 ? (
          <span className="grid size-10 place-items-center rounded-full border border-border bg-secondary text-[12px] font-semibold ring-2 ring-background">
            +{agents.length - 9}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  agents,
  copy,
  locale,
}: {
  project: Task;
  agents: Agent[];
  copy: HomeCopy;
  locale: Locale;
}) {
  const status = TASK_STATUS_META[project.status];
  const owner = agents.find((agent) => agent.id === project.ownerAgentId);
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex min-h-52 flex-col rounded-2xl border border-border bg-card p-5 transition-[border-color,transform,background-color] hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[12px] font-semibold",
            status.className,
          )}
        >
          {taskStatusLabel(project.status, locale)}
        </span>
        <span className="font-mono text-[12px] text-muted-foreground">
          #{project.id}
        </span>
      </div>
      <h3 className="mt-5 line-clamp-2 text-lg font-semibold leading-6 tracking-[-0.025em]">
        {project.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
        {splitProjectBrief(project.brief).outcome}
      </p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <div
          className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
          aria-label={copy.projectOwner}
        >
          {owner ? (
            <AgentAvatar agent={owner} size="xs" />
          ) : (
            <FolderKanban className="size-4" aria-hidden />
          )}
          <span className="truncate">
            {owner?.name ?? `#${project.ownerAgentId}`}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {timeAgo(project.updatedAt)}
          <ArrowRight
            className="size-3 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}

function EmptyProjects({ copy }: { copy: HomeCopy }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-panel border border-dashed border-border px-6 py-6 text-center">
      <span className="grid size-12 place-items-center rounded-2xl border border-border bg-card text-muted-foreground">
        <FolderKanban className="size-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-sm font-semibold">{copy.emptyProjectsTitle}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
        {copy.emptyProjectsDescription}
      </p>
      <Button asChild variant="outline" size="sm" className="mt-4 rounded-xl">
        <Link href="/projects/new">
          <Plus className="me-1.5 size-3.5" aria-hidden />{" "}
          {copy.detailedProject}
        </Link>
      </Button>
    </div>
  );
}

function CapabilityLink({
  href,
  icon: Icon,
  title,
  description,
  copy,
}: {
  href: string;
  icon: typeof FolderKanban;
  title: string;
  description: string;
  copy: HomeCopy;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border bg-card/55 p-5 transition-colors hover:border-foreground/20 hover:bg-card"
    >
      <Icon
        className="size-4 text-muted-foreground"
        strokeWidth={1.7}
        aria-hidden
      />
      <h3 className="mt-5 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground group-hover:text-foreground">
        {copy.open} <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
      </span>
    </Link>
  );
}

function ComposerSkeleton() {
  return <Skeleton className="h-[260px] w-full rounded-[20px]" />;
}

function LoadFailure({
  onRetry,
  copy,
}: {
  onRetry: () => void;
  copy: HomeCopy;
}) {
  return (
    <div className="rounded-panel border border-attention/25 bg-attention/5 p-6 text-center">
      <CircleAlert
        className="mx-auto size-5 text-attention-foreground"
        aria-hidden
      />
      <p className="mt-3 text-sm font-semibold">{copy.rosterLoadError}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {copy.rosterLoadDescription}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 text-xs font-semibold text-primary hover:underline"
      >
        {copy.retry}
      </button>
    </div>
  );
}

function newestProjectFirst(left: Task, right: Task): number {
  return (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}
