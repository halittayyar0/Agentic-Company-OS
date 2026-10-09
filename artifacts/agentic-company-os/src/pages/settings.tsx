import { LanguagePackStatus } from "../components/i18n/language-pack-status";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getLlmSettings,
  updateLlmSettings,
  testLlmConnection,
  type LlmTestSuccess,
  type ModelProviderId,
} from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LANGUAGE_OPTIONS, isLocale } from "@/lib/i18n";
import { loadSettingsCopy, type SettingsCopy } from "@/lib/settings-copy";
import { applyColorMode, getSavedColorMode, type ColorMode } from "@/lib/theme";
import { matchesModelSearch } from "@/lib/model-search";
import { ModelConnectionLauncher } from "@/components/studio/model-connection-launcher";

const SourceWorkspaceSettings = lazy(() =>
  import("../components/settings/source-workspaces").then((module) => ({
    default: module.SourceWorkspaceSettings,
  })),
);
const ExecutionPolicySettings = lazy(() =>
  import("../components/settings/execution-policy").then((module) => ({
    default: module.ExecutionPolicySettings,
  })),
);
const settingsKey = ["settings", "llm"] as const;
const providers = ["openrouter", "openai", "ollama", "replit"] as const;
const names: Record<ModelProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  ollama: "Ollama",
  replit: "Replit",
  chatgpt: "ChatGPT",
};
type KeyProvider = "openrouter" | "openai";
type Notice =
  "saved" | "changed" | "unconfirmed" | "rateLimited" | "testFailed";
type Confirmation =
  | { kind: "remove"; provider: KeyProvider; revision: number }
  | {
      kind: "test";
      provider: ModelProviderId;
      model: string;
      revision: number;
    };
const selectClass =
  "min-h-11 w-full min-w-0 rounded-control border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const panelClass = "space-y-4 rounded-panel border bg-card p-[16px] sm:p-6";
function errorCode(error: unknown): { code?: string; status?: number } {
  if (!error || typeof error !== "object") return {};
  const value = error as { status?: number; data?: { code?: string } };
  return { code: value.data?.code, status: value.status };
}

export default function SettingsPage() {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["settings-copy", locale],
    queryFn: () => loadSettingsCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return <LanguagePackStatus error={copy.isError} className={panelClass} />;
  return <SettingsContent key={locale} c={copy.data} />;
}

