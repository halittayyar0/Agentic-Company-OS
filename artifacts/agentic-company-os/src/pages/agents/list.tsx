import { useMemo } from "react";
import { Link, useSearchParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getListAgentsQueryKey,
  useListAgents,
  type Agent,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Plus,
  UsersRound,
} from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { adaptivePollingInterval } from "@/lib/adaptive-polling";
import { normalizeDirectoryQuery } from "@/lib/agent-presentation";
import {
  directoryDepartment,
  directorySummary,
  loadAgentDirectoryCopy,
  type AgentDirectoryCopy,
} from "@/lib/agent-directory-copy";
import { directionForLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

export default function AgentsList() {
  const { locale, t } = useLocale();
  const copyQuery = useQuery({
    queryKey: ["agent-directory-copy", locale],
    queryFn: () => loadAgentDirectoryCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (copyQuery.isError) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[1160px] rounded-panel border border-attention/25 bg-attention/5 p-6 text-center"
      >
        <p className="text-sm font-semibold">{t("agentDirectoryCopyError")}</p>
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
        role="status"
        aria-label={t("loadingScreen")}
        className="mx-auto max-w-[1160px]"
      >
        <Skeleton className="h-72 rounded-panel" />
      </div>
    );
  }
  return <Directory copy={copyQuery.data} locale={locale} />;
}

function Directory({
  copy,
  locale,
}: {
  copy: AgentDirectoryCopy;
  locale: Locale;
}) {
  const documentVisible = useDocumentVisible();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const department = params.get("department") ?? "all";
  const status = params.get("status") ?? "all";
  const pageNumber = Math.max(
    1,
    Math.min(10000, Number(params.get("page")) || 1),
  );
  const agentsQuery = useListAgents(
    { includeInactive: false },
    {
      query: {
        queryKey: getListAgentsQueryKey({ includeInactive: false }),
        refetchInterval: (current) =>
          adaptivePollingInterval({
            documentVisible,
            live: ((current.state.data as Agent[] | undefined) ?? []).some(
              (agent) => agent.status === "working",
            ),
          }),
      },
    },
  );
  const agents = agentsQuery.data ?? [];
  const hasSnapshot = agentsQuery.data !== undefined;
  const number = new Intl.NumberFormat(locale);
  const departments = useMemo(
    () =>
      [
        ...new Set(
          agents
            .map((agent) => agent.department)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort((a, b) =>
        directoryDepartment(a, copy).localeCompare(
          directoryDepartment(b, copy),
          locale,
        ),
      ),
    [agents, copy, locale],
  );
  const normalized = normalizeDirectoryQuery(query.trim(), locale);
  const filtered = agents.filter(
    (agent) =>
      (department === "all" || agent.department === department) &&
      (status === "all" || agent.status === status) &&
      (!normalized ||
        normalizeDirectoryQuery(
          [
            agent.name,
            agent.role,
            agent.department,
            directoryDepartment(agent.department, copy),
            directorySummary(agent, copy),
          ].join(" "),
          locale,
        ).includes(normalized)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(Math.floor(pageNumber), pages);
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const update = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (!value || value === "all" || (key === "page" && value === "1"))
          next.delete(key);
        else next.set(key, value);
        if (key !== "page") next.delete("page");
        return next;
      },
      { replace: true },
    );
  const clearFilters = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of ["q", "department", "status", "page"])
          next.delete(key);
        return next;
      },
      { replace: true },
    );
  const hasFilters = Boolean(query || department !== "all" || status !== "all");

  return (
    <div className="mx-auto max-w-[1160px] space-y-7 pb-8">
      <header className="flex flex-col justify-between gap-5 border-b border-border pb-7 pt-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium text-primary">{copy.eyebrow}</p>
          <h1 className="editorial-display mt-3 break-words text-[clamp(1.875rem,3vw,2.625rem)] leading-tight">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <Button asChild className="min-h-11 shrink-0">
          <Link href="/agents/new">
            <Plus aria-hidden />
            {copy.addExpert}
          </Link>
        </Button>
      </header>

      <div className="flex flex-col gap-3 rounded-panel border border-border bg-card px-[20px] py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <UsersRound
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden
          />
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <p className="text-sm font-medium">{copy.conversationTitle}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {copy.conversationDescription}
            </p>
          </div>
        </div>
        <Link
          href="/company-chat"
          className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-control text-xs font-semibold text-primary [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copy.companyRoom}
          <ArrowUpRight
            className="size-4 shrink-0 rtl:-scale-x-100"
            aria-hidden
          />
        </Link>
      </div>

      <section aria-label={copy.directory}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchInput
            value={query}
            onChange={(value) => update("q", value)}
            label={copy.search}
            placeholder={copy.searchPlaceholder}
            className="flex-1"
          />
          <Select
            dir={directionForLocale(locale)}
            value={department}
            onValueChange={(value) => update("department", value)}
          >
            <SelectTrigger
              className="h-11 w-full sm:w-52"
              aria-label={copy.department}
            >
              <SelectValue placeholder={copy.allDepartments} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.allDepartments}</SelectItem>
              {departments.map((value) => (
                <SelectItem key={value} value={value}>
                  {directoryDepartment(value, copy)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-5 mt-4 flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={copy.filterStatus}
          >
            {[
              ["all", copy.all],
              ["idle", copy.statuses.idle],
              ["working", copy.statuses.working],
              ["blocked", copy.statuses.blocked],
            ].map(([value, label]) => (
              <Button
                type="button"
                key={value}
                variant="ghost"
                size="sm"
                aria-pressed={status === value}
                onClick={() => update("status", value)}
                className={cn(
                  "min-h-11 text-xs",
                  status === value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            {agentsQuery.isPending
              ? copy.loading
              : hasSnapshot
                ? copy.count(
                    number.format(filtered.length),
                    number.format(agents.length),
                    hasFilters,
                  )
                : copy.countUnavailable}
          </p>
        </div>
        {agentsQuery.isError ? (
          <div
            className="mb-4 flex items-start gap-3 rounded-panel border border-destructive/25 bg-destructive/5 p-5"
            role="alert"
          >
            <AlertTriangle
              className="size-5 shrink-0 text-destructive"
              aria-hidden
            />
            <div>
              <h2 className="text-sm font-semibold">
                {hasSnapshot ? copy.refreshFailed : copy.loadFailed}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasSnapshot ? copy.staleDescription : copy.errorDescription}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 min-h-11"
                aria-busy={agentsQuery.isFetching}
                aria-disabled={agentsQuery.isFetching}
                onClick={() =>
                  !agentsQuery.isFetching && void agentsQuery.refetch()
                }
              >
                {copy.retry}
              </Button>
            </div>
          </div>
        ) : null}
        {agentsQuery.isLoading && !agents.length ? (
          <div
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            role="status"
            aria-label={copy.loading}
          >
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-64 rounded-panel" />
            ))}
          </div>
        ) : filtered.length === 0 && hasSnapshot ? (
          <div className="rounded-panel border border-dashed border-border px-5 py-16 text-center">
            <Bot className="mx-auto size-7 text-muted-foreground" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">
              {agents.length ? copy.noMatch : copy.emptyTitle}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {agents.length ? copy.noMatchDescription : copy.emptyDescription}
            </p>
            {hasFilters ? (
              <Button
                type="button"
                variant="outline"
                className="mt-5 min-h-11"
                onClick={clearFilters}
              >
                {copy.clearFilters}
              </Button>
            ) : (
              <Button asChild className="mt-5 min-h-11">
                <Link href="/agents/new">{copy.addExpert}</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((agent) => (
              <AgentCard key={agent.id} agent={agent} copy={copy} />
            ))}
          </div>
        )}
        {pages > 1 ? (
          <nav
            aria-label={copy.pagination}
            className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-5"
          >
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              aria-disabled={currentPage === 1}
              onClick={() =>
                currentPage > 1 && update("page", String(currentPage - 1))
              }
            >
              {copy.previous}
            </Button>
            <span
              className="order-first w-full text-center text-xs text-muted-foreground sm:order-none sm:w-auto"
              role="status"
            >
              {copy.page(number.format(currentPage), number.format(pages))}
            </span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              aria-disabled={currentPage === pages}
              onClick={() =>
                currentPage < pages && update("page", String(currentPage + 1))
              }
            >
              {copy.next}
            </Button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}

function AgentCard({
  agent,
  copy,
}: {
  agent: Agent;
  copy: AgentDirectoryCopy;
}) {
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="group flex min-w-0 flex-col rounded-panel border border-border bg-card p-5 transition-colors hover:border-primary/45 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <AgentAvatar agent={agent} size="md" />
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px]",
            agent.status === "blocked"
              ? "border-attention/30 text-attention-foreground"
              : "border-border text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              agent.status === "working"
                ? "bg-primary"
                : agent.status === "blocked"
                  ? "bg-attention"
                  : "bg-muted-foreground",
            )}
            aria-hidden
          />
          {copy.statuses[agent.status]}
        </span>
      </div>
      <p className="mt-4 text-[12px] font-medium text-primary">
        <bdi>{directoryDepartment(agent.department, copy)}</bdi>
      </p>
      <h2 className="mt-1.5 break-words text-base font-semibold tracking-tight">
        <bdi>{agent.name}</bdi>
      </h2>
      <p className="mt-2 flex-1 break-words text-sm leading-6 text-muted-foreground">
        {directorySummary(agent, copy)}
      </p>
      <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
        <span className="truncate text-muted-foreground">
          {agent.currentAction ? (
            <bdi>{agent.currentAction}</bdi>
          ) : agent.status === "working" ? (
            copy.workingAction
          ) : (
            copy.openProfile
          )}
        </span>
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground transition-transform rtl:rotate-180 motion-safe:group-hover:translate-x-0.5 rtl:motion-safe:group-hover:-translate-x-0.5 group-hover:text-primary"
          aria-hidden
        />
      </div>
    </Link>
  );
}
