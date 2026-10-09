import { useCustomizationCopy } from "@/lib/customization-copy";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  retainExtensionEditorBeforeReload,
  useExtensionEditor,
} from "@/hooks/use-extension-editor";
import { loadExtensionEditorCopy } from "@/lib/extension-editor-copy";
import { loadReusableWorkCopy } from "@/lib/reusable-work-copy";
import {
  consumePersonalGuidePreparation,
  readPersonalGuidePreparation,
  preparePersonalGuideProject,
} from "@/lib/project-reuse";
import {
  prepareExtensionSave,
  type EditableManifest as Manifest,
} from "@/lib/extension-editor-draft";

type Entry = {
  id: string;
  revision: number;
  enabled: boolean;
  manifest: Manifest;
};
type Packs = { enabledPacks: string[]; revision: number };
const packIds = ["data", "documents", "web", "code", "planning"];
const operations = [
  "calculate",
  "analyze_text",
  "compare_text",
  "inspect_json",
  "profile_csv",
  "convert_datetime",
  "inspect_url",
  "hash_text",
  "csv_filter",
  "csv_sort",
  "csv_dedupe",
  "csv_join",
  "csv_to_json",
  "json_to_csv",
  "json_diff",
  "json_format",
  "render_report",
  "fill_template",
  "markdown_outline",
  "compare_page_text",
  "csv_select",
  "csv_group",
  "json_select",
  "json_flatten",
  "compare_lists",
  "text_find",
  "text_replace",
  "markdown_table",
  "convert_units",
  "date_interval",
];
const fieldClass =
  "min-h-11 w-full rounded-xl border border-border bg-background p-3 text-base focus-visible:ring-2 focus-visible:ring-primary";