function SettingsContent({ c }: { c: SettingsCopy }) {
  const { locale, setLocale, syncStatus, retrySync, t } = useLocale();
  const ops = useOpsControl();
  const client = useQueryClient();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [drafts, setDrafts] = useState({ openrouter: "", openai: "" });
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [selection, setSelection] = useState<
    Partial<Record<ModelProviderId, string>>
  >({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [result, setResult] = useState<LlmTestSuccess | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const [search, setSearch] = useState("");
  const [count, setCount] = useState(9);
  const [mode, setMode] = useState<ColorMode>(getSavedColorMode);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = document.documentElement.dataset.colorMode;
      if (next === "light" || next === "dark" || next === "system")
        setMode(next);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-mode"],
    });
    return () => observer.disconnect();
  }, []);
  const query = useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => getLlmSettings({ signal }),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: busy ? false : 30_000,
  });
  const data = query.data;
  const validRevision =
    !!data && Number.isSafeInteger(data.revision) && data.revision >= 0;
  const blocked =
    busy || needsReview || query.isError || query.isFetching || !validRevision;
  const matching = (data?.catalog.models ?? []).filter((model) =>
    matchesModelSearch(
      {
        ...model,
        description: [
          model.description,
          c[model.tier],
          model.supportsTools ? c.tools : c.chatOnly,
          model.id.endsWith(":free") ? c.freeIdentifier : "",
        ].join(" "),
      },
      search,
      locale,
    ),
  );
  const testedModel = result
    ? data?.catalog.models.find(
        (model) =>
          model.id === result.model && model.provider === result.provider,
      )
    : undefined;
  const confirmationChanged =
    !!confirmation &&
    (!data ||
      data.revision !== confirmation.revision ||
      (confirmation.kind === "test" &&
        !data.catalog.models.some(
          (model) =>
            model.id === confirmation.model &&
            model.provider === confirmation.provider,
        )));
  function ask(value: Confirmation, button: HTMLButtonElement) {
    opener.current = button;
    setConfirmation(value);
  }
  async function refresh() {
    if (busyRef.current) return;
    const fresh = await query.refetch();
    if (fresh.isSuccess) {
      setNeedsReview(false);
      setDraftRevision(fresh.data.revision);
      setNotice(null);
    }
    ops.refetch();
  }
  async function save(
    provider: KeyProvider,
    value: string | null,
    revision: number,
  ) {
    if (busyRef.current || blocked) return;
    if (revision !== data?.revision) {
      setNotice("changed");
      setNeedsReview(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    setConfirmation(null);
    try {
      await client.cancelQueries({ queryKey: settingsKey });
      const receipt = await updateLlmSettings(
        {
          expectedRevision: revision,
          ...(provider === "openai"
            ? { openaiApiKey: value }
            : { openrouterApiKey: value }),
        },
        { signal: AbortSignal.timeout(30_000) },
      );
      if (receipt.ok !== true || receipt.revision !== revision + 1)
        throw new Error("Unconfirmed receipt");
      setDrafts((old) => ({ ...old, [provider]: "" }));
      setDraftRevision(receipt.revision);
      setNotice("saved");
      setNeedsReview(true);
      const fresh = await query.refetch();
      if (fresh.isSuccess && fresh.data.revision >= receipt.revision)
        setNeedsReview(false);
      void client.invalidateQueries({ queryKey: ["model-catalog"] });
    } catch (error) {
      const failure = errorCode(error);
      setNotice(
        failure.code === "LLM_CONFIG_CHANGED"
          ? "changed"
          : failure.status === 429
            ? "rateLimited"
            : "unconfirmed",
      );
      setNeedsReview(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function test() {
    if (
      busyRef.current ||
      blocked ||
      ops.controlsBlocked ||
      confirmationChanged ||
      confirmation?.kind !== "test"
    )
      return;
    const request = confirmation;
    busyRef.current = true;
    setBusy(true);
    setConfirmation(null);
    setNotice(null);
    setResult(null);
    try {
      const receipt = await testLlmConnection(
        { model: request.model, expectedRevision: request.revision },
        { signal: AbortSignal.timeout(25_000) },
      );
      if (
        receipt.ok !== true ||
        receipt.revision !== request.revision ||
        receipt.model !== request.model ||
        receipt.provider !== request.provider ||
        !Number.isFinite(receipt.latencyMs) ||
        receipt.latencyMs < 0
      )
        throw new Error("Unconfirmed test receipt");
      setResult(receipt);
    } catch (error) {
      const failure = errorCode(error);
      const changed =
        failure.code === "LLM_CONFIG_CHANGED" ||
        failure.code === "LLM_TEST_STALE";
      setNotice(
        changed
          ? "changed"
          : failure.status === 429
            ? "rateLimited"
            : "testFailed",
      );
      if (changed) setNeedsReview(true);
      ops.refetch();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6 [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:whitespace-normal">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {c.title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {c.description}
        </p>
      </header>
      <Suspense fallback={<LanguagePackStatus error={false} />}>
        <ExecutionPolicySettings />
        <SourceWorkspaceSettings />
      </Suspense>
      <section className={panelClass} aria-labelledby="preferences-title">
        <h2 id="preferences-title" className="text-lg font-semibold">
          {c.preferences}
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              className="block text-sm font-medium"
              htmlFor="settings-language"
            >
              {t("language")}
            </label>
            <select
              id="settings-language"
              className={selectClass}
              value={locale}
              disabled={busy}
              onChange={(e) => {
                if (isLocale(e.target.value)) setLocale(e.target.value);
              }}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option
                  key={option.code}
                  value={option.code}
                  lang={option.code}
                >
                  {option.nativeName}
                </option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">
              {t("translationPreview")}
            </p>
            {syncStatus !== "pending" && (
              <p
                role={syncStatus === "error" ? "alert" : "status"}
                className="text-sm text-muted-foreground"
              >
                {t(
                  syncStatus === "error"
                    ? "localeError"
                    : syncStatus === "saved"
                      ? "localeSaved"
                      : "localeSaving",
                )}
              </p>
            )}
            {syncStatus === "error" && (
              <Button variant="outline" onClick={retrySync}>
                {t("checkAgain")}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <label
              htmlFor="settings-appearance"
              className="block text-sm font-medium"
            >
              {c.appearance}
            </label>
            <select
              id="settings-appearance"
              className={selectClass}
              value={mode}
              onChange={(e) => {
                const next = e.target.value as ColorMode;
                applyColorMode(next);
                setMode(next);
              }}
            >
              {(["system", "light", "dark"] as const).map((value) => (
                <option key={value} value={value}>
                  {c[value]}
                </option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">{c.appearanceHelp}</p>
          </div>
        </div>
      </section>
      <section
        className={panelClass}
        aria-labelledby="providers-title"
        aria-busy={busy || query.isFetching}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="providers-title" className="text-lg font-semibold">
            {c.providers}
          </h2>
          <Button
            variant="outline"
            disabled={busy || query.isFetching}
            onClick={() => void refresh()}
          >
            {query.isFetching ? c.busy : c.refresh}
          </Button>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {c.credentialHelp}
        </p>
        <ModelConnectionLauncher>
          {t("providerSetupAction")}
        </ModelConnectionLauncher>
        {query.isPending && <p role="status">{c.loading}</p>}
        {!data && query.isError && <p role="alert">{c.loadError}</p>}
        {data && (query.isError || needsReview || !validRevision) && (
          <p
            role="alert"
            className="rounded-control border border-destructive/30 p-3 text-sm"
          >
            {c.stale}
          </p>
        )}
        {notice && (
          <p
            role={notice === "saved" ? "status" : "alert"}
            className="rounded-control border p-3 text-sm leading-6"
          >
            {c[notice]}
          </p>
        )}
        {data && (
          <>
            <p className="text-sm text-muted-foreground">
              {c.revision}: <bdi>{data.revision}</bdi>
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {data.storage === "database" ? c.storedDatabase : c.storedLocal}
            </p>
            <p className="text-sm text-muted-foreground">{c.draftHelp}</p>
            {ops.controlsBlocked && (
              <p role="status" className="text-sm">
                {c.testBlocked}
              </p>
            )}
            <div className="divide-y">
              {providers.map((provider) => {
                const editable =
                  provider === "openai" || provider === "openrouter";
                const key = editable ? data[provider] : null;
                const models = data.catalog.models.filter(
                  (model) => model.provider === provider,
                );
                const chosenModel =
                  models.find((model) => model.id === selection[provider]) ??
                  models.find(
                    (model) =>
                      model.supportsTools && model.id.endsWith(":free"),
                  ) ??
                  models.find(
                    (model) => model.supportsTools && model.tier === "economy",
                  ) ??
                  models.find((model) => model.supportsTools) ??
                  models[0];
                const chosen = chosenModel?.id ?? "";
                const available = data.catalog.providers.some(
                  (item) => item.id === provider && item.available,
                );
                return (
                  <section
                    key={provider}
                    className="min-w-0 space-y-4 py-5 first:pt-0 last:pb-0"
                    aria-labelledby={provider + "-heading"}
                    data-provider={provider}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id={provider + "-heading"} className="font-semibold">
                        <bdi>{names[provider]}</bdi>
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {key
                          ? c[
                              key.keySource === "runtime"
                                ? "sourceRuntime"
                                : key.keySource === "environment"
                                  ? "sourceEnvironment"
                                  : "sourceNone"
                            ]
                          : c.serverManaged}
                      </p>
                    </div>
                    {key?.keyPreview && (
                      <code dir="ltr" className="block break-all text-sm">
                        {key.keyPreview}
                      </code>
                    )}
                    {editable ? (
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (drafts[provider].trim())
                            void save(
                              provider,
                              drafts[provider].trim(),
                              draftRevision ?? data.revision,
                            );
                        }}
                      >
                        <label
                          htmlFor={provider + "-key"}
                          className="block text-sm font-medium"
                        >
                          {c.key} · <bdi>{names[provider]}</bdi>
                        </label>
                        <Input
                          id={provider + "-key"}
                          type="password"
                          autoComplete="new-password"
                          spellCheck={false}
                          autoCapitalize="none"
                          maxLength={512}
                          value={drafts[provider]}
                          disabled={busy}
                          dir="ltr"
                          className="h-11"
                          onChange={(e) => {
                            if (!drafts.openai && !drafts.openrouter)
                              setDraftRevision(data.revision);
                            setDrafts((old) => ({
                              ...old,
                              [provider]: e.target.value,
                            }));
                          }}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="submit"
                            disabled={blocked || !drafts[provider].trim()}
                          >
                            {busy ? c.busy : c.save}
                          </Button>
                          {key?.keySource === "runtime" && (
                            <Button
                              variant="outline"
                              disabled={blocked}
                              onClick={(e) =>
                                ask(
                                  {
                                    kind: "remove",
                                    provider,
                                    revision: data.revision,
                                  },
                                  e.currentTarget,
                                )
                              }
                            >
                              {c.remove}
                            </Button>
                          )}
                        </div>
                      </form>
                    ) : (
                      <p className="text-sm leading-6 text-muted-foreground">
                        {c.serverHelp}
                      </p>
                    )}
                    {available && models.length > 0 ? (
                      <div className="space-y-2">
                        <label
                          className="block text-sm font-medium"
                          htmlFor={provider + "-model"}
                        >
                          {c.selectedModel} · <bdi>{names[provider]}</bdi>
                        </label>
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                          <select
                            id={provider + "-model"}
                            dir="ltr"
                            className={selectClass}
                            disabled={busy}
                            value={chosen}
                            onChange={(e) =>
                              setSelection((old) => ({
                                ...old,
                                [provider]: e.target.value,
                              }))
                            }
                          >
                            {models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label} · {model.id}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="outline"
                            className="shrink-0"
                            disabled={blocked || ops.controlsBlocked}
                            onClick={(e) =>
                              ask(
                                {
                                  kind: "test",
                                  provider,
                                  model: chosen,
                                  revision: data.revision,
                                },
                                e.currentTarget,
                              )
                            }
                          >
                            {c.test}
                          </Button>
                        </div>
                        {!chosenModel?.supportsTools && (
                          <p
                            role="status"
                            className="text-sm text-attention-foreground"
                          >
                            {c.chatOnlyProjectWarning}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {c.unavailable}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
            {result ? (
              <div
                role="status"
                className="space-y-2 rounded-control border p-4 text-sm"
              >
                <p className="font-medium">{c.testPassed}</p>
                <p>
                  <bdi>
                    {names[result.provider]} · {result.model}
                  </bdi>
                </p>
                <p>
                  {c.revision}: <bdi>{result.revision}</bdi> · {c.elapsed}:{" "}
                  <bdi>
                    {Math.round(result.latencyMs).toLocaleString(locale)}
                  </bdi>
                </p>
                <p className="text-muted-foreground">{c.testHistorical}</p>
                {data.revision === result.revision &&
                  testedModel &&
                  (testedModel.supportsTools ? (
                    <div className="space-y-2">
                      <p>{c.toolTestNext}</p>
                      <Link
                        href="/projects"
                        className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {c.viewProjects}
                      </Link>
                    </div>
                  ) : (
                    <p>{c.chatTestOnly}</p>
                  ))}
                {data.revision !== result.revision && <p>{c.currentChanged}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{c.notTested}</p>
            )}
          </>
        )}
      </section>
      {data && (
        <section className={panelClass} aria-labelledby="catalog-title">
          <h2 id="catalog-title" className="text-lg font-semibold">
            {c.catalog}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {c.catalogHelp}
          </p>
          {query.isError && <p role="alert">{c.stale}</p>}
          <label htmlFor="model-search" className="block text-sm font-medium">
            {c.search}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="model-search"
              type="search"
              className="h-11"
              dir="auto"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCount(9);
              }}
            />
            <Button
              variant="outline"
              disabled={!search}
              onClick={() => {
                setSearch("");
                setCount(9);
              }}
            >
              {c.clear}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground" role="status">
            <bdi>
              {Math.min(count, matching.length).toLocaleString(locale)} /{" "}
              {matching.length.toLocaleString(locale)}
            </bdi>
          </p>
          {matching.length === 0 ? (
            <p>{c.empty}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {matching.slice(0, count).map((model) => (
                <li
                  key={model.id}
                  className="min-w-0 space-y-2 rounded-control border p-4"
                >
                  <h3 className="break-words font-medium" dir="auto">
                    {model.label}
                  </h3>
                  <code dir="ltr" className="block break-all text-xs">
                    {model.id}
                  </code>
                  <p className="text-sm">
                    <bdi>{names[model.provider]}</bdi> · {c[model.tier]} ·{" "}
                    {model.supportsTools ? c.tools : c.chatOnly}
                  </p>
                  {model.isDefault && (
                    <p className="text-sm">{c.defaultModel}</p>
                  )}
                  {model.id.endsWith(":free") && (
                    <p className="text-sm">{c.freeIdentifier}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{c.source}</p>
                  <p
                    dir="auto"
                    className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground"
                  >
                    {model.description || c.noDescription}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {count < matching.length && (
            <Button
              variant="outline"
              onClick={() => setCount((value) => value + 9)}
            >
              {c.more}
            </Button>
          )}
        </section>
      )}
      <details className={panelClass}>
        <summary className="min-h-11 cursor-pointer content-center font-semibold">
          {c.runtime}
        </summary>
        <p className="text-sm leading-6 text-muted-foreground">
          {c.browserHelp}
        </p>
        <code dir="ltr" className="block break-all text-sm">
          AGENT_BROWSER_HEADLESS=false
        </code>
        <p className="text-sm leading-6 text-muted-foreground">{c.hostHelp}</p>
        <p className="text-sm">{c.hostSettings}</p>
        <code dir="ltr" className="block break-all whitespace-pre-wrap text-sm">
          {"ALLOW_FOUNDER_SHELL=false\nALLOW_AGENT_PROCESS_EXEC=false"}
        </code>
      </details>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent
          className="[&_button]:min-h-11 [&_button]:whitespace-normal"
          dir={locale === "ar" ? "rtl" : "ltr"}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {confirmation?.kind === "remove" ? c.removeTitle : c.test}
            </DialogTitle>
            <DialogDescription>
              {confirmation?.kind === "remove" ? c.removeHelp : c.testHelp}
            </DialogDescription>
          </DialogHeader>
          {confirmation && (
            <div className="min-w-0 space-y-2 text-sm">
              <p>
                <bdi>{names[confirmation.provider]}</bdi>
              </p>
              {confirmation.kind === "test" && (
                <code dir="ltr" className="block break-all">
                  {confirmation.model}
                </code>
              )}
              <p>
                {c.revision}: {confirmation.revision}
              </p>
            </div>
          )}
          {confirmationChanged && <p role="alert">{c.changed}</p>}
          {confirmation?.kind === "test" && ops.controlsBlocked && (
            <p role="alert">{c.testBlocked}</p>
          )}
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
                confirmationChanged ||
                (confirmation?.kind === "test" && ops.controlsBlocked)
              }
              onClick={() => {
                if (confirmation?.kind === "remove")
                  void save(confirmation.provider, null, confirmation.revision);
                else void test();
              }}
            >
              {confirmation?.kind === "remove" ? c.remove : c.confirmTest}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
