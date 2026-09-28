import { ActivitySummary } from "@/components/activity-summary";
import {
  getListActivityQueryKey,
  getListAgentMessagesQueryKey,
  useListActivity,
  useListAgentMessages,
  type Agent,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import type { ExpertDetailCopy } from "@/lib/expert-detail-copy";
import type { Locale } from "@/lib/i18n";
import { useDocumentVisible } from "@/hooks/use-page-activity";

/** Bounded samples, never lifetime, successful-action or billing counters. */
export function AgentStats({
  agent,
  c,
  locale,
}: {
  agent: Agent;
  c: ExpertDetailCopy;
  locale: Locale;
}) {
  const visible = useDocumentVisible();
  const activityParams = { agentId: agent.id, limit: 200 };
  const messageParams = { limit: 200 };
  const activity = useListActivity(activityParams, {
    query: {
      queryKey: getListActivityQueryKey(activityParams),
      retry: false,
      refetchInterval: visible ? 15_000 : false,
    },
  });
  const messages = useListAgentMessages(agent.id, messageParams, {
    query: {
      queryKey: getListAgentMessagesQueryKey(agent.id, messageParams),
      retry: false,
      refetchInterval: visible ? 20_000 : false,
    },
  });
  const refresh = (
    <Button
      variant="outline"
      disabled={activity.isFetching || messages.isFetching}
      onClick={() => {
        void activity.refetch();
        void messages.refetch();
      }}
    >
      {c.refresh}
    </Button>
  );
  if (activity.isPending || messages.isPending)
    return <p role="status">{c.loading}</p>;
  if (activity.isError || messages.isError)
    return (
      <section
        role="alert"
        className="space-y-4 rounded-panel border bg-card p-5"
      >
        <p>{c.statsError}</p>
        {refresh}
      </section>
    );
  const events = [...(activity.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const replies = (messages.data ?? []).filter(
    (message) => message.role === "agent",
  );
  const tools = events.filter(
    (event) => event.type === "vm_command" || event.type === "vm_file",
  );
  const counters = [
    [c.replies, replies.length],
    [c.toolEvents, tools.length],
    [
      c.createdTasks,
      events.filter((event) => event.type === "task_created").length,
    ],
    [
      c.delegations,
      events.filter((event) => event.type === "task_delegated").length,
    ],
    [c.reviews, events.filter((event) => event.type === "judge_review").length],
    [
      c.approvalRequests,
      events.filter((event) => event.type === "approval_requested").length,
    ],
  ] as const;
  const models = new Map<string, number>();
  for (const reply of replies)
    if (reply.modelId)
      models.set(reply.modelId, (models.get(reply.modelId) ?? 0) + 1);
  const top = [...models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const date = (value: string) =>
    Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString(locale)
      : "—";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{c.stats}</h2>
        {refresh}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{c.statsWindow}</p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {counters.map(([label, count]) => (
          <div key={label} className="rounded-panel border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">
              {number.format(count)}
            </dd>
          </div>
        ))}
      </dl>
      <section className="space-y-4 rounded-panel border bg-card p-4 sm:p-5">
        <h3 className="font-semibold">{c.modelUsage}</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          {c.modelUsageHelp}
        </p>
        {top.length === 0 ? (
          <p className="text-sm">{c.noModels}</p>
        ) : (
          <ul className="space-y-4">
            {top.map(([id, count]) => (
              <li key={id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <bdi className="break-all font-mono">{id}</bdi>
                  <span className="tabular-nums">
                    {number.format(count)} ·{" "}
                    {percent.format(count / replies.length)}
                  </span>
                </div>
                <div
                  aria-hidden
                  className="h-2 overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(count / replies.length) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <dl className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{c.records}</dt>
            <dd>{number.format(events.length)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{c.oldest}</dt>
            <dd>
              {events.length ? date(events[events.length - 1].createdAt) : "—"}
            </dd>
          </div>
        </dl>
      </section>
      <section className="space-y-4 rounded-panel border bg-card p-4 sm:p-5">
        <h3 className="font-semibold">{c.recentTools}</h3>
        <p className="text-xs text-muted-foreground">{c.source}</p>
        {tools.length === 0 ? (
          <p className="text-sm">{c.noTools}</p>
        ) : (
          <ul className="max-h-96 space-y-3 overflow-y-auto">
            {tools.slice(0, 40).map((event) => (
              <li key={event.id} className="space-y-1 border-b pb-3 text-sm">
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={event.createdAt}
                >
                  {date(event.createdAt)}
                </time>
                <p dir="auto" className="whitespace-pre-wrap break-words">
                  <ActivitySummary event={event} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
