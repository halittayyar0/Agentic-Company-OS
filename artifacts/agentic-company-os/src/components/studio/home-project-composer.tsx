import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { formResolver } from "@/lib/form-resolver";
import * as z from "zod/v4-mini";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
  getListTasksQueryKey,
  type Agent,
} from "@workspace/api-client-react";
import {
  ArrowUpRight,
  Blocks,
  Code2,
  GitCompareArrows,
  LoaderCircle,
  SearchCheck,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ValidatedForm } from "@/components/ui/validated-form";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";
import type { HomeCopy, HomeMode } from "@/lib/home-copy";
import type { Locale } from "@/lib/i18n";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import type { ComposerDraft } from "@/lib/composer-draft";
import type { ProjectStartState } from "./project-start-recovery";
import type {
  HomeProjectStartHandle,
  HomeDraft,
} from "./home-project-start-recovery";

const ProviderSetupNotice = lazy(() => import("./provider-setup-notice"));

const MODE_ICONS = {
  team: Blocks,
  engineer: Code2,
  research: SearchCheck,
  compare: GitCompareArrows,
} as const satisfies Record<HomeMode, typeof Blocks>;
type Values = { prompt: string };

export function HomeProjectComposer({
  agents,
  blocked,
  copy,
  locale,
}: {
  agents: Agent[];
  blocked: boolean;
  copy: HomeCopy;
  locale: Locale;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLocale();
  const recoveryModule = useQuery({
    queryKey: ["home-project-start-recovery"],
    queryFn: () => import("./home-project-start-recovery"),
    staleTime: Infinity,
    retry: false,
  });
  const Recovery = recoveryModule.data?.default;
  const startRequest = useRef<HomeProjectStartHandle>(null);
  const [startState, setStartState] = useState<ProjectStartState>({
    ready: false,
    pending: false,
    busy: null,
  });
  const draft = useComposerDraft<Extract<ComposerDraft, { kind: "home" }>>({
    version: 1,
    kind: "home",
    prompt: "",
    mode: "team",
  });
  const [mode, setMode] = useState<HomeMode>(draft.value.mode);
  const schema = useMemo(
    () =>
      z.object({
        prompt: z
          .string()
          .check(
            z.trim(),
            z.minLength(10, copy.validationShort),
            z.maxLength(7000, copy.validationLong),
          ),
      }),
    [copy],
  );
  const form = useForm<Values>({
    resolver: formResolver(schema),
    defaultValues: { prompt: draft.value.prompt },
  });
  const prompt = form.watch("prompt");
  const busy = Boolean(startState.busy) || form.formState.isSubmitting;
  useEffect(() => {
    draft.change({
      version: 1,
      kind: "home",
      mode,
      prompt: form.getValues("prompt"),
    });
    const subscription = form.watch((values) =>
      draft.change({
        version: 1,
        kind: "home",
        mode,
        prompt: values.prompt ?? "",
      }),
    );
    return () => subscription.unsubscribe();
  }, [form, mode]);
  const submit = () => {
    if (
      !agents.length ||
      blocked ||
      !Recovery ||
      !startState.ready ||
      startState.pending ||
      startState.busy ||
      !startRequest.current
    )
      return;
    const submittedDraft = {
      version: 1 as const,
      kind: "home" as const,
      mode,
      prompt: form.getValues("prompt"),
    };
    draft.change(submittedDraft);
    startRequest.current.start(submittedDraft);
  };
  const openProject = (id: number, submitted: HomeDraft | null) => {
    if (submitted) draft.finish(submitted);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetOrgSummaryQueryKey() }),
    ]);
    toast({
      title: copy.projectReadyTitle,
      description: copy.projectReadyDescription,
    });
    navigate(`/projects/${id}`);
  };

  return (
    <section aria-labelledby="project-composer-heading">
      <ValidatedForm
        form={form}
        onSubmit={submit}
        className="overflow-hidden rounded-[24px] border border-border bg-card transition-colors focus-within:border-primary/60"
        aria-busy={busy}
      >
        <div className="p-5 sm:p-6">
          <label
            id="project-composer-heading"
            htmlFor="project-outcome"
            className="text-sm font-semibold"
          >
            {copy.desiredOutcome}
          </label>
          <Textarea
            id="project-outcome"
            {...form.register("prompt")}
            rows={4}
            maxLength={7000}
            disabled={busy}
            aria-invalid={Boolean(form.formState.errors.prompt)}
            aria-describedby={`project-composer-help${form.formState.errors.prompt ? " project-outcome-error" : ""}`}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={copy.placeholder}
            className="mt-3 min-h-32 border-0 bg-transparent px-0 py-1 text-base leading-7 shadow-none focus-visible:ring-0"
          />
          {form.formState.errors.prompt ? (
            <p
              id="project-outcome-error"
              role="alert"
              className="mt-2 text-sm text-destructive"
            >
              {form.formState.errors.prompt.message}
            </p>
          ) : null}
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label={copy.modeGroup}
          >
            {(Object.keys(MODE_ICONS) as HomeMode[]).map((key) => {
              const definition = copy.modes[key];
              const Icon = MODE_ICONS[key];
              return (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  aria-pressed={mode === key}
                  onClick={() => setMode(key)}
                  className={cn(
                    "min-h-10 px-3 text-xs",
                    mode === key
                      ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon aria-hidden />
                  {definition.label}
                </Button>
              );
            })}
          </div>
          <p
            className="mt-3 min-h-5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {copy.modes[mode].hint}
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t border-border bg-secondary/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p
            id="project-composer-help"
            className="text-xs text-muted-foreground"
          >
            {copy.composerHelp}
            <span className="mt-1 hidden sm:block">{copy.submitShortcut}</span>
          </p>
          <Button
            type="submit"
            disabled={
              !prompt.trim() ||
              !agents.length ||
              blocked ||
              busy ||
              !Recovery ||
              !startState.ready ||
              startState.pending
            }
            aria-busy={busy}
            className="min-h-11 min-w-[min(10rem,100%)]"
          >
            {busy ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <ArrowUpRight aria-hidden />
            )}
            {busy ? copy.startingProject : copy.startProject}
          </Button>
        </div>
      </ValidatedForm>
      {Recovery && recoveryModule.data ? (
        <Recovery
          ref={startRequest}
          copy={copy}
          locale={locale}
          onStateChange={setStartState}
          onOpen={openProject}
          onPrepared={() => form.setFocus("prompt")}
        />
      ) : recoveryModule.isError ? (
        <div
          role="alert"
          className="mt-4 space-y-2 text-sm [overflow-wrap:anywhere]"
        >
          <p>{copy.startUnavailable}</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => window.location.reload()}
          >
            {t("checkAgain")}
          </Button>
        </div>
      ) : null}
      <Suspense fallback={null}>
        <ProviderSetupNotice onReady={() => form.setFocus("prompt")} />
      </Suspense>
      {draft.error && (
        <p role="alert" className="mt-3 break-words text-sm leading-6">
          {copy.draftStorageError}
        </p>
      )}
      {blocked ? (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-control border border-attention/30 bg-attention/5 p-4 text-sm text-attention-foreground"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {copy.blocked}
        </p>
      ) : null}
      {!agents.length ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {copy.beforeStart}{" "}
          <Link
            href="/agents/new"
            className="font-medium text-primary underline underline-offset-4"
          >
            {copy.firstExpert}
          </Link>
        </p>
      ) : null}
      <div className="mt-5">
        <p className="mb-2.5 text-xs font-medium text-muted-foreground">
          {copy.exampleKicker}
        </p>
        <div className="flex flex-wrap gap-2">
          {copy.examples.map((example) => (
            <button
              key={example.label}
              type="button"
              disabled={busy}
              onClick={() => {
                setMode(example.mode);
                form.setValue("prompt", example.prompt, {
                  shouldValidate: false,
                });
                form.clearErrors();
                form.setFocus("prompt");
              }}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {example.label}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
