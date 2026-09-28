import { useState } from "react";
import {
  type ActivityEvent,
  type Agent,
  type Task,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { taskStatusLabel } from "@/lib/format";
import {
  buildDelegationMessages,
  type DelegationMessage,
} from "@/lib/delegation-conversation";
import { studioText } from "@/lib/project-studio-copy";
import type { TraceCopy } from "@/lib/trace-copy";
import { TraceCopyBoundary, TraceTime } from "./trace-shared";
import { useRecordHistory } from "@/hooks/use-record-history";
import { HistoryControls } from "@/components/history-controls";

type Props = {
  task: Task;
  subtasks: Task[];
  agents: Agent[];
  tasksKnown: boolean;
  tasksLoading: boolean;
  tasksError: boolean;
  onRetryTasks: () => void;
};

export function DelegationConversation(props: Props) {
  return (
    <TraceCopyBoundary>
      {(c) => <Delegations {...props} c={c} />}
    </TraceCopyBoundary>
  );
}

function Delegations({
  task,
  subtasks,
  agents,
  tasksKnown,
  tasksLoading,
  tasksError,
  onRetryTasks,
  c,
}: Props & { c: TraceCopy }) {
  const { locale } = useLocale();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const seen = new Set<number>();
  const tasks = [
    task,
    ...subtasks.filter((child) => child.parentTaskId === task.id),
  ]
    .filter((candidate) => {
      if (candidate.assignedByAgentId === null || seen.has(candidate.id))
        return false;
      seen.add(candidate.id);
      return true;
    })
    .slice(0, 201);
  const selected =
    tasks.find((candidate) => candidate.id === selectedId) ?? tasks[0];
  const activity = useRecordHistory<ActivityEvent>(
    { kind: "task-activity", taskId: selected?.id ?? task.id },
    { enabled: selected !== undefined },
  );
  const records = activity.data;
  const known = activity.page !== null;
  const updatedAt = activity.dataUpdatedAt;
  const actor = (id: number) =>
    agents.find((agent) => agent.id === id)?.name ??
    studioText(c.agent, { id });
  return (
    <section className="min-w-0 space-y-4" aria-label={c.delegations}>
      <h2 className="text-lg font-semibold">{c.delegations}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {c.delegationHelp}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {studioText(c.delegationLimit, {
          tasks: new Intl.NumberFormat(locale).format(200),
          events: new Intl.NumberFormat(locale).format(200),
        })}
      </p>
      {tasksError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-600/40 bg-amber-500/10 p-3 text-sm"
        >
          <p>{c.taskListError}</p>
          <Button
            variant="outline"
            className="mt-2 min-h-11"
            disabled={tasksLoading}
            onClick={onRetryTasks}
          >
            {c.retry}
          </Button>
        </div>
      )}
      {!tasksKnown && !tasksError && <p role="status">{c.loading}</p>}
      {tasksKnown && tasks.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">{c.noDelegations}</p>
      )}
      {selected && (
        <>
          <label className="block text-sm font-medium">
            {c.delegations}
            <select
              className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selected.id}
              onChange={(event) => setSelectedId(Number(event.target.value))}
            >
              {tasks.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  #{candidate.id} · {candidate.title}
                </option>
              ))}
            </select>
          </label>
          <article className="min-w-0 space-y-4 rounded-xl border border-border p-4">
            <h3
              dir="auto"
              className="break-words font-semibold [overflow-wrap:anywhere]"
            >
              {selected.title}
            </h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-sm text-muted-foreground">{c.manager}</dt>
                <dd dir="auto" className="break-words [overflow-wrap:anywhere]">
                  {actor(selected.assignedByAgentId!)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm text-muted-foreground">{c.owner}</dt>
                <dd dir="auto" className="break-words [overflow-wrap:anywhere]">
                  {actor(selected.ownerAgentId)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{c.status}</dt>
                <dd>{taskStatusLabel(selected.status, locale)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  {c.lastUpdated}
                </dt>
                <dd className="text-xs">
                  <TraceTime
                    value={selected.updatedAt}
                    locale={locale}
                    unknown={c.unknown}
                  />
                </dd>
              </div>
            </dl>
            {known && (
              <p className="text-xs text-muted-foreground">
                {c.snapshot}:{" "}
                <TraceTime
                  value={updatedAt ? new Date(updatedAt).toISOString() : null}
                  locale={locale}
                  unknown={c.unknown}
                />
              </p>
            )}
            <ol className="space-y-3">
              {buildDelegationMessages(selected, records ?? []).map(
                (message) => (
                  <DelegationRecord
                    key={message.key}
                    message={message}
                    agents={agents}
                    c={c}
                  />
                ),
              )}
            </ol>
            <HistoryControls history={activity} copy={c} />
          </article>
        </>
      )}
    </section>
  );
}

/** Record-shaped, never a chat bubble claiming that an agent authored system prose. */
export function DelegationRecord({
  message,
  agents,
  c,
}: {
  message: DelegationMessage;
  agents: Agent[];
  c: TraceCopy;
}) {
  const { locale } = useLocale();
  const associated =
    message.associatedAgentId === null
      ? c.system
      : (agents.find((agent) => agent.id === message.associatedAgentId)?.name ??
        studioText(c.agent, { id: message.associatedAgentId }));
  return (
    <li className="min-w-0 rounded-xl border border-border bg-secondary/25 p-3">
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{c[message.kind]}</span>
        <bdi>{associated}</bdi>
        <span>
          {message.source === "task" ? c.taskSource : c.activitySource}
          {message.activityId !== null && <bdi> #{message.activityId}</bdi>}
        </span>
      </div>
      {message.status && (
        <p className="mt-2 text-sm">
          {c.status}: {taskStatusLabel(message.status, locale)}
        </p>
      )}
      {message.content && (
        <p
          dir="auto"
          className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]"
        >
          {message.content}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        <TraceTime
          value={message.createdAt}
          locale={locale}
          unknown={c.unknown}
        />
      </p>
    </li>
  );
}
