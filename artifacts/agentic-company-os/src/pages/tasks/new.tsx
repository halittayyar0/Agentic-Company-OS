import { lazy, Suspense, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListTasksQueryKey,
  useCreateTask,
  useListAgents,
  type Agent,
  type TaskAutonomyMode,
  type TaskInput,
  type TaskPriority,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowUp,
  BriefcaseBusiness,
  Clock3,
  Repeat2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { AgentAvatar } from "@/components/agent/agent-avatar";

const ProviderSetupNotice = lazy(
  () => import("@/components/studio/provider-setup-notice"),
);
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { Locale } from "@/lib/i18n";
import {
  loadNewProjectCopy,
  type NewProjectCopy,
  type ProjectCadence,
} from "@/lib/new-project-copy";
import { cn } from "@/lib/utils";
import { readSkillDraft } from "@/lib/skill-draft";

const AUTONOMY_OPTIONS = ["finite", "continuous"] as const;
const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const;
const COMPACT_TEAM_SIZE = 6;
const VISIBLE_TEAM_SIZE = 10;

function handleRadioKey<T extends string>(
  event: React.KeyboardEvent<HTMLButtonElement>,
  options: readonly T[],
  value: T,
  onChange: (next: T) => void,
) {
  if (
    ![
      "ArrowDown",
      "ArrowRight",
      "ArrowUp",
      "ArrowLeft",
      "Home",
      "End",
    ].includes(event.key)
  ) {
    return;
  }

  event.preventDefault();
  const currentIndex = Math.max(0, options.indexOf(value));
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const rtl = group && window.getComputedStyle(group).direction === "rtl";
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = options.length - 1;
  else if (
    event.key === "ArrowDown" ||
    (event.key === "ArrowRight" && !rtl) ||
    (event.key === "ArrowLeft" && rtl)
  ) {
    nextIndex = (currentIndex + 1) % options.length;
  } else {
    nextIndex = (currentIndex - 1 + options.length) % options.length;
  }

  onChange(options[nextIndex]);
  window.requestAnimationFrame(() => {
    group
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      .item(nextIndex)
      .focus();
  });
}

export default function NewTask() {
  const { locale, t } = useLocale();
  const copyQuery = useQuery({
    queryKey: ["new-project-copy", locale],
    queryFn: () => loadNewProjectCopy(locale),
    staleTime: Infinity,
    retry: false,
  });

  if (copyQuery.isError) {
    return (
      <div
        role="alert"
        className="mx-auto w-full max-w-[980px] rounded-panel border border-attention/25 bg-attention/5 p-6 text-center"
      >
        <p className="text-sm font-semibold">{t("newProjectCopyError")}</p>
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
        className="mx-auto w-full max-w-[980px]"
        role="status"
        aria-label={t("loadingScreen")}
      >
        <Skeleton className="h-96 w-full rounded-panel" />
      </div>
    );
  }

  return <NewTaskForm copy={copyQuery.data} locale={locale} />;
}

function NewTaskForm({
  copy,
  locale,
}: {
  copy: NewProjectCopy;
  locale: Locale;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    data: agents,
    isPending: agentsPending,
    isError: agentsError,
    refetch: refetchAgents,
  } = useListAgents({ includeInactive: false });
  const createTask = useCreateTask();
  const { state: opsState, isScopeBlocked } = useOpsControl();
  const taskStartBlocked = isScopeBlocked("task_scheduler");
  const activeAgents = agents ?? [];

  const [initialSkillDraft] = useState(() =>
    readSkillDraft(window.history.state),
  );
  const [title, setTitle] = useState(initialSkillDraft?.title ?? "");
  const [brief, setBrief] = useState(initialSkillDraft?.brief ?? "");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [autonomyMode, setAutonomyMode] = useState<TaskAutonomyMode>("finite");
  const [cadenceSeconds, setCadenceSeconds] = useState<ProjectCadence>(3600);
  const [validationError, setValidationError] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (taskStartBlocked || createTask.isPending) return;
    if (!title.trim() || !brief.trim()) {
      setValidationError(true);
      (title.trim() ? briefRef : titleRef).current?.focus();
      return;
    }
    if (activeAgents.length === 0) {
      toast({
        title: copy.noTeamTitle,
        description: copy.noTeamDescription,
        variant: "destructive",
      });
      return;
    }

    const projectInput = {
      title: title.trim(),
      brief: brief.trim(),
      priority,
      autonomyMode,
      ...(autonomyMode === "continuous" ? { cadenceSeconds } : {}),
    } satisfies TaskInput;

    createTask.mutate(
      { data: projectInput },
      {
        onSuccess: (newTask) => {
          toast({
            title: copy.successTitle,
            description: copy.successDescription(newTask.id),
          });
          void queryClient.invalidateQueries({
            queryKey: getListTasksQueryKey(),
          });
          setLocation(`/projects/${newTask.id}`);
        },
        onError: () =>
          toast({
            title: copy.failureTitle,
            description: copy.failureDescription,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[980px] pb-16 pt-2 sm:pt-8">
      <Link
        href="/projects"
        className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowLeft
          size={15}
          className={locale === "ar" ? "rotate-180" : undefined}
          aria-hidden
        />
        {copy.back}
      </Link>

      <header className="mx-auto mt-8 max-w-3xl text-center sm:mt-12">
        <TeamPortraits
          agents={activeAgents}
          loading={agentsPending}
          copy={copy}
        />
        <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">
          {copy.eyebrow}
        </p>
        <h1 className="mx-auto mt-3 max-w-3xl font-serif text-[38px] font-medium leading-[1.06] tracking-[-0.045em] text-foreground sm:text-5xl lg:text-[58px]">
          {copy.title}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          {copy.teamDescription(activeAgents.length)}
        </p>
      </header>

      {agentsError ? (
        <div
          role="alert"
          className="mx-auto mt-6 flex max-w-2xl items-center justify-between gap-4 rounded-[12px] border border-destructive/25 bg-destructive/[0.055] px-4 py-3 text-sm text-destructive"
        >
          <span>{copy.teamUnavailable}</span>
          <button
            type="button"
            onClick={() => void refetchAgents()}
            className="min-h-11 shrink-0 font-semibold underline underline-offset-4"
          >
            {copy.retry}
          </button>
        </div>
      ) : null}

      {!agentsPending && !agentsError && activeAgents.length === 0 ? (
        <p
          role="status"
          className="mx-auto mt-4 max-w-2xl rounded-[12px] border border-attention/25 bg-attention/5 px-4 py-3 text-sm"
        >
          {copy.noTeamDescription}
        </p>
      ) : null}

      <div className="mx-auto max-w-3xl">
        <Suspense fallback={null}>
          <ProviderSetupNotice
            onReady={() =>
              (title.trim() ? briefRef : titleRef).current?.focus()
            }
          />
        </Suspense>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mx-auto mt-8 max-w-3xl"
      >
        <div className="overflow-hidden rounded-[22px] border border-foreground/15 bg-card shadow-[0_40px_130px_-78px_hsl(var(--foreground))] transition-[border-color,box-shadow] focus-within:border-foreground/30 focus-within:shadow-[0_44px_140px_-74px_hsl(var(--foreground))]">
          <div className="border-b border-border/75 px-5 py-4 sm:px-7 sm:py-5">
            <Label
              htmlFor="title"
              className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {copy.projectName}
            </Label>
            <input
              id="title"
              ref={titleRef}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setValidationError(false);
              }}
              placeholder={copy.namePlaceholder}
              required
              maxLength={300}
              aria-invalid={validationError && !title.trim()}
              aria-describedby={
                validationError && !title.trim()
                  ? "project-validation-error"
                  : undefined
              }
              className="mt-2 min-h-11 w-full rounded-control bg-transparent text-lg font-semibold tracking-[-0.025em] text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary sm:text-xl"
            />
          </div>

          <div className="px-5 pb-5 pt-5 sm:px-7 sm:pb-6">
            <Label
              htmlFor="brief"
              className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {copy.brief}
            </Label>
            <textarea
              id="brief"
              ref={briefRef}
              value={brief}
              onChange={(event) => {
                setBrief(event.target.value);
                setValidationError(false);
              }}
              placeholder={copy.briefPlaceholder}
              required
              maxLength={8_000}
              rows={8}
              aria-invalid={validationError && !brief.trim()}
              aria-describedby={
                validationError && !brief.trim()
                  ? "project-validation-error"
                  : undefined
              }
              className="min-h-52 w-full resize-none rounded-control bg-transparent text-[16px] leading-7 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary sm:text-[17px]"
            />
          </div>

          {validationError ? (
            <div
              id="project-validation-error"
              role="alert"
              className="mx-5 mb-5 rounded-[12px] border border-destructive/25 bg-destructive/[0.055] px-4 py-3 text-sm sm:mx-7"
            >
              <p className="font-semibold">{copy.validationTitle}</p>
              <p className="mt-1 text-muted-foreground">
                {copy.validationDescription}
              </p>
            </div>
          ) : null}

          <div className="border-t border-border/75 bg-background/45 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div
                className="flex min-w-0 flex-wrap items-center gap-1"
                role="radiogroup"
                aria-label={copy.projectType}
              >
                {AUTONOMY_OPTIONS.map((option) => {
                  const active = autonomyMode === option;
                  const Icon =
                    option === "finite" ? BriefcaseBusiness : Repeat2;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      onClick={() => setAutonomyMode(option)}
                      onKeyDown={(event) =>
                        handleRadioKey<TaskAutonomyMode>(
                          event,
                          AUTONOMY_OPTIONS,
                          autonomyMode,
                          setAutonomyMode,
                        )
                      }
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        active
                          ? "border-foreground/20 bg-foreground text-background"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground",
                      )}
                    >
                      <Icon size={13} aria-hidden />
                      {option === "finite" ? copy.finite : copy.continuous}
                    </button>
                  );
                })}
              </div>

              <div
                className="flex min-w-0 flex-wrap items-center gap-1 lg:border-s lg:border-border lg:ps-4"
                role="radiogroup"
                aria-label={copy.priority}
              >
                {PRIORITY_OPTIONS.map((option) => {
                  const active = priority === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      onClick={() => setPriority(option)}
                      onKeyDown={(event) =>
                        handleRadioKey<TaskPriority>(
                          event,
                          PRIORITY_OPTIONS,
                          priority,
                          setPriority,
                        )
                      }
                      className={cn(
                        "min-h-11 rounded-[10px] border px-3 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        active
                          ? "border-foreground/20 bg-card text-foreground shadow-sm"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground",
                      )}
                    >
                      {copy.priorities[option]}
                    </button>
                  );
                })}
              </div>

              <button
                type="submit"
                disabled={
                  createTask.isPending ||
                  taskStartBlocked ||
                  agentsPending ||
                  agentsError ||
                  activeAgents.length === 0
                }
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] bg-foreground px-5 text-sm font-semibold text-background transition-[transform,opacity] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 lg:ms-auto"
              >
                {createTask.isPending ? copy.starting : copy.start}
                <ArrowUp size={16} aria-hidden />
              </button>
            </div>

            {autonomyMode === "continuous" ? (
              <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center">
                <label
                  htmlFor="cadence"
                  className="inline-flex items-center gap-2 text-xs font-semibold"
                >
                  <Clock3 size={14} className="text-muted-foreground" />
                  {copy.cadence}
                </label>
                <select
                  id="cadence"
                  value={cadenceSeconds}
                  onChange={(event) =>
                    setCadenceSeconds(
                      Number(event.target.value) as ProjectCadence,
                    )
                  }
                  className="min-h-11 rounded-[10px] border border-border bg-card px-3 text-xs sm:ms-auto sm:min-w-44"
                >
                  <option value={900}>{copy.cadences[900]}</option>
                  <option value={3600}>{copy.cadences[3600]}</option>
                  <option value={21600}>{copy.cadences[21600]}</option>
                  <option value={86400}>{copy.cadences[86400]}</option>
                  <option value={604800}>{copy.cadences[604800]}</option>
                </select>
              </div>
            ) : null}
          </div>
        </div>

        <p className="mt-3 flex items-center justify-center gap-2 text-center text-[12px] text-muted-foreground">
          <Sparkles size={13} aria-hidden /> {copy.contextNote}
        </p>

        {taskStartBlocked ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-[12px] border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
            role="status"
          >
            <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            {opsState?.emergencyStopEnabled
              ? copy.emergencyStop
              : copy.safetyUnverified}
          </div>
        ) : null}
      </form>
    </div>
  );
}

