import { LanguagePackStatus } from "../../components/i18n/language-pack-status";
import { useEffect, useRef, useState } from "react";
import { useVisibleTab } from "@/components/ui/tabs";
import { Link, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetAgentQueryKey,
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
  getListTasksQueryKey,
  useGetAgent,
  useListTasks,
  useListAgentTemplates,
  getListAgentTemplatesQueryKey,
  updateAgent,
  updateAgentAvatar,
  resetAgentAvatar,
  type Agent,
  type AgentUpdate,
  type AgentPermissions,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguageSelect } from "@/components/i18n/language-select";
import { AgentModelPicker } from "@/components/agent/agent-model-picker";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { AgentAvatarEditor } from "@/components/agent/agent-avatar-editor";
import { AgentStats } from "@/components/agent/agent-stats";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ComputerWorkspace } from "@/components/computer/computer-workspace";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { adaptivePollingInterval } from "@/lib/adaptive-polling";
import {
  loadExpertDetailCopy,
  type ExpertDetailCopy,
} from "@/lib/expert-detail-copy";
import { loadNewAgentCopy, type NewAgentCopy } from "@/lib/new-agent-copy";
import {
  loadAgentDirectoryCopy,
  directoryDepartment,
  type AgentDirectoryCopy,
} from "@/lib/agent-directory-copy";
import type { Locale } from "@/lib/i18n";
import { TASK_STATUS_META, PRIORITY_META, taskStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const panel = "min-w-0 space-y-4 rounded-panel border bg-card p-[16px] sm:p-5";
const tabs = ["chat", "computer", "tasks", "stats", "settings"] as const;
type Tab = (typeof tabs)[number];
type Notice =
  | "saved"
  | "unknown"
  | "changed"
  | "busyError"
  | "busyArchive"
  | "capacity"
  | "denied";
type Copies = {
  c: ExpertDetailCopy;
  form: NewAgentCopy;
  directory: AgentDirectoryCopy;
};
type Confirmation =
  | { kind: "archive" | "host"; version: string }
  | {
      kind: "model";
      version: string;
      modelMode: "auto" | "manual";
      modelId: string | null;
    };
const validVersion = (value: string | undefined): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function mutationNotice(error: unknown): Notice {
  const failure = error as { status?: number; data?: { code?: string } } | null;
  if (failure?.data?.code === "AGENT_CONFIG_CHANGED") return "changed";
  if (failure?.data?.code === "AGENT_PERMISSION_IN_FLIGHT") return "busyError";
  if (failure?.data?.code === "AGENT_ACTION_IN_FLIGHT") return "busyArchive";
  if (failure?.data?.code === "RUNTIME_CAPACITY_EXCEEDED") return "capacity";
  if (
    failure?.status === 400 ||
    failure?.status === 403 ||
    failure?.status === 404
  )
    return "denied";
  return "unknown";
}
function initialTab(): Tab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return tabs.includes(requested as Tab) ? (requested as Tab) : "chat";
}
function safeDate(value: string | null, locale: Locale) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(locale)
    : "—";
}

export default function AgentDetail() {
  const { locale, setLocale, t } = useLocale();
  const [match, params] = useRoute("/agents/:agentId");
  const rawId = match ? params.agentId : "";
  const agentId = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const copy = useQuery({
    queryKey: ["expert-detail-copy", locale],
    queryFn: async (): Promise<Copies> => {
      const [c, form, directory] = await Promise.all([
        loadExpertDetailCopy(locale),
        loadNewAgentCopy(locale),
        loadAgentDirectoryCopy(locale),
      ]);
      return { c, form, directory };
    },
    staleTime: Infinity,
    retry: false,
  });
  const retainedCopy = useRef<Copies | undefined>(undefined);
  const retainedLocale = useRef(locale);
  if (copy.data) {
    retainedCopy.current = copy.data;
    retainedLocale.current = locale;
  }
  const content = copy.data ?? retainedCopy.current;
  if (!content)
    return <LanguagePackStatus error={copy.isError} className={panel} />;
  if (!Number.isSafeInteger(agentId) || agentId <= 0)
    return <Unavailable c={content.c} title={content.c.invalid} />;
  return (
    <>
      {!copy.data && (
        <LanguagePackStatus
          error={copy.isError}
          className={panel}
          onRetry={() => setLocale(retainedLocale.current)}
          retryLabel={t("close")}
        />
      )}
      <Detail
        key={agentId}
        agentId={agentId}
        {...content}
        locale={locale}
        languageReady={!!copy.data}
      />
    </>
  );
}

