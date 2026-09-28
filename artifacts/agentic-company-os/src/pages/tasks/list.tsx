import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getListAgentsQueryKey,
  useListAgents,
  type Agent,
  type Task,
  type TaskStatus,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowRight,
  FolderKanban,
  Inbox,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

import { AgentAvatar } from "@/components/agent/agent-avatar";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { taskStatusLabel, timeAgo } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { splitProjectBrief } from "@/lib/project-brief";
import {
  loadProjectListCopy,
  type ProjectCollection,
  type ProjectListCopy,
} from "@/lib/project-list-copy";
import { cn } from "@/lib/utils";
import { useRecordHistory } from "@/hooks/use-record-history";
import { HistoryControls } from "@/components/history-controls";

const PROJECT_PAGE_LIMIT = 200;

const ACTIVE_STATUSES = new Set<TaskStatus>([
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
  "blocked",
]);

const COLLECTIONS: ProjectCollection[] = ["all", "active", "completed"];

export default function TasksList() {
  const { locale, t } = useLocale();
  const copyQuery = useQuery({
    queryKey: ["project-list-copy", locale],
    queryFn: () => loadProjectListCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const [collection, setCollection] = useState<ProjectCollection>("all");
  const [search, setSearch] = useState("");

  const projectsQuery = useRecordHistory<Task>(
    { kind: "projects" },
    {
      limit: PROJECT_PAGE_LIMIT,
      interval: 10_000,
    },
  );
  const agentsQuery = useListAgents(
    { includeInactive: false },
    { query: { queryKey: getListAgentsQueryKey({ includeInactive: false }) } },
  );
  const { isScopeBlocked } = useOpsControl();
  const projectStartBlocked = isScopeBlocked("task_scheduler");
  const agents = agentsQuery.data ?? [];
  const projects = useMemo(
    () => (projectsQuery.data ?? []).slice().sort(newestProjectFirst),
    [projectsQuery.data],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase(locale);

  const collectionCounts = useMemo(
    () => ({
      all: projects.length,
      active: projects.filter((project) => ACTIVE_STATUSES.has(project.status))
        .length,
      completed: projects.filter((project) => project.status === "completed")
        .length,
    }),
    [projects],
  );

  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (!projectMatchesCollection(project, collection)) return false;
        if (!normalizedSearch) return true;
        return `${project.title} ${project.brief}`
          .toLocaleLowerCase(locale)
          .includes(normalizedSearch);
      }),
    [collection, locale, normalizedSearch, projects],
  );

  if (copyQuery.isError) {
    return (
      <div
        role="alert"
        className="mx-auto w-full max-w-[1180px] rounded-panel border border-attention/25 bg-attention/5 p-6 text-center"
      >
        <p className="text-sm font-semibold">{t("projectListCopyError")}</p>
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
        className="mx-auto w-full max-w-[1180px]"
        role="status"
        aria-label={t("loadingScreen")}
      >
        <Skeleton className="h-72 w-full rounded-panel" />
      </div>
    );
  }

  const copy = copyQuery.data;

  return (
    <div className="mx-auto w-full max-w-[1180px] pb-16 pt-3 sm:pt-8">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-[12px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.045em] text-foreground sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            {copy.description}
          </p>
        </div>

        {projectStartBlocked ? (
          <Button
            type="button"
            disabled
            title={copy.schedulerPaused}
            className="h-11 rounded-[12px] px-4"
          >
            <Plus className="me-2 size-4" aria-hidden /> {copy.newProject}
          </Button>
        ) : (
          <Button asChild className="h-11 rounded-[12px] px-4">
            <Link href="/projects/new">
              <Plus className="me-2 size-4" aria-hidden /> {copy.newProject}
            </Link>
          </Button>
        )}
      </header>

      <section className="mt-10" aria-labelledby="project-list-heading">
        <h2 id="project-list-heading" className="sr-only">
          {copy.listLabel}
        </h2>
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-[12px] border border-border bg-card p-1"
            role="group"
            aria-label={copy.filterLabel}
          >
            {COLLECTIONS.map((value) => {
              const active = collection === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCollection(value)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-[9px] px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                >
                  {copy.collections[value]}
                  <span
                    className={cn(
                      "font-mono text-[12px] tabular-nums",
                      active ? "text-background/65" : "text-muted-foreground",
                    )}
                  >
                    {collectionCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="relative block w-full sm:w-64">
            <span className="sr-only">{copy.search}</span>
            <Search
              size={15}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.search}
              className="h-11 w-full rounded-[12px] border border-border bg-card pe-3 ps-9 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/25 focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>

        <p className="pt-3 text-sm text-muted-foreground">
          {t("historyPageFilters")}
        </p>
        <HistoryControls history={projectsQuery} />

        <ProjectListBody
          projects={filteredProjects}
          agents={agents}
          loading={projectsQuery.isLoading && projects.length === 0}
          error={projectsQuery.isError && projects.length === 0}
          untouched={
            collection === "all" &&
            normalizedSearch.length === 0 &&
            projectsQuery.page?.beforeId === null
          }
          projectStartBlocked={projectStartBlocked}
          onRetry={() => void projectsQuery.refetch()}
          copy={copy}
          locale={locale}
        />
      </section>
    </div>
  );
}

function ProjectListBody({
  projects,
  agents,
  loading,
  error,
  untouched,
  projectStartBlocked,
  onRetry,
  copy,
  locale,
}: {
  projects: Task[];
  agents: Agent[];
  loading: boolean;
  error: boolean;
  untouched: boolean;
  projectStartBlocked: boolean;
  onRetry: () => void;
  copy: ProjectListCopy;
  locale: Locale;
}) {
  if (loading) {
    return (
      <div
        className="grid gap-3 pt-5 md:grid-cols-2"
        role="status"
        aria-label={copy.loading}
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[210px] rounded-[16px]" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex min-h-80 flex-col items-center justify-center px-5 py-10 text-center"
        role="alert"
      >
        <AlertCircle className="size-6 text-destructive" aria-hidden />
        <p className="mt-3 text-sm font-semibold">{copy.errorTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {copy.errorDescription}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 text-xs font-semibold text-primary underline underline-offset-4"
        >
          {copy.retry}
        </button>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center px-5 py-10 text-center">
        <span className="grid size-11 place-items-center rounded-[13px] border border-border bg-card text-muted-foreground">
          {untouched ? (
            <Sparkles size={18} aria-hidden />
          ) : (
            <Inbox size={18} aria-hidden />
          )}
        </span>
        <p className="mt-4 text-sm font-semibold">
          {untouched ? copy.emptyInitialTitle : copy.emptyFilteredTitle}
        </p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          {untouched
            ? copy.emptyInitialDescription
            : copy.emptyFilteredDescription}
        </p>
        {untouched ? (
          projectStartBlocked ? (
            <Button className="mt-5" type="button" disabled>
              <Plus className="me-2 size-4" aria-hidden /> {copy.newProject}
            </Button>
          ) : (
            <Button asChild className="mt-5 rounded-[10px]">
              <Link href="/projects/new">
                <Plus className="me-2 size-4" aria-hidden /> {copy.createFirst}
              </Link>
            </Button>
          )
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 pt-5 md:grid-cols-2">
      {projects.map((project) => {
        const progress = clampProgress(project.progressPercent);
        return (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="group relative flex min-h-[210px] min-w-0 flex-col overflow-hidden rounded-[16px] border border-border bg-card p-5 transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_22px_64px_-48px_hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="flex items-start justify-between gap-4">
              <ProjectStatus status={project.status} locale={locale} />
              <ArrowRight
                size={15}
                className={cn(
                  "text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground",
                  locale === "ar" && "rotate-180",
                )}
                aria-hidden
              />
            </div>

            <h3
              dir="auto"
              className="mt-5 line-clamp-2 text-lg font-semibold leading-6 tracking-[-0.025em]"
            >
              {project.title}
            </h3>
            <p
              dir="auto"
              className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground"
            >
              {splitProjectBrief(project.brief).outcome}
            </p>

            <div className="mt-auto flex min-w-0 items-end justify-between gap-4 pt-5">
              <ProjectOwner
                agent={agents.find(
                  (agent) => agent.id === project.ownerAgentId,
                )}
                ownerId={project.ownerAgentId}
                copy={copy}
              />
              <div className="shrink-0 text-end text-[12px] text-muted-foreground">
                <p>{timeAgo(project.updatedAt)}</p>
                <p className="mt-1 font-mono tabular-nums">
                  {new Intl.NumberFormat(locale, {
                    style: "percent",
                    maximumFractionDigits: 0,
                  }).format(progress / 100)}
                </p>
              </div>
            </div>

            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[2px] bg-muted"
            >
              <span
                className="block h-full bg-foreground/60 transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function ProjectOwner({
  agent,
  ownerId,
  copy,
}: {
  agent?: Agent;
  ownerId: number;
  copy: ProjectListCopy;
}) {
  return (
    <span
      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
      aria-label={agent ? copy.owner(agent.name) : copy.ownerId(ownerId)}
    >
      {agent ? (
        <AgentAvatar
          agent={agent}
          size="xs"
          className="shrink-0 border-2 border-card ring-0"
        />
      ) : (
        <FolderKanban size={16} aria-hidden />
      )}
      <span className="truncate">{agent?.name ?? `#${ownerId}`}</span>
    </span>
  );
}

function ProjectStatus({
  status,
  locale,
}: {
  status: TaskStatus;
  locale: Locale;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold",
        projectStatusClass(status),
      )}
    >
      <span
        className="size-1.5 rounded-full bg-current opacity-80"
        aria-hidden
      />
      {taskStatusLabel(status, locale)}
    </span>
  );
}

function projectMatchesCollection(
  project: Task,
  collection: ProjectCollection,
): boolean {
  if (collection === "active") return ACTIVE_STATUSES.has(project.status);
  if (collection === "completed") return project.status === "completed";
  return true;
}

function projectStatusClass(status: TaskStatus): string {
  switch (status) {
    case "planning":
    case "in_progress":
      return "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300";
    case "awaiting_approval":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
    case "blocked":
      return "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300";
    case "completed":
      return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "failed":
      return "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300";
    default:
      return "border-border bg-muted/55 text-muted-foreground";
  }
}

function newestProjectFirst(left: Task, right: Task): number {
  return (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, progress));
}