function TeamPortraits({
  agents,
  loading,
  copy,
}: {
  agents: Agent[];
  loading: boolean;
  copy: NewProjectCopy;
}) {
  if (loading && agents.length === 0) {
    return (
      <div
        className="flex min-h-16 flex-wrap items-center justify-center gap-y-2"
        role="status"
        aria-label={copy.teamLoading}
      >
        {Array.from({ length: 7 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "-ms-3 h-[3.25rem] w-[2.6rem] animate-pulse rounded-xl border-2 border-background bg-muted",
              index === 0 && "ms-0",
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-16 flex-wrap items-center justify-center gap-y-2 ps-3"
      aria-label={copy.teamAria(agents.length)}
    >
      {agents.slice(0, VISIBLE_TEAM_SIZE).map((agent, index) => (
        <AgentAvatar
          key={agent.id}
          agent={agent}
          size="md"
          showStatus
          className={cn(
            "-ms-3 border-2 border-background shadow-[0_12px_28px_-16px_rgba(0,0,0,0.85)] ring-0",
            index === 0 && "ms-0",
            index >= COMPACT_TEAM_SIZE && "hidden sm:block",
          )}
        />
      ))}
      {agents.length > COMPACT_TEAM_SIZE ? (
        <span className="relative -ms-3 grid size-11 shrink-0 place-items-center rounded-xl border-2 border-background bg-muted text-[12px] font-semibold text-muted-foreground shadow-sm sm:hidden">
          +{agents.length - COMPACT_TEAM_SIZE}
        </span>
      ) : null}
      {agents.length > VISIBLE_TEAM_SIZE ? (
        <span className="relative -ms-3 hidden size-11 shrink-0 place-items-center rounded-xl border-2 border-background bg-muted text-[12px] font-semibold text-muted-foreground shadow-sm sm:grid">
          +{agents.length - VISIBLE_TEAM_SIZE}
        </span>
      ) : null}
    </div>
  );
}
