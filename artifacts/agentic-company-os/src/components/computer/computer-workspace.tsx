import { ActivitySummary } from "@/components/activity-summary";
import { useEffect, useRef, useState } from "react";
import {
  getGetVmStatusQueryKey,
  useGetVmStatus,
  type Agent,
  type ActivityEvent,
} from "@workspace/api-client-react";
import { BrowserWorkbench } from "@/components/browser/browser-workbench";
import { FileExplorer } from "@/components/vm/file-explorer";
import { TerminalPanel } from "@/components/vm/terminal-panel";
import { ComputerCopyBoundary } from "./computer-copy-boundary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { adaptivePollingInterval } from "@/lib/adaptive-polling";
import type { ComputerCopy } from "@/lib/computer-copy";
import type { Locale } from "@/lib/i18n";
import { useRecordHistory } from "@/hooks/use-record-history";
import { HistoryControls } from "@/components/history-controls";
import { useVisibleTab } from "@/components/ui/tabs";

type Surface = "browser" | "terminal" | "files";
type Props = {
  agent: Agent;
  terminalAllowed: boolean;
  browserAllowed: boolean;
  taskId?: number;
  projectTitle?: string;
  active?: boolean;
};
const surfaces: Surface[] = ["browser", "terminal", "files"];
export function ComputerWorkspace(props: Props) {
  return (
    <ComputerCopyBoundary>
      {(c, locale) => (
        <Workspace key={props.agent.id} {...props} c={c} locale={locale} />
      )}
    </ComputerCopyBoundary>
  );
}
function Workspace({
  agent,
  terminalAllowed,
  browserAllowed,
  taskId,
  projectTitle,
  active = true,
  c,
  locale,
}: Props & { c: ComputerCopy; locale: Locale }) {
  const visible = useDocumentVisible();
  const [surface, setSurface] = useState<Surface>(
    browserAllowed ? "browser" : terminalAllowed ? "terminal" : "files",
  );
  const [visited, setVisited] = useState(new Set<Surface>([surface]));
  const [follow, setFollow] = useState(false);
  const lastFollowed = useRef<number | null>(null);
  useEffect(() => {
    lastFollowed.current = null;
  }, [agent.id, taskId]);
  const status = useGetVmStatus(agent.id, {
    query: {
      enabled: active,
      queryKey: getGetVmStatusQueryKey(agent.id),
      refetchInterval: adaptivePollingInterval({
        active,
        documentVisible: visible,
        live: agent.status === "working",
        liveMs: 6000,
      }),
    },
  });
  const activity = useRecordHistory<ActivityEvent>(
    { kind: "activity", agentId: agent.id, ...(taskId ? { taskId } : {}) },
    {
      limit: 20,
      enabled: active,
      interval: agent.status === "working" ? 5000 : 15000,
    },
  );
  const events = activity.data?.slice(0, 20) ?? [];
  const newestAgentEvent =
    activity.page?.beforeId == null
      ? events.find(
          (event) =>
            event.detail?.actor === "agent" &&
            surfaces.includes(event.detail?.surface as Surface),
        )
      : undefined;
  const selected =
    !browserAllowed && surface === "browser"
      ? terminalAllowed
        ? "terminal"
        : "files"
      : surface;
  const tabStrip = useVisibleTab(selected);
  function select(next: Surface) {
    setSurface(next);
    setVisited((current) => new Set([...current, next]));
  }
  useEffect(() => {
    if (selected !== surface) select(selected);
  }, [selected, surface]);
  useEffect(() => {
    const id = newestAgentEvent?.id ?? null;
    const previous = lastFollowed.current;
    if (id !== null && (previous === null || id > previous))
      lastFollowed.current = id;
    if (
      !active ||
      !visible ||
      !follow ||
      !newestAgentEvent ||
      previous === null ||
      id === null ||
      id <= previous
    )
      return;
    if (
      document.activeElement?.matches(
        "input, textarea, select, [contenteditable=true]",
      ) ||
      document.querySelector('[role="dialog"]')
    )
      return;
    const next = newestAgentEvent.detail?.surface as Surface;
    if (next === "browser" && !browserAllowed) return;
    select(next);
  }, [active, visible, follow, newestAgentEvent, browserAllowed]);
  const counts =
    status.isError || status.data?.agentId !== agent.id ? null : status.data;
  return (
    <section
      aria-label={c.agentLabel.replace("{name}", agent.name)}
      className="computer-workspace min-w-0 rounded-xl border bg-card text-foreground [overflow-wrap:anywhere]"
    >
      <header className="space-y-4 border-b p-[16px] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">{c.title}</h2>
            <p dir="auto" className="break-words text-sm text-muted-foreground">
              {projectTitle || agent.name}
            </p>
          </div>
          <Button
            variant="outline"
            className="min-h-11 whitespace-normal text-start"
            disabled={status.isFetching || activity.isFetching}
            onClick={() => {
              void status.refetch();
              void activity.refetch();
            }}
          >
            {c.refresh}
          </Button>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {taskId ? c.projectScope : c.scope}
        </p>
        <p role={status.isError ? "alert" : "status"} className="text-sm">
          {status.isLoading
            ? c.loading
            : status.isError
              ? c.statusError
              : counts?.exists
                ? c.ready
                : c.notCreated}
        </p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              [c.bytes, counts?.totalBytes],
              [c.files, counts?.fileCount],
              [c.folders, counts?.dirCount],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-all text-lg font-medium tabular-nums">
                {value === undefined
                  ? "—"
                  : new Intl.NumberFormat(locale).format(value)}
              </dd>
            </div>
          ))}
        </dl>
      </header>
      <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 p-[12px] sm:p-5">
          <Tabs
            dir={locale === "ar" ? "rtl" : "ltr"}
            value={selected}
            onValueChange={(value) => {
              select(value as Surface);
              setFollow(false);
            }}
            activationMode="manual"
          >
            <div ref={tabStrip} className="overflow-x-auto pb-2">
              <TabsList
                aria-label={c.surfaces}
                className="flex h-auto w-full justify-start"
              >
                {surfaces.map((item) => (
                  <TabsTrigger
                    key={item}
                    value={item}
                    disabled={item === "browser" && !browserAllowed}
                    title={
                      item === "browser" && !browserAllowed
                        ? c.permissionOff
                        : c[item]
                    }
                    className="min-h-11 max-w-full shrink-0 whitespace-normal"
                  >
                    {c[item]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <label className="my-2 flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0"
                checked={follow}
                onChange={(event) => {
                  lastFollowed.current = newestAgentEvent?.id ?? null;
                  setFollow(event.target.checked);
                }}
              />
              {c.follow}
            </label>
            <p className="mb-4 text-sm text-muted-foreground">{c.followHelp}</p>
            {visited.has("browser") && browserAllowed && (
              <TabsContent
                value="browser"
                forceMount
                hidden={selected !== "browser"}
              >
                <BrowserWorkbench
                  agentId={agent.id}
                  agentName={agent.name}
                  active={active && selected === "browser"}
                  agentWorking={agent.status === "working"}
                />
              </TabsContent>
            )}
            {visited.has("terminal") && (
              <TabsContent
                value="terminal"
                forceMount
                hidden={selected !== "terminal"}
              >
                <TerminalPanel
                  agentId={agent.id}
                  active={active && selected === "terminal"}
                  disabled={!terminalAllowed}
                />
              </TabsContent>
            )}
            {visited.has("files") && (
              <TabsContent
                value="files"
                forceMount
                hidden={selected !== "files"}
              >
                <FileExplorer
                  agentId={agent.id}
                  active={active && selected === "files"}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>
        <aside
          aria-label={c.activity}
          className="min-w-0 space-y-4 border-t p-4 sm:p-5 xl:border-s xl:border-t-0"
        >
          <div className="space-y-2">
            <h3 className="text-base font-semibold">{c.activity}</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {taskId ? c.projectActivityHelp : c.activityHelp}
            </p>
            <p className="text-sm text-muted-foreground">{c.source}</p>
          </div>
          {!activity.isError && !activity.isLoading && !events.length && (
            <p className="text-sm text-muted-foreground">{c.activityEmpty}</p>
          )}
          <ol className="max-h-[48rem] space-y-4 overflow-y-auto">
            {events.map((event) => (
              <RecordedEvent key={event.id} event={event} locale={locale} />
            ))}
          </ol>
          <HistoryControls
            history={activity}
            copy={{
              error: c.activityError,
              stale: c.activityStale,
              retry: c.refresh,
              loading: c.loading,
            }}
          />
        </aside>
      </div>
    </section>
  );
}
function RecordedEvent({
  event,
  locale,
}: {
  event: ActivityEvent;
  locale: Locale;
}) {
  const createdAt = new Date(event.createdAt);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  });
  const metadata = [
    event.type,
    event.detail?.actor,
    event.detail?.surface,
    event.detail?.tool,
    event.detail?.status,
  ].filter((value): value is string => typeof value === "string");
  return (
    <li className="min-w-0 space-y-2 border-b pb-4 last:border-0">
      {Number.isFinite(createdAt.getTime()) && (
        <time
          dateTime={createdAt.toISOString()}
          className="block text-xs text-muted-foreground"
        >
          {date.format(createdAt)} · {date.resolvedOptions().timeZone}
        </time>
      )}
      <p dir="auto" className="break-words text-sm leading-6">
        <ActivitySummary event={event} />
      </p>
      <p
        dir="ltr"
        className="break-all font-mono text-xs text-muted-foreground"
      >
        {metadata.join(" · ")}
      </p>
    </li>
  );
}
