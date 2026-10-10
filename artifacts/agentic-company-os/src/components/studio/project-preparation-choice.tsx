import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { Button } from "@/components/ui/button";
import { loadReusableWorkCopy } from "@/lib/reusable-work-copy";
import {
  consumeProjectPreparation,
  hasProjectDraftInput,
  readProjectPreparation,
  type ProjectPreparation,
} from "@/lib/project-preparation";
import type { useComposerDraft } from "@/hooks/use-composer-draft";
import type { ProjectDraft } from "@/lib/project-start-request";

export default function ProjectPreparationChoice({
  draft,
  titleRef,
  briefRef,
  onBlockedChange,
}: {
  draft: Pick<
    ReturnType<typeof useComposerDraft<ProjectDraft>>,
    "current" | "change" | "error" | "hasRestoredInput"
  >;
  titleRef: RefObject<HTMLInputElement | null>;
  briefRef: RefObject<HTMLTextAreaElement | null>;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const [incoming, setIncoming] = useState(() =>
    readProjectPreparation(window.history.state),
  );
  const [choiceError, setChoiceError] = useState(false);
  const [hasSource] = useState(() => !!incoming?.source);
  function resolveIncoming(use: boolean) {
    if (!incoming) return;
    const saved =
      !use ||
      draft.change({
        version: 1,
        kind: "project",
        title: incoming.title,
        brief: incoming.brief,
        priority: "normal",
        autonomyMode: "finite",
        cadenceSeconds: 3600,
      });
    const consumed =
      saved && consumeProjectPreparation(incoming, window.history);
    setChoiceError(!consumed);
    if (consumed) {
      setIncoming(null);
      (use
        ? titleRef
        : draft.current.current.title
          ? briefRef
          : titleRef
      ).current?.focus();
    }
  }
  function reloadIncomingCopy() {
    // A failed dynamic import can remain cached until this document reloads.
    // Verify the current editable text before offering that recovery action.
    if (!draft.change(draft.current.current)) {
      setChoiceError(true);
      return;
    }
    window.location.reload();
  }
  useEffect(() => onBlockedChange(!!incoming), [incoming, onBlockedChange]);
  const attemptedPrefill = useRef(false);
  useEffect(() => {
    if (attemptedPrefill.current) return;
    attemptedPrefill.current = true;
    if (
      incoming &&
      !draft.error &&
      !draft.hasRestoredInput &&
      !hasProjectDraftInput(draft.current.current)
    )
      resolveIncoming(true);
  }, []);
  return (
    <>
      {incoming ? (
        <IncomingChoice
          incoming={incoming}
          error={choiceError}
          onKeep={() => resolveIncoming(false)}
          onUse={() => resolveIncoming(true)}
          onReload={reloadIncomingCopy}
        />
      ) : null}
      {hasSource && !incoming && (
        <RuntimePreparationHelp onReload={reloadIncomingCopy} />
      )}
    </>
  );
}

function RuntimePreparationHelp({ onReload }: { onReload: () => void }) {
  const { locale, t } = useLocale();
  const copy = useQuery({
    queryKey: ["reusable-work-copy", locale],
    queryFn: () => loadReusableWorkCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return <LanguagePackStatus error={copy.isError} onRetry={onReload} />;
  return (
    <section
      id="prepared-project-runtime"
      className="mb-5 space-y-2 text-sm leading-6 [overflow-wrap:anywhere]"
    >
      <p>{copy.data.runtimeHelp}</p>
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
      >
        {t("settings")}
      </Link>
    </section>
  );
}

function IncomingChoice({
  incoming,
  error,
  onKeep,
  onUse,
  onReload,
}: {
  incoming: ProjectPreparation;
  error: boolean;
  onKeep: () => void;
  onUse: () => void;
  onReload: () => void;
}) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["reusable-work-copy", locale],
    queryFn: () => loadReusableWorkCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return <LanguagePackStatus error={copy.isError} onRetry={onReload} />;
  const c = copy.data;
  return (
    <section
      aria-labelledby="incoming-preparation-title"
      className="mb-5 space-y-3 rounded-panel border border-border bg-card p-4 text-sm leading-6 [overflow-wrap:anywhere]"
    >
      <h2 id="incoming-preparation-title" className="font-semibold">
        {c.incomingTitle}
      </h2>
      <p>{c.incomingHelp}</p>
      <p className="font-medium">
        <bdi>{incoming.title}</bdi>
      </p>
      <p className="text-muted-foreground">{c.preparationOnly}</p>
      {error && <p role="alert">{c.choiceError}</p>}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 max-w-full whitespace-normal"
          onClick={onKeep}
        >
          {c.keepCurrent}
        </Button>
        <Button
          type="button"
          className="min-h-11 max-w-full whitespace-normal"
          onClick={onUse}
        >
          {c.useIncoming}
        </Button>
      </div>
    </section>
  );
}
