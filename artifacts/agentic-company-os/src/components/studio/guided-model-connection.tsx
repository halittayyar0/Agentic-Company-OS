import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetModelCatalogQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectionModuleStatus } from "./model-connection-launcher";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { loadConnectionCopy, type ConnectionCopy } from "@/lib/connection-copy";
import {
  connectionSettingsKey,
  readConnectionSettings,
  saveConnection,
  connectionError,
} from "@/lib/connection-api";

type Choice = "ollama" | "chatgpt" | "api";
export default function GuidedModelConnection({
  onClose,
  restoreFocus,
}: {
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const { locale, t } = useLocale();
  const [choice, setChoice] = useState<Choice | null>(null);
  const copy = useQuery({
    queryKey: ["connection-copy", locale],
    queryFn: () => loadConnectionCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const c = copy.data;
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("providerSetupAction")}</DialogTitle>
          <DialogDescription>
            {c?.description ?? t("loadingScreen")}
          </DialogDescription>
        </DialogHeader>
        {!c ? (
          <LanguagePackStatus error={copy.isError} />
        ) : (
          <>
            {choice ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 justify-start"
                onClick={() => setChoice(null)}
              >
                {c.back}
              </Button>
            ) : null}
            {!choice ? (
              <div className="grid min-w-0 gap-3">
                {(
                  [
                    ["ollama", c.local, c.localHint],
                    ["chatgpt", "ChatGPT", c.chatgptHint],
                    ["api", c.api, c.apiHint],
                  ] as const
                ).map(([value, title, hint]) => (
                  <div
                    key={value}
                    className="rounded-control border bg-card p-4"
                  >
                    <Button
                      variant="outline"
                      className="min-h-11 w-full justify-start"
                      type="button"
                      onClick={() => setChoice(value)}
                    >
                      {title}
                    </Button>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {hint}
                    </p>
                  </div>
                ))}
              </div>
            ) : choice === "chatgpt" ? (
              <ChatGPTConnectionSlot c={c} />
            ) : (
              <ProviderForm key={choice} choice={choice} c={c} />
            )}
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {c.advanced}
            </Link>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={onClose}
            >
              {c.done}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChatGPTConnectionSlot({ c }: { c: ConnectionCopy }) {
  const module = useQuery({
    queryKey: ["guided-chatgpt-module"],
    queryFn: () => import("./guided-chatgpt-connection"),
    staleTime: Infinity,
    retry: false,
  });
  const Component = module.data?.default;
  return Component ? (
    <Component c={c} />
  ) : (
    <ConnectionModuleStatus error={module.isError} />
  );
}

function ProviderForm({
  choice,
  c,
}: {
  choice: "ollama" | "api";
  c: ConnectionCopy;
}) {
  const { t } = useLocale();
  const id = useId(),
    client = useQueryClient(),
    guard = useRef(false);
  const [provider, setProvider] = useState<"openai" | "openrouter">("openai");
  const [value, setValue] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [cloudDraft, setCloudDraft] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [needsReview, setNeedsReview] = useState(false);
  const [notice, setNotice] = useState<
    "saved" | "unconfirmed" | "invalid" | "changed" | null
  >(null);
  const state = useQuery({
    queryKey: connectionSettingsKey,
    queryFn: ({ signal }) => readConnectionSettings(signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (state.data && !state.isFetching && !state.isError && value === null) {
      setValue(
        choice === "ollama"
          ? (state.data.ollama.baseUrl ?? "http://127.0.0.1:11434")
          : "",
      );
      setBaseRevision(state.data.revision);
      setCloudDraft(
        typeof state.data.ollama.cloudEnabled === "boolean"
          ? state.data.ollama.cloudEnabled
          : null,
      );
    }
  }, [state.data, state.isFetching, state.isError, value, choice]);
  const blocked =
    busy ||
    needsReview ||
    state.isError ||
    state.isFetching ||
    baseRevision === null;
  const refresh = async () => {
    if (guard.current || state.isFetching) return;
    const current = await state.refetch();
    if (!current.isError && current.data) {
      setBaseRevision(current.data.revision);
      setCloudDraft(
        typeof current.data.ollama.cloudEnabled !== "boolean"
          ? null
          : value?.trim() === current.data.ollama.baseUrl
            ? current.data.ollama.cloudEnabled
            : false,
      );
      setNeedsReview(false);
      setNotice(null);
      await client.invalidateQueries({
        queryKey: getGetModelCatalogQueryKey(),
      });
    }
  };
  const save = async (restore = false) => {
    if (
      guard.current ||
      blocked ||
      baseRevision === null ||
      (!restore && !value?.trim())
    )
      return;
    guard.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const patch =
        choice === "ollama"
          ? {
              ollamaBaseUrl: restore ? null : value!.trim(),
              ...(cloudDraft === null
                ? {}
                : { ollamaCloudEnabled: restore ? false : cloudDraft }),
            }
          : provider === "openai"
            ? { openaiApiKey: value!.trim() }
            : { openrouterApiKey: value!.trim() };
      const receipt = await saveConnection({
        expectedRevision: baseRevision,
        ...patch,
      });
      if (
        !receipt ||
        receipt.ok !== true ||
        receipt.revision !== baseRevision + 1
      )
        throw new Error("Unconfirmed connection save");
      setNotice("saved");
      setNeedsReview(true);
      if (choice === "api") setValue("");
      const current = await state.refetch();
      if (!current.isError && current.data?.revision === receipt.revision) {
        if (
          choice === "ollama" &&
          cloudDraft !== null &&
          current.data.ollama.cloudEnabled !== (restore ? false : cloudDraft)
        )
          throw new Error("Cloud permission readback is unconfirmed");
        setBaseRevision(receipt.revision);
        setNeedsReview(false);
        if (restore && choice === "ollama")
          setValue(current.data.ollama.baseUrl ?? "");
        if (choice === "ollama")
          setCloudDraft(
            typeof current.data.ollama.cloudEnabled === "boolean"
              ? current.data.ollama.cloudEnabled
              : null,
          );
      } else if (choice === "ollama" && cloudDraft !== null) {
        setNotice("unconfirmed");
      }
      await Promise.allSettled([
        client.invalidateQueries({ queryKey: getGetModelCatalogQueryKey() }),
        client.invalidateQueries({ queryKey: ["settings", "llm"] }),
      ]);
    } catch (error) {
      const status = connectionError(error);
      setNotice(
        status === 400 ? "invalid" : status === 409 ? "changed" : "unconfirmed",
      );
      setNeedsReview(true);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="min-w-0 space-y-4" aria-busy={busy || state.isFetching}>
      <h3 className="text-base font-semibold">
        {choice === "ollama" ? c.local : c.api}
      </h3>
      {state.isPending ? <p role="status">{t("loadingScreen")}</p> : null}
      {state.isError ? <p role="alert">{c.unconfirmed}</p> : null}
      <form
        className="min-w-0 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {choice === "api" ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={c.apiProviders}
          >
            {(["openai", "openrouter"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={provider === option ? "secondary" : "outline"}
                className="min-h-11"
                aria-pressed={provider === option}
                disabled={busy || baseRevision === null}
                onClick={() => {
                  setProvider(option);
                  setValue("");
                  if (!needsReview) setNotice(null);
                }}
              >
                {option === "openai" ? "OpenAI" : "OpenRouter"}
              </Button>
            ))}
          </div>
        ) : null}
        <label htmlFor={id} className="block text-sm font-medium">
          {choice === "ollama" ? c.endpoint : c.key}
        </label>
        <Input
          id={id}
          type={choice === "ollama" ? "text" : "password"}
          inputMode={choice === "ollama" ? "url" : "text"}
          dir="ltr"
          value={value ?? ""}
          maxLength={choice === "ollama" ? 2048 : 512}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || baseRevision === null}
          aria-describedby={`${id}-hint`}
          className="min-h-11 min-w-0"
          onChange={(event) => {
            setValue(event.target.value);
            if (choice === "ollama" && cloudDraft !== null)
              setCloudDraft(false);
            if (!needsReview) setNotice(null);
          }}
        />
        <p
          id={`${id}-hint`}
          className="text-sm leading-6 text-muted-foreground"
        >
          {choice === "ollama" ? c.endpointHint : c.keyHint}
        </p>
        {choice === "ollama" ? (
          <div className="space-y-3 rounded-control border bg-secondary/30 p-3">
            <p className="text-sm leading-6">
              {state.data?.ollama.localEnforcementSupported === true
                ? c.localVerified
                : c.localRequirement}
            </p>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={cloudDraft === true}
                disabled={
                  blocked ||
                  cloudDraft === null ||
                  (state.data?.ollama.localEnforcementSupported !== true &&
                    cloudDraft !== true)
                }
                aria-describedby={`${id}-cloud-usage`}
                className="h-5 w-5 shrink-0 accent-primary"
                onChange={(event) => setCloudDraft(event.target.checked)}
              />
              <span>{c.allowCloud}</span>
            </label>
            <p
              id={`${id}-cloud-usage`}
              className="text-sm leading-6 text-muted-foreground"
            >
              {c.cloudUsage}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {typeof state.data?.ollama.cloudEnabled !== "boolean"
                ? c.unknown
                : state.data.ollama.cloudEnabled
                  ? c.cloudOn
                  : c.cloudOff}
            </p>
          </div>
        ) : null}
        <Button
          type="submit"
          disabled={blocked || !value?.trim()}
          className="min-h-11"
        >
          {busy ? t("loadingScreen") : c.save}
        </Button>
        {choice === "ollama" ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 ms-2"
              disabled={blocked || !state.data?.ollama.configured}
              onClick={() => void save(true)}
            >
              {c.restore}
            </Button>
            <p className="text-sm text-muted-foreground">{c.restoreHint}</p>
          </>
        ) : null}
      </form>
      {notice ? (
        <p
          role={notice === "saved" ? "status" : "alert"}
          className="rounded-control border p-3 text-sm leading-6"
        >
          {c[notice]}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={busy || state.isFetching}
        onClick={() => void refresh()}
      >
        {c.refresh}
      </Button>
      {state.data && !state.isError ? (
        <div className="min-w-0 space-y-2">
          <h4 className="text-sm font-semibold">{c.discovered}</h4>
          {state.data.catalog.models.some(
            (model) =>
              model.provider === (choice === "ollama" ? "ollama" : provider) &&
              model.supportsTools,
          ) ? null : (
            <p className="text-sm text-muted-foreground">{c.none}</p>
          )}
          <ul className="space-y-2 text-sm">
            {state.data.catalog.models
              .filter(
                (model) =>
                  model.provider ===
                  (choice === "ollama" ? "ollama" : provider),
              )
              .slice(0, 24)
              .map((model) => (
                <li key={model.id} className="[overflow-wrap:anywhere]">
                  <bdi>{model.label}</bdi> ·{" "}
                  {model.provider === "ollama" ? (
                    <>
                      <span>
                        {model.executionLocation === "local" &&
                        model.id.startsWith("ollama:")
                          ? c.localLocation
                          : model.executionLocation === "cloud" &&
                              model.id.startsWith("ollama-cloud:")
                            ? c.cloudLocation
                            : c.unknownLocation}
                      </span>
                      {" · "}
                    </>
                  ) : null}
                  {model.supportsTools ? c.tools : c.chatOnly}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