function Detail({
  agentId,
  c,
  form,
  directory,
  locale,
  languageReady,
}: Copies & { agentId: number; locale: Locale; languageReady: boolean }) {
  const client = useQueryClient();
  const visible = useDocumentVisible();
  const [active, setActive] = useState<Tab>(initialTab);
  const [visited, setVisited] = useState(() => new Set<Tab>([initialTab()]));
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewEpoch, setReviewEpoch] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const query = useGetAgent(agentId, {
    query: {
      queryKey: getGetAgentQueryKey(agentId),
      retry: false,
      refetchOnWindowFocus: "always",
      refetchInterval: busy
        ? false
        : (state) =>
            adaptivePollingInterval({
              documentVisible: visible,
              live:
                (state.state.data as Agent | undefined)?.status === "working" ||
                active === "chat" ||
                active === "computer",
              liveMs: 5_000,
            }),
    },
  });
  const agent = query.data;
  const tabStrip = useVisibleTab(active, Boolean(agent) && languageReady);
  const blocked =
    !languageReady ||
    busy ||
    needsReview ||
    query.isError ||
    query.isFetching ||
    !validVersion(agent?.configVersion);
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false;
      if (opener.current?.isConnected && !opener.current.matches(":disabled"))
        opener.current.focus();
      else refreshButton.current?.focus();
    }
  }, [busy]);
  function changeTab(value: string) {
    if (!tabs.includes(value as Tab)) return;
    const tab = value as Tab;
    setActive(tab);
    setVisited((previous) => new Set([...previous, tab]));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }
  async function refresh() {
    if (busyRef.current) return;
    const result = await query.refetch();
    if (result.isSuccess && validVersion(result.data.configVersion)) {
      setNeedsReview(false);
      setNotice(null);
      setReviewEpoch((value) => value + 1);
    }
  }
  async function commit(
    expected: string,
    request: () => Promise<Agent>,
    verify: (saved: Agent) => boolean,
  ): Promise<Agent | null> {
    if (busyRef.current || blocked) return null;
    if (expected !== agent?.configVersion) {
      setNotice("changed");
      setNeedsReview(true);
      return null;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await client.cancelQueries({ queryKey: getGetAgentQueryKey(agentId) });
      const saved = await request();
      if (
        saved.id !== agentId ||
        !validVersion(saved.configVersion) ||
        !verify(saved)
      )
        throw new Error("Unconfirmed expert update");
      client.setQueryData(getGetAgentQueryKey(agentId), saved);
      setNotice("saved");
      await Promise.all([
        client.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
        client.invalidateQueries({ queryKey: getGetOrgSummaryQueryKey() }),
        client.invalidateQueries({ queryKey: getListTasksQueryKey() }),
      ]);
      const fresh = await query.refetch();
      if (!fresh.isSuccess) setNeedsReview(true);
      return saved;
    } catch (error) {
      setNotice(mutationNotice(error));
      setNeedsReview(true);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function patch(data: AgentUpdate, expected = agent?.configVersion) {
    if (!validVersion(expected)) return Promise.resolve(null);
    return commit(
      expected,
      () =>
        updateAgent(
          agentId,
          { ...data, expectedConfig: expected },
          { signal: AbortSignal.timeout(30_000) },
        ),
      (saved) =>
        Object.entries(data).every(([key, value]) =>
          key === "permissions"
            ? Object.entries(value as AgentPermissions).every(
                ([permission, enabled]) =>
                  saved.permissions[permission as keyof AgentPermissions] ===
                  enabled,
              )
            : saved[key as keyof Agent] === value,
        ),
    );
  }
  async function portrait(value: string | null, expected: string) {
    const saved = await commit(
      expected,
      () =>
        value === null
          ? resetAgentAvatar(
              agentId,
              { expectedConfig: expected },
              { signal: AbortSignal.timeout(30_000) },
            )
          : updateAgentAvatar(
              agentId,
              { dataUrl: value, expectedConfig: expected },
              { signal: AbortSignal.timeout(30_000) },
            ),
      (saved) =>
        value === null
          ? saved.avatarVersion === null
          : Boolean(
              saved.avatarVersion &&
              saved.avatarVersion !== agent?.avatarVersion,
            ),
    );
    return saved;
  }
  function ask(value: Confirmation, button: HTMLButtonElement) {
    opener.current = button;
    setConfirmation(value);
  }
  async function confirm() {
    if (
      !confirmation ||
      confirmation.version !== agent?.configVersion ||
      blocked
    )
      return;
    const request = confirmation;
    restoreFocus.current = true;
    setConfirmation(null);
    if (request.kind === "archive")
      await patch({ isActive: false }, request.version);
    else if (request.kind === "host" && agent)
      await patch(
        { permissions: { ...agent.permissions, canUseSudo: true } },
        request.version,
      );
    else if (request.kind === "model")
      await patch(
        request.modelMode === "auto"
          ? { modelMode: "auto" }
          : { modelMode: "manual", modelId: request.modelId ?? undefined },
        request.version,
      );
  }
  if (!agent) {
    if (query.isPending)
      return (
        <section className={panel} role="status">
          {c.loading}
        </section>
      );
    return (
      <Unavailable
        c={c}
        title={query.error?.status === 404 ? c.missing : c.loadError}
        retry={() => void query.refetch()}
      />
    );
  }
  const canonicalRoot =
    agent.isRootCeo === true &&
    agent.depth === 0 &&
    agent.parentAgentId === null &&
    agent.templateKey === "ceo";
  const permissionLabels = { ...form.permissions, canUseSudo: c.hostShell };
  const confirmationChanged =
    confirmation && confirmation.version !== agent.configVersion;
  return (
    <div className="space-y-5 [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:whitespace-normal">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/agents"
          className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden className="rtl:rotate-180" />
          {directory.directory}
        </Link>
        <LanguageSelect disabled={busy} />
        <Button
          variant="outline"
          disabled={busy || query.isFetching}
          ref={refreshButton}
          onClick={() => void refresh()}
        >
          {c.refresh}
        </Button>
      </div>
      <header className={panel}>
        <div className="flex flex-wrap items-start gap-4">
          <AgentAvatar agent={agent} size="lg" />
          <div className="min-w-0 flex-1 basis-[160px] space-y-2">
            <h1 className="break-words text-2xl font-semibold tracking-tight">
              <bdi>{agent.name}</bdi>
            </h1>
            <p className="break-words text-sm">
              <bdi>{agent.role}</bdi> ·{" "}
              <bdi>{directoryDepartment(agent.department, directory)}</bdi>
            </p>
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>{directory.statuses[agent.status]}</span>
              <span>· {agent.isActive ? c.active : c.archived}</span>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{c.created}</dt>
            <dd>
              <time dateTime={agent.createdAt}>
                {safeDate(agent.createdAt, locale)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{c.lastSeen}</dt>
            <dd>
              {agent.lastActiveAt ? (
                <time dateTime={agent.lastActiveAt}>
                  {safeDate(agent.lastActiveAt, locale)}
                </time>
              ) : (
                c.noSignal
              )}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{c.nextModel}</p>
            <p dir="auto" className="break-all text-sm text-muted-foreground">
              {agent.modelMode === "auto"
                ? form.modelAuto
                : agent.modelId || "—"}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={blocked}
            onClick={(event) =>
              ask(
                {
                  kind: "model",
                  version: agent.configVersion!,
                  modelMode: agent.modelMode,
                  modelId: agent.modelId,
                },
                event.currentTarget,
              )
            }
          >
            {c.changeModel}
          </Button>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{c.modelHelp}</p>
        <div className="space-y-2 border-t pt-4 text-sm">
          <p dir="auto" className="break-words">
            {agent.currentAction?.trim() || c.noStep}
          </p>
          {agent.currentTaskId && (
            <Link
              href={`/projects/${agent.currentTaskId}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-primary"
            >
              {c.tasks} <bdi>#{agent.currentTaskId}</bdi>
              <ArrowUpRight size={14} aria-hidden className="rtl:-rotate-90" />
            </Link>
          )}
        </div>
      </header>
      {(query.isError || needsReview) && (
        <div role="alert" className={panel}>
          <p>{c.stale}</p>
          <Button
            variant="outline"
            disabled={busy || query.isFetching}
            onClick={() => void refresh()}
          >
            {c.review}
          </Button>
        </div>
      )}
      {!validVersion(agent.configVersion) && <p role="alert">{c.readonly}</p>}
      {(notice || busy) && (
        <p
          role={notice && notice !== "saved" ? "alert" : "status"}
          className="rounded-control border bg-card p-4 text-sm leading-6"
        >
          {busy ? c.saving : notice ? c[notice] : ""}
        </p>
      )}
      <Tabs
        value={active}
        onValueChange={changeTab}
        dir={locale === "ar" ? "rtl" : "ltr"}
        activationMode="manual"
      >
        <div ref={tabStrip} className="overflow-x-auto pb-2">
          <TabsList
            aria-label={agent.name}
            className="h-auto w-max min-w-full justify-start"
          >
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="min-h-11">
                {c[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {visited.has("chat") && (
          <TabsContent value="chat" forceMount hidden={active !== "chat"}>
            <ChatPanel
              agent={agent}
              canStart={!query.isError && !needsReview}
              modelSel={{
                modelMode: agent.modelMode,
                modelId: agent.modelId,
              }}
              active={active === "chat"}
            />
          </TabsContent>
        )}
        <TabsContent value="computer" forceMount hidden={active !== "computer"}>
          {visited.has("computer") && (
            <ComputerWorkspace
              agent={agent}
              terminalAllowed={agent.permissions.canUseTerminal}
              browserAllowed={agent.permissions.canBrowse}
              active={active === "computer"}
            />
          )}
        </TabsContent>
        <TabsContent value="tasks">
          {active === "tasks" && (
            <Tasks agentId={agentId} c={c} locale={locale} />
          )}
        </TabsContent>
        <TabsContent value="stats">
          {active === "stats" && (
            <AgentStats agent={agent} c={c} locale={locale} />
          )}
        </TabsContent>
        {visited.has("settings") && (
          <TabsContent
            value="settings"
            forceMount
            hidden={active !== "settings"}
            className="space-y-4"
          >
            <section className={panel}>
              <h2 className="text-lg font-semibold">{c.configuration}</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {c.configHelp}
              </p>
            </section>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <div className="min-w-0 space-y-4">
                <Prompt
                  agent={agent}
                  locale={locale}
                  c={c}
                  form={form}
                  blocked={blocked}
                  busy={busy}
                  reviewEpoch={reviewEpoch}
                  save={patch}
                />
                <AgentAvatarEditor
                  agent={agent}
                  c={c}
                  blocked={blocked}
                  busy={busy}
                  reviewEpoch={reviewEpoch}
                  save={portrait}
                />
              </div>
              <div className="min-w-0 space-y-4">
                <section className={panel} aria-labelledby="expert-permissions">
                  <h2 id="expert-permissions" className="text-lg font-semibold">
                    {form.permissionsHeading}
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {c.permissionsHelp}
                  </p>
                  <div className="divide-y">
                    {(
                      Object.keys(
                        permissionLabels,
                      ) as (keyof AgentPermissions)[]
                    )
                      .filter((key) => key !== "canUseSudo" || canonicalRoot)
                      .map((key) => (
                        <label
                          key={key}
                          className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-3 text-sm"
                        >
                          <span>{permissionLabels[key]}</span>
                          <input
                            type="checkbox"
                            className="size-5 shrink-0 accent-primary"
                            aria-label={permissionLabels[key]}
                            checked={Boolean(agent.permissions[key])}
                            disabled={blocked}
                            onChange={(event) => {
                              if (
                                key === "canUseSudo" &&
                                event.target.checked
                              ) {
                                opener.current = event.currentTarget;
                                setConfirmation({
                                  kind: "host",
                                  version: agent.configVersion!,
                                });
                              } else
                                void patch({
                                  permissions: {
                                    ...agent.permissions,
                                    [key]: event.target.checked,
                                  },
                                });
                            }}
                          />
                        </label>
                      ))}
                  </div>
                  {canonicalRoot && (
                    <p className="text-sm leading-6 text-muted-foreground">
                      {c.hostHelp}
                    </p>
                  )}
                </section>
                <section className={panel}>
                  <h2 className="text-lg font-semibold">
                    {agent.isActive ? c.archive : c.restore}
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {agent.isActive ? c.archiveHelp : c.restoreHelp}
                  </p>
                  {agent.isActive ? (
                    <Button
                      variant="outline"
                      disabled={blocked}
                      onClick={(event) =>
                        ask(
                          { kind: "archive", version: agent.configVersion! },
                          event.currentTarget,
                        )
                      }
                    >
                      {c.archive}
                    </Button>
                  ) : (
                    <Button
                      disabled={blocked}
                      onClick={() => void patch({ isActive: true })}
                    >
                      {c.restore}
                    </Button>
                  )}
                </section>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent
          dir={locale === "ar" ? "rtl" : "ltr"}
          className="max-w-3xl [&_button]:min-h-11 [&_button]:whitespace-normal"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {confirmation?.kind === "model"
                ? c.changeModel
                : confirmation?.kind === "host"
                  ? c.hostShell
                  : c.archiveTitle}
            </DialogTitle>
            <DialogDescription>
              {confirmation?.kind === "model"
                ? c.modelHelp
                : confirmation?.kind === "host"
                  ? c.hostHelp
                  : c.archiveHelp}
            </DialogDescription>
          </DialogHeader>
          {confirmation?.kind === "model" && (
            <div className="min-w-0 space-y-3">
              <label
                htmlFor="expert-model-mode"
                className="block text-sm font-medium"
              >
                {form.modelMode}
              </label>
              <select
                id="expert-model-mode"
                className="min-h-11 w-full rounded-control border bg-card px-3 text-sm"
                value={confirmation.modelMode}
                onChange={(event) =>
                  setConfirmation({
                    ...confirmation,
                    modelMode: event.target.value as "auto" | "manual",
                  })
                }
              >
                <option value="auto">{form.modelAuto}</option>
                <option value="manual">{form.modelManual}</option>
              </select>
              {confirmation.modelMode === "manual" && (
                <AgentModelPicker
                  value={confirmation.modelId ?? ""}
                  onChange={(id) =>
                    setConfirmation({ ...confirmation, modelId: id })
                  }
                  onAvailabilityChange={setModelAvailable}
                  copy={form.model}
                  retryLabel={form.retry}
                  locale={locale}
                />
              )}
            </div>
          )}
          {confirmationChanged && <p role="alert">{c.changed}</p>}
          <DialogFooter>
            <Button
              ref={cancel}
              variant="outline"
              onClick={() => setConfirmation(null)}
            >
              {c.cancel}
            </Button>
            <Button
              disabled={
                blocked ||
                !!confirmationChanged ||
                (confirmation?.kind === "model" &&
                  confirmation.modelMode === "manual" &&
                  !modelAvailable)
              }
              onClick={() => void confirm()}
            >
              {confirmation?.kind === "archive" ? c.archive : c.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Prompt({
  agent,
  locale,
  c,
  form,
  blocked,
  busy,
  reviewEpoch,
  save,
}: {
  agent: Agent;
  locale: Locale;
  c: ExpertDetailCopy;
  form: NewAgentCopy;
  blocked: boolean;
  busy: boolean;
  reviewEpoch: number;
  save: (data: AgentUpdate, expected?: string) => Promise<Agent | null>;
}) {
  const managed = !agent.isCustomPrompt && !!agent.templateKey;
  const templates = useListAgentTemplates(
    { locale },
    {
      query: {
        queryKey: getListAgentTemplatesQueryKey({ locale }),
        enabled: managed,
        retry: false,
      },
    },
  );
  const template = templates.data?.find(
    (item) => item.key === agent.templateKey,
  );
  const catalogReady =
    !managed || (templates.isSuccess && !templates.isFetching && !!template);
  const currentPrompt = managed
    ? template?.defaultSystemPrompt
    : agent.systemPrompt;
  const [draft, setDraft] = useState(managed ? "" : agent.systemPrompt);
  const [baseline, setBaseline] = useState(managed ? "" : agent.systemPrompt);
  const [sourceBaseline, setSourceBaseline] = useState(agent.systemPrompt);
  const [version, setVersion] = useState(agent.configVersion);
  const dirty = draft !== baseline;
  useEffect(() => {
    if (!dirty && catalogReady && currentPrompt !== undefined) {
      setDraft(currentPrompt);
      setBaseline(currentPrompt);
      setSourceBaseline(agent.systemPrompt);
      setVersion(agent.configVersion);
    }
  }, [
    agent.systemPrompt,
    agent.configVersion,
    dirty,
    currentPrompt,
    catalogReady,
  ]);
  useEffect(() => {
    setVersion(agent.configVersion);
  }, [reviewEpoch]);
  const changed = dirty && sourceBaseline !== agent.systemPrompt;
  const invalid = draft.trim().length === 0 || draft.length > 65536;
  return (
    <section className={panel}>
      <h2 className="text-lg font-semibold">{form.prompt}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{c.promptHelp}</p>
      {managed && (
        <p className="text-sm leading-6 text-muted-foreground">
          {c.managedPrompt}
        </p>
      )}
      {managed && !catalogReady && (
        <div
          role={
            templates.isError || (templates.isSuccess && !template)
              ? "alert"
              : "status"
          }
          className="text-sm"
        >
          {templates.isError
            ? form.templatesError
            : templates.isSuccess && !template
              ? form.templatesEmpty
              : form.templatesLoading}
          {templates.isError && (
            <Button variant="outline" onClick={() => void templates.refetch()}>
              {form.retry}
            </Button>
          )}
        </div>
      )}
      <label htmlFor="expert-prompt" className="block text-sm font-medium">
        {form.prompt}
      </label>
      <Textarea
        id="expert-prompt"
        dir="auto"
        rows={10}
        value={draft}
        disabled={busy || !catalogReady}
        aria-invalid={invalid}
        aria-describedby={invalid ? "expert-prompt-validation" : undefined}
        maxLength={65536}
        onChange={(event) => setDraft(event.target.value)}
        className="text-sm"
      />
      {!managed && <p className="text-xs text-muted-foreground">{c.source}</p>}
      {invalid && (
        <p
          id="expert-prompt-validation"
          role="alert"
          className="text-sm text-destructive"
        >
          {c.promptRequired}
        </p>
      )}
      {changed && (
        <p role="alert" className="text-sm">
          {c.promptChanged}
        </p>
      )}
      {dirty && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer content-center">
            {c.serverPrompt}
          </summary>
          <p
            dir="auto"
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control border p-3"
          >
            {agent.systemPrompt}
          </p>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={blocked || !catalogReady || !dirty || invalid}
          onClick={async () => {
            const saved = await save({ systemPrompt: draft }, version);
            if (saved) {
              setDraft(saved.systemPrompt);
              setBaseline(saved.systemPrompt);
              setSourceBaseline(saved.systemPrompt);
              setVersion(saved.configVersion);
            }
          }}
        >
          {c.save}
        </Button>
        {dirty && (
          <Button
            variant="outline"
            disabled={busy || !catalogReady}
            onClick={() => {
              setDraft(currentPrompt ?? agent.systemPrompt);
              setBaseline(currentPrompt ?? agent.systemPrompt);
              setSourceBaseline(agent.systemPrompt);
              setVersion(agent.configVersion);
            }}
          >
            {c.discard}
          </Button>
        )}
      </div>
    </section>
  );
}

function Tasks({
  agentId,
  c,
  locale,
}: {
  agentId: number;
  c: ExpertDetailCopy;
  locale: Locale;
}) {
  const params = { ownerAgentId: agentId, limit: 200 };
  const query = useListTasks(params, {
    query: {
      queryKey: getListTasksQueryKey(params),
      retry: false,
      refetchOnWindowFocus: "always",
    },
  });
  const rows = [...(query.data ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{c.tasks}</h2>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {c.refresh}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{c.taskWindow}</p>
      {query.isPending && <p role="status">{c.taskLoading}</p>}
      {query.isError && (
        <p role="alert">{query.data ? c.stale : c.taskError}</p>
      )}
      {query.isSuccess && rows.length === 0 && <p>{c.taskEmpty}</p>}
      <ul className="space-y-3">
        {rows.map((task) => (
          <li key={task.id}>
            <Link
              href={`/projects/${task.id}`}
              className="block rounded-panel border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="min-w-0 break-words font-medium">
                  <bdi>{task.title}</bdi>
                </h3>
                <span
                  className={cn(
                    "rounded-control border px-2 py-1 text-xs",
                    PRIORITY_META[task.priority].className,
                  )}
                >
                  {c[task.priority]}
                </span>
              </div>
              <p
                dir="auto"
                className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground"
              >
                {task.brief}
              </p>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
                <span className={TASK_STATUS_META[task.status].className}>
                  {taskStatusLabel(task.status, locale)}
                </span>
                <span>
                  {c.progress}:{" "}
                  {new Intl.NumberFormat(locale, { style: "percent" }).format(
                    Math.max(0, Math.min(100, task.progressPercent)) / 100,
                  )}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/projects"
        className="inline-flex min-h-11 items-center rounded-control px-2 text-sm text-primary"
      >
        {c.taskMore}
      </Link>
    </section>
  );
}
function Unavailable({
  c,
  title,
  retry,
}: {
  c: ExpertDetailCopy;
  title: string;
  retry?: () => void;
}) {
  const { t } = useLocale();
  return (
    <section className={panel} role="alert">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{c.loadHelp}</p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/agents"
          className="inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm"
        >
          <ArrowLeft size={16} aria-hidden className="rtl:rotate-180" />
          {t("experts")}
        </Link>
        {retry && <Button onClick={retry}>{c.refresh}</Button>}
      </div>
    </section>
  );
}
