import type { ActivityEvent, Task } from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { type ProjectStudioCopy, studioText } from "@/lib/project-studio-copy";
import { taskStatusLabel } from "@/lib/format";

/** Summarize stored facts. An event count cannot establish verified delivery. */
export function HandoffSpine({
  task,
  activities,
  subtasks,
  c,
  activityKnown,
  tasksKnown,
  activityLoading,
  tasksLoading,
}: {
  task: Task;
  activities: ActivityEvent[];
  subtasks: Task[];
  c: ProjectStudioCopy;
  activityKnown: boolean;
  tasksKnown: boolean;
  activityLoading: boolean;
  tasksLoading: boolean;
}) {
  const { locale } = useLocale();
  const children = subtasks.filter((item) => item.parentTaskId === task.id);
  const completed = children.filter(
    (item) => item.status === "completed",
  ).length;
  const count = activities.filter((item) => item.taskId === task.id).length;
  return (
    <section
      aria-labelledby="project-record-summary"
      className="border-t border-border px-4 py-4 sm:px-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="project-record-summary" className="text-sm font-semibold">
          {c.runSummary}
        </h2>
        <p className="text-xs text-muted-foreground">
          {activityKnown
            ? studioText(c.recordsHelp, { count: count.toLocaleString(locale) })
            : activityLoading
              ? c.recordsLoading
              : c.recordsMissing}
        </p>
      </div>
      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{c.recordStatus}</dt>
          <dd className="mt-1 text-sm font-semibold">
            {taskStatusLabel(task.status, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{c.progress}</dt>
          <dd className="mt-1 text-sm font-semibold">
            {new Intl.NumberFormat(locale, {
              style: "percent",
              maximumFractionDigits: 1,
            }).format(task.progressPercent / 100)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{c.completedWork}</dt>
          <dd className="mt-1 text-sm font-semibold">
            {tasksKnown ? (
              <bdi>
                {completed.toLocaleString(locale)} /{" "}
                {children.length.toLocaleString(locale)}
              </bdi>
            ) : tasksLoading ? (
              c.tasksLoading
            ) : (
              c.unavailable
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
