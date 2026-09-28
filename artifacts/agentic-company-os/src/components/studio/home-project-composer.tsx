import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
  getListTasksQueryKey,
  useCreateTask,
  type Agent,
  type TaskInput,
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
import { cn } from "@/lib/utils";
import type { HomeCopy, HomeMode } from "@/lib/home-copy";
import type { Locale } from "@/lib/i18n";
import { composeProjectBrief } from "@/lib/project-brief";

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
  const createTask = useCreateTask();
  const [mode, setMode] = useState<HomeMode>("team");
  const [failure, setFailure] = useState(false);
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
    resolver: zodResolver(schema),
    defaultValues: { prompt: "" },
  });
  const prompt = form.watch("prompt");
  const busy = createTask.isPending || form.formState.isSubmitting;
  const submit = async ({ prompt: outcome }: Values) => {
    if (!agents.length || blocked || createTask.isPending) return;
    setFailure(false);
    const definition = copy.modes[mode];
    const oneLine = outcome.replace(/\s+/g, " ");
    const projectInput: TaskInput = {
      title: oneLine.length <= 92 ? oneLine : `${oneLine.slice(0, 89).trim()}…`,
      brief: composeProjectBrief(
        outcome,
        locale,
        definition.label,
        definition.instruction,
      ),
      priority: "normal",
      autonomyMode: "finite",
    };
    try {
      const task = await createTask.mutateAsync({ data: projectInput });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetOrgSummaryQueryKey() }),
      ]);
      form.reset();
      toast({
        title: copy.projectReadyTitle,
        description: copy.projectReadyDescription,
      });
      navigate(`/projects/${task.id}`);
    } catch {
      setFailure(true);
    }
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
            disabled={!prompt.trim() || !agents.length || blocked || busy}
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
      {failure ? (
        <p
          role="alert"
          className="mt-3 rounded-control border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {copy.projectLaunchError}
        </p>
      ) : null}
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
                setFailure(false);
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