const call = <T,>(path: string, data?: unknown) =>
  customFetch<T>(
    `/api/skills/${path}`,
    data === undefined
      ? {}
      : {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
export function ExtensionLibrary() {
  const { locale } = useLocale();
  const pack = useCustomizationCopy(locale);
  if (!pack.data)
    return (
      <LanguagePackStatus
        error={pack.isError}
        onRetry={() => {
          if (retainExtensionEditorBeforeReload()) window.location.reload();
        }}
      />
    );
  return (
    <ExtensionLibraryBody c={pack.data.extensions} pc={pack.data.program} />
  );
}
function ExtensionLibraryBody({
  c,
  pc,
}: {
  c: readonly string[];
  pc: readonly string[];
}) {
  const { t, locale } = useLocale(),
    cache = useQueryClient();
  const [, navigate] = useLocation();
  const [preparedGuide, setPreparedGuide] = useState(() =>
    readPersonalGuidePreparation(window.history.state),
  );
  const [guideContext, setGuideContext] = useState(preparedGuide);
  const [preparationError, setPreparationError] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const focusAfterPreparation = useRef(false);
  const list = useQuery({
    queryKey: ["personal-capabilities"],
    queryFn: () => call<Entry[]>("extensions"),
    retry: false,
  });
  const packs = useQuery({
    queryKey: ["capability-packs"],
    queryFn: () => call<Packs>("packs"),
    retry: false,
  });
  const [selected, setSelected] = useState<string[] | null>(null),
    [mutationBusy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(false);
  const editor = useExtensionEditor(() => {
    setNotice(c[19]);
    setError(false);
    void Promise.all([
      cache.invalidateQueries({ queryKey: ["personal-capabilities"] }),
      cache.invalidateQueries({ queryKey: ["capability-catalog"] }),
    ]);
  });
  const editorCopy = useQuery({
    queryKey: ["extension-editor-copy", locale],
    queryFn: () => loadExtensionEditorCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const draft = editor.draft?.manifest ?? null,
    revision = editor.draft?.revision ?? 0,
    defaults = editor.draft?.defaults ?? "{}",
    busy = mutationBusy || !!editor.busy;
  const reuseCopy = useQuery({
    queryKey: ["reusable-work-copy", locale],
    queryFn: () => loadReusableWorkCopy(locale),
    staleTime: Infinity,
    retry: false,
    enabled:
      !!preparedGuide ||
      !!guideContext ||
      !!list.data?.some((row) => row.manifest.kind === "skill"),
  });
  const visibleGuide =
    preparedGuide ??
    (draft?.id === guideContext?.manifest.id ? guideContext : null);
  function preparedDraft() {
    return preparedGuide
      ? {
          version: 1 as const,
          manifest: preparedGuide.manifest,
          revision: 0,
          defaults: "{}",
          enabled: false,
        }
      : null;
  }
  function consumePreparedGuide(use: boolean) {
    if (!preparedGuide) return false;
    const consumed = consumePersonalGuidePreparation(
      preparedGuide,
      window.history,
    );
    setPreparationError(!consumed);
    if (consumed) {
      focusAfterPreparation.current = true;
      setPreparedGuide(null);
      if (!use) setGuideContext(null);
    }
    return consumed;
  }
  function resolvePrepared(use: boolean) {
    if (editor.pending || editor.busy) return;
    const next = preparedDraft();
    const retained = editor.incoming
      ? editor.resolveIncoming(use)
      : !!editor.current.current &&
        editor.change(use && next ? next : editor.current.current);
    if (retained) consumePreparedGuide(use);
    else setPreparationError(true);
  }
  const attemptedPreparation = useRef(false);
  useEffect(() => {
    if (!preparedGuide || editor.pending || attemptedPreparation.current)
      return;
    attemptedPreparation.current = true;
    const next = preparedDraft();
    if (next && editor.prepare(next)) consumePreparedGuide(true);
  }, [preparedGuide, editor.pending]);
  useEffect(() => {
    if (focusAfterPreparation.current && !preparedGuide && titleRef.current) {
      focusAfterPreparation.current = false;
      titleRef.current.focus();
    }
  }, [preparedGuide, draft?.id]);
  function setDraft(value: Manifest | null) {
    if (!value) editor.discard();
    else if (editor.current.current)
      editor.change({ ...editor.current.current, manifest: value });
  }
  function setDefaults(value: string) {
    if (editor.current.current)
      editor.change({ ...editor.current.current, defaults: value });
  }
  const flight = useRef(false);
  async function mutate(operation: () => Promise<unknown>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(c[19]);
      setError(false);
      setSelected(null);
    } catch {
      setNotice(c[18]);
      setError(true);
    } finally {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["personal-capabilities"] }),
        cache.invalidateQueries({ queryKey: ["capability-packs"] }),
        cache.invalidateQueries({ queryKey: ["capability-catalog"] }),
      ]);
      setBusy(false);
      flight.current = false;
    }
  }
  function edit(row?: Entry) {
    editor.edit(row?.manifest, row?.revision ?? 0, row?.enabled ?? true);
    setNotice("");
  }
  const ec = editorCopy.data;
  return (
    <section
      aria-labelledby="personal-capabilities-title"
      className="space-y-5 rounded-panel border border-border bg-card p-5 sm:p-7 [overflow-wrap:anywhere]"
    >
      <h2 id="personal-capabilities-title" className="text-xl font-semibold">
        {c[0]}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        {c[27]}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy || !!editor.pending || !!preparedGuide}
          onClick={() => edit()}
        >
          {c[1]}
        </Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-border px-4 text-sm">
          {c[17]}
          <input
            aria-label={c[17]}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            disabled={busy || !!editor.pending || !!preparedGuide}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                // UTF-8 can use several bytes per server-counted character.
                // Bound file reading separately; prepareExtensionSave below
                // enforces the authoritative 16,000-character JSON limit.
                if (file.size > 64000) throw Error();
                const value = JSON.parse(await file.text()) as Manifest;
                if (
                  value.schemaVersion !== 1 ||
                  !/^user-[a-z0-9][a-z0-9-]{0,59}$/u.test(value.id) ||
                  !["skill", "tool", "program"].includes(value.kind)
                )
                  throw Error();
                const stored = list.data?.find((row) => row.id === value.id);
                if (
                  !prepareExtensionSave({
                    version: 1,
                    manifest: value,
                    revision: stored?.revision ?? 0,
                    defaults: JSON.stringify(
                      value.kind === "tool" ? value.defaults : {},
                    ),
                    enabled: stored?.enabled ?? true,
                  })
                )
                  throw Error();
                editor.edit(
                  value,
                  stored?.revision ?? 0,
                  stored?.enabled ?? true,
                );
              } catch {
                setNotice(c[18]);
                setError(true);
              }
            }}
          />
        </label>
      </div>
      {notice && <p role={error ? "alert" : "status"}>{notice}</p>}
      {!ec && (
        <LanguagePackStatus
          error={editorCopy.isError}
          onRetry={() => {
            if (retainExtensionEditorBeforeReload()) window.location.reload();
          }}
        />
      )}
      {ec && editor.storageError && (
        <p role="alert" className="text-sm leading-6">
          {ec.storageError}
        </p>
      )}
      {ec && editor.invalid && (
        <p role="alert" className="text-sm leading-6">
          {ec.validation}
        </p>
      )}
      {visibleGuide &&
        (reuseCopy.data ? (
          <section
            aria-labelledby="prepared-guide-title"
            className="space-y-3 rounded-xl border border-border p-4 text-sm leading-6 [overflow-wrap:anywhere]"
          >
            <h3 id="prepared-guide-title" className="font-semibold">
              {reuseCopy.data.preparedGuide}
            </h3>
            <p>
              <bdi>{visibleGuide.manifest.title}</bdi> ·{" "}
              <bdi>#{visibleGuide.source.id}</bdi> ·{" "}
              <time dateTime={visibleGuide.source.updatedAt}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(visibleGuide.source.updatedAt))}
              </time>
            </p>
            <p>{reuseCopy.data.guideTitleHelp}</p>
            {editor.pending && preparedGuide && (
              <p role="status">{reuseCopy.data.waitingGuide}</p>
            )}
            {preparationError && (
              <p role="alert">{reuseCopy.data.choiceError}</p>
            )}
            {preparedGuide && !editor.incoming && !editor.pending && ec && (
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="min-h-11 max-w-full whitespace-normal"
                  variant="outline"
                  onClick={() => resolvePrepared(false)}
                >
                  {ec.keep}
                </Button>
                <Button
                  type="button"
                  className="min-h-11 max-w-full whitespace-normal"
                  onClick={() => resolvePrepared(true)}
                >
                  {ec.use}
                </Button>
              </div>
            )}
          </section>
        ) : (
          <LanguagePackStatus
            error={reuseCopy.isError}
            onRetry={() => void reuseCopy.refetch()}
          />
        ))}
      {ec && editor.incoming && (
        <div className="space-y-3 rounded-xl border border-border p-4 text-sm leading-6">
          <p>{ec.incomingHelp}</p>
          <p className="font-medium">
            <bdi>{editor.incoming.manifest.title}</bdi>
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="min-h-11 max-w-full whitespace-normal"
              variant="outline"
              onClick={() =>
                preparedGuide
                  ? resolvePrepared(false)
                  : editor.resolveIncoming(false)
              }
            >
              {ec.keep}
            </Button>
            <Button
              type="button"
              className="min-h-11 max-w-full whitespace-normal"
              onClick={() =>
                preparedGuide
                  ? resolvePrepared(true)
                  : editor.resolveIncoming(true)
              }
            >
              {ec.use}
            </Button>
          </div>
        </div>
      )}
      {ec && editor.pending && (
        <section
          aria-labelledby="guide-save-recovery"
          className="space-y-3 rounded-xl border border-border p-4 text-sm leading-6 [overflow-wrap:anywhere]"
        >
          <h3 id="guide-save-recovery" className="font-semibold">
            {ec.pendingTitle}
          </h3>
          <p>
            <bdi>{editor.pending.manifest.id}</bdi>
          </p>
          <p role="status">{ec[editor.status]}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="min-h-11 max-w-full whitespace-normal"
              disabled={busy}
              variant="outline"
              onClick={() => void editor.check()}
            >
              {ec.check}
            </Button>
            {editor.status === "missing" && (
              <Button
                type="button"
                className="min-h-11 max-w-full whitespace-normal"
                disabled={busy}
                onClick={editor.retry}
              >
                {ec.retry}
              </Button>
            )}
            {editor.status === "matching" && (
              <Button
                type="button"
                className="min-h-11 max-w-full whitespace-normal"
                disabled={busy}
                onClick={editor.continue}
              >
                {ec.continue}
              </Button>
            )}
          </div>
          {editor.observed && (
            <div className="space-y-3 border-t border-border pt-3">
              <p className="font-medium">
                {ec.storedVersion}: <bdi>{editor.observed.manifest.title}</bdi>{" "}
                · {editor.observed.revision}
              </p>
              <p>{ec.reviewHelp}</p>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={editor.observed.enabled}
                  disabled
                />
                <span>{ec.storedAvailability}</span>
              </label>
              <pre
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs"
                dir="auto"
              >
                {JSON.stringify(editor.observed.manifest, null, 2)}
              </pre>
              <Button
                type="button"
                className="min-h-11 max-w-full whitespace-normal"
                disabled={busy}
                onClick={editor.reviewCurrent}
              >
                {ec.reviewCurrent}
              </Button>
            </div>
          )}
        </section>
      )}
      {(list.isError || packs.isError) && (
        <div role="alert">
          <p>{c[18]}</p>
          <Button
            variant="outline"
            onClick={() => {
              void list.refetch();
              void packs.refetch();
            }}
          >
            {t("checkAgain")}
          </Button>
        </div>
      )}
      {draft && (
        <form
          noValidate
          className="grid gap-4 rounded-xl border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            editor.save();
          }}
        >
          {(["id", "title", "description"] as const).map((key, index) => (
            <label key={key} className="space-y-2 text-sm">
              <span>{c[index + 2]}</span>
              <input
                className={fieldClass}
                required
                value={draft[key]}
                ref={key === "title" ? titleRef : undefined}
                readOnly={key === "id" && (revision > 0 || !!editor.pending)}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <label className="space-y-2 text-sm">
            <span>{c[5]}</span>
            <select
              className={fieldClass}
              aria-label={c[5]}
              value={draft.kind}
              disabled={!!editor.pending}
              onChange={(event) => {
                const base = {
                  schemaVersion: 1 as const,
                  id: draft.id,
                  title: draft.title,
                  description: draft.description,
                };
                setDraft(
                  event.target.value === "skill"
                    ? { ...base, kind: "skill", instructions: "" }
                    : event.target.value === "program"
                      ? {
                          ...base,
                          kind: "program",
                          code: "return { total: input.units * input.price };",
                          permissions: ["terminal"],
                        }
                      : {
                          ...base,
                          kind: "tool",
                          tool: "calculate",
                          defaults: {},
                        },
                );
              }}
            >
              <option value="skill">{c[6]}</option>
              <option value="tool">{c[7]}</option>
              <option value="program">{pc[0]}</option>
            </select>
          </label>
          {draft.kind === "skill" ? (
            <label className="space-y-2 text-sm">
              <span>{c[8]}</span>
              <textarea
                className={fieldClass}
                rows={6}
                required
                value={draft.instructions}
                aria-label={c[8]}
                onChange={(event) =>
                  setDraft({ ...draft, instructions: event.target.value })
                }
              />
            </label>
          ) : draft.kind === "program" ? (
            <div className="space-y-3 sm:col-span-2">
              <p className="text-sm text-muted-foreground">{pc[2]}</p>
              <label className="block space-y-2 text-sm">
                <span>{pc[1]}</span>
                <textarea
                  className={fieldClass + " font-mono"}
                  rows={10}
                  dir="ltr"
                  required
                  aria-label={pc[1]}
                  value={draft.code}
                  onChange={(event) =>
                    setDraft({ ...draft, code: event.target.value })
                  }
                />
              </label>
            </div>
          ) : (
            <>
              <label className="space-y-2 text-sm">
                <span>{c[9]}</span>
                <select
                  className={fieldClass}
                  aria-label={c[9]}
                  value={draft.tool}
                  onChange={(event) =>
                    setDraft({ ...draft, tool: event.target.value })
                  }
                >
                  {operations.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span>{c[10]}</span>
                <textarea
                  dir="ltr"
                  className={fieldClass}
                  rows={4}
                  value={defaults}
                  aria-label={c[10]}
                  onChange={(event) => setDefaults(event.target.value)}
                />
              </label>
            </>
          )}
          {ec && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={editor.draft?.enabled ?? false}
                onChange={(event) => {
                  if (editor.current.current)
                    editor.change({
                      ...editor.current.current,
                      enabled: event.target.checked,
                    });
                }}
              />
              {ec.availability}
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                !ec ||
                busy ||
                !!editor.pending ||
                !!editor.incoming ||
                !!preparedGuide
              }
              type="submit"
            >
              {c[11]}
            </Button>
            <Button
              disabled={busy || !!editor.pending}
              type="button"
              variant="outline"
              onClick={() => setDraft(null)}
            >
              {c[12]}
            </Button>
          </div>
        </form>
      )}
      {!list.data ? (
        <p role="status">{t("loadingScreen")}</p>
      ) : list.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{c[28]}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.data.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-4 py-4"
            >
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{row.manifest.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {row.manifest.description}
                </p>
                <small>{row.id}</small>
              </div>
              <div className="flex flex-wrap gap-2">
                {reuseCopy.data && preparePersonalGuideProject(row) && (
                  <div className="w-full space-y-2 text-sm">
                    {!row.enabled && <p>{reuseCopy.data.disabledGuideHelp}</p>}
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 max-w-full whitespace-normal"
                      disabled={
                        busy ||
                        list.isFetching ||
                        list.isError ||
                        !!editor.pending ||
                        !!preparedGuide
                      }
                      onClick={() => {
                        const text = preparePersonalGuideProject(row);
                        if (text && !list.isError && !list.isFetching)
                          navigate("/projects/new", {
                            state: { acosSkillDraft: text },
                          });
                      }}
                    >
                      {reuseCopy.data.prepareProject}
                    </Button>
                  </div>
                )}
                <Button
                  disabled={busy || !!editor.pending || !!preparedGuide}
                  variant="outline"
                  onClick={() => edit(row)}
                >
                  {c[13]}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  aria-pressed={row.enabled}
                  onClick={() =>
                    void mutate(() =>
                      call("extensions", {
                        manifest: row.manifest,
                        enabled: !row.enabled,
                        expectedRevision: row.revision,
                      }),
                    )
                  }
                >
                  {row.enabled ? c[14] : c[15]}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void mutate(async () => {
                      const manifest = await call<Manifest>(
                        `extensions/${encodeURIComponent(row.id)}/export`,
                      );
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(manifest, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${row.id}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })
                  }
                >
                  {c[16]}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {packs.data && (
        <fieldset className="space-y-3 border-t border-border pt-5">
          <legend className="pt-5 font-semibold">{c[20]}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {packIds.map((id, index) => (
              <label
                key={id}
                className="flex min-h-11 items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  disabled={busy}
                  checked={(selected ?? packs.data!.enabledPacks).includes(id)}
                  onChange={(event) => {
                    const current = selected ?? packs.data!.enabledPacks;
                    setSelected(
                      event.target.checked
                        ? [...current, id]
                        : current.filter((key) => key !== id),
                    );
                  }}
                />
                {c[22 + index]}
              </label>
            ))}
          </div>
          <Button
            disabled={busy || selected === null}
            variant="outline"
            onClick={() =>
              void mutate(() =>
                call("packs", {
                  enabledPacks: selected,
                  expectedRevision: packs.data!.revision,
                }),
              )
            }
          >
            {c[21]}
          </Button>
        </fieldset>
      )}
    </section>
  );
}
