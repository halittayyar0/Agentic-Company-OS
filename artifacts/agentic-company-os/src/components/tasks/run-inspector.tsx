import { ActivitySummary } from "@/components/activity-summary";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { ActivityEvent, Agent, Task } from "@workspace/api-client-react";
import { ChevronDown, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  buildRunTrace,
  filterRunTraceEvents,
  RUN_TRACE_LIMIT,
  type RunTraceCategory,
  type RunTraceEvent,
} from "@/lib/run-trace";
import { studioText } from "@/lib/project-studio-copy";
import type { TraceCopy } from "@/lib/trace-copy";
import { cn } from "@/lib/utils";
import { TraceCopyBoundary, TraceTime } from "./trace-shared";
import { useRecordHistory } from "@/hooks/use-record-history";
import { HistoryControls } from "@/components/history-controls";

type Props = {
  task: Task;
  subtasks: Task[];
  agents: Agent[];
};
const FILTERS: RunTraceCategory[] = [
  "all",
  "people",
  "tools",
  "gates",
  "issues",
];

export function RunInspector(props: Props) {
  return (
    <TraceCopyBoundary>
      {(c) => <Inspector {...props} c={c} />}
    </TraceCopyBoundary>
  );
}

function Inspector({ task, subtasks, agents, c }: Props & { c: TraceCopy }) {
  const { locale } = useLocale();
  const history = useRecordHistory<ActivityEvent>({
    kind: "task-activity",
    taskId: task.id,
  });
  const activities = history.data ?? [];
  const known = history.page !== null;
  const updatedAt = history.dataUpdatedAt;
  const error = history.isError;
  const trace = useMemo(
    () => buildRunTrace({ task, activities, subtasks }),
    [task, activities, subtasks],
  );
  const [filter, setFilter] = useState<RunTraceCategory>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const events = filterRunTraceEvents(trace.events, filter).slice().reverse();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const actor = (id: number | null) =>
    id === null
      ? c.system
      : (agents.find((a) => a.id === id)?.name ?? studioText(c.agent, { id }));
  const capturedAt = updatedAt ? new Date(updatedAt).toISOString() : null;
  function download() {
    const payload = {
      schema: "agentic-company-os/activity-window@2",
      exportedAt: new Date().toISOString(),
      boundary: {
        source: "task-activity-api",
        taskId: task.id,
        fullHistory: false,
        receipts: false,
        limit: RUN_TRACE_LIMIT,
        capturedAt,
        beforeId: history.page?.beforeId ?? null,
        nextBeforeId: history.page?.nextBeforeId ?? null,
        pageNumber: history.trail.length + 1,
        paginationOrder: "id-desc",
        displayOrder: "createdAt-desc,id-desc",
        exportOrder: "createdAt-asc,id-asc",
        refreshFailed: Boolean(error),
        firstEventAt: trace.events[0]?.createdAt ?? null,
        lastEventAt: trace.events.at(-1)?.createdAt ?? null,
      },
      task: {
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
        ownerAgentId: task.ownerAgentId,
        assignedByAgentId: task.assignedByAgentId,
        stepCounter: task.stepAttempts,
        cycleCounter: task.cycleCount,
        lastRecordedModel: task.lastModelId,
      },
      stages: trace.stages,
      stats: trace.stats,
      events: trace.events,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `task-${task.id}-activity.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="min-w-0 space-y-5 p-4 sm:p-6" aria-label={c.title}>
      <header className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{c.title}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {c.help}
        </p>
        {task.parentTaskId === null && (
          <Button
            asChild
            variant="outline"
            className="h-auto min-h-11 whitespace-normal text-start"
          >
            <Link href={`/projects/${task.id}/operations`}>{c.operations}</Link>
          </Button>
        )}
      </header>
      <dl className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {[
          [c.steps, number(task.stepAttempts)],
          [c.cycles, number(task.cycleCount)],
          [c.owner, actor(task.ownerAgentId)],
          [c.model, task.lastModelId ?? c.unknown],
        ].map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-xl border border-border p-3"
          >
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd
              dir="auto"
              className="mt-1 break-words text-base font-medium [overflow-wrap:anywhere]"
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="mb-3 font-semibold">{c.categories}</h3>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {trace.stages.map((stage) => (
            <li
              key={stage.id}
              className="min-w-0 rounded-xl border border-border bg-secondary/30 p-3"
            >
              <h4 className="flex items-center gap-2 font-medium">
                <FileText size={16} aria-hidden />
                {c[stage.id]}
              </h4>
              <p className="mt-2 text-sm leading-relaxed">
                {stage.state === "missing" && !known
                  ? c.unknown
                  : c[stage.evidence]}
              </p>
              {stage.source && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {stage.source === "task" ? c.taskSource : c.activitySource}
                  {stage.activityId !== null && <bdi> #{stage.activityId}</bdi>}
                  <br />
                  <TraceTime
                    value={stage.timestamp}
                    locale={locale}
                    unknown={c.unknown}
                  />
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3 rounded-xl border border-border p-3 text-sm">
        <p className="font-medium">{c.snapshot}</p>
        <p className="text-muted-foreground">
          {studioText(c.window, { limit: number(RUN_TRACE_LIMIT) })}
        </p>
        <p>
          <TraceTime value={capturedAt} locale={locale} unknown={c.unknown} />
        </p>
        {known && trace.events.length > 0 && (
          <p className="text-muted-foreground">
            {c.range}:{" "}
            <TraceTime
              value={trace.events[0].createdAt}
              locale={locale}
              unknown={c.unknown}
            />{" "}
            —{" "}
            <TraceTime
              value={trace.events.at(-1)!.createdAt}
              locale={locale}
              unknown={c.unknown}
            />
          </p>
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [c.records, trace.stats.eventCount],
            [c.toolRecords, trace.stats.toolEventCount],
            [c.judges, trace.stats.judgeCount],
            [c.participants, trace.stats.uniqueAgentIds.length],
          ].map(([label, count]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-semibold">
                {known ? number(count as number) : c.unknown}
              </dd>
            </div>
          ))}
        </dl>
        <HistoryControls history={history} copy={c} />
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal text-start"
          disabled={!known}
          onClick={download}
        >
          <Download size={16} aria-hidden />
          {c.export}
        </Button>
        <p className="text-xs text-muted-foreground">{c.exportHelp}</p>
      </div>
      <div role="group" aria-label={c.title} className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item}
            variant={filter === item ? "default" : "outline"}
            className="h-auto min-h-11 whitespace-normal"
            aria-pressed={filter === item}
            onClick={() => {
              setFilter(item);
              setSelectedId(null);
            }}
          >
            {c[item]}
          </Button>
        ))}
      </div>
      {known && events.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">
          {filter === "all" ? c.empty : c.noMatch}
        </p>
      )}
      <ol className="space-y-2">
        {events.map((event) => (
          <li
            key={event.id}
            className="min-w-0 rounded-xl border border-border"
          >
            <button
              type="button"
              aria-expanded={selectedId === event.id}
              aria-controls={`trace-event-${event.id}`}
              className="flex min-h-11 w-full items-start gap-3 rounded-xl p-3 text-start hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                setSelectedId(selectedId === event.id ? null : event.id)
              }
            >
              <span className="min-w-0 flex-1 space-y-2">
                <span className="block text-xs text-muted-foreground">
                  {c.record} <bdi>#{event.id}</bdi> ·{" "}
                  <bdi>{actor(event.agentId)}</bdi> · {c[event.severity]}
                </span>
                <span
                  dir="auto"
                  className="block whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]"
                >
                  <ActivitySummary
                    summary={event.summary}
                    kind={event.operationsEventKind ?? null}
                  />
                </span>
                <span className="block text-xs text-muted-foreground">
                  <TraceTime
                    value={event.createdAt}
                    locale={locale}
                    unknown={c.unknown}
                  />
                </span>
              </span>
              <ChevronDown
                size={18}
                aria-hidden
                className={cn(
                  "mt-1 shrink-0",
                  selectedId === event.id && "rotate-180",
                )}
              />
            </button>
            <div
              id={`trace-event-${event.id}`}
              hidden={selectedId !== event.id}
              className="border-t border-border p-3"
            >
              <EventDetail c={c} event={event} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EventDetail({ c, event }: { c: TraceCopy; event: RunTraceEvent }) {
  return (
    <section
      aria-label={`${c.detail} #${event.id}`}
      className="space-y-3 text-sm"
    >
      <h4 className="font-medium">{c.detail}</h4>
      <p className="break-words text-muted-foreground">
        {c.source}: {c.activitySource} <bdi>#{event.id}</bdi> ·{" "}
        <bdi>{event.type}</bdi>
      </p>
      {event.detail.length === 0 ? (
        <p className="text-muted-foreground">{c.noDetail}</p>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2">
          {event.detail.map((item) => (
            <div key={item.key} className="min-w-0">
              <dt className="text-muted-foreground">
                {c.fields[item.key as keyof TraceCopy["fields"]] ?? item.key}
              </dt>
              <dd
                dir="auto"
                className="mt-1 whitespace-pre-wrap break-words font-mono text-xs [overflow-wrap:anywhere]"
              >
                {item.value === "true"
                  ? c.yes
                  : item.value === "false"
                    ? c.no
                    : item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
