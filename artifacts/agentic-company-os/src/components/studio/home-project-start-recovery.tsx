import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ComposerDraft } from "@/lib/composer-draft";
import type { HomeCopy } from "@/lib/home-copy";
import type { Locale } from "@/lib/i18n";
import { composeProjectBrief } from "@/lib/project-brief";
import type { ProjectDraft } from "@/lib/project-start-request";
import { loadNewProjectCopy } from "@/lib/new-project-copy";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import ProjectStartRecovery, {
  type ProjectStartHandle,
  type ProjectStartState,
} from "./project-start-recovery";

export type HomeDraft = Extract<ComposerDraft, { kind: "home" }>;
export type HomeProjectStartHandle = { start: (draft: HomeDraft) => void };

const HomeProjectStartRecovery = forwardRef<
  HomeProjectStartHandle,
  {
    copy: HomeCopy;
    locale: Locale;
    onOpen: (id: number, submitted: HomeDraft | null) => void;
    onStateChange: (state: ProjectStartState) => void;
    onPrepared: () => void;
  }
>(function HomeProjectStartRecovery(
  { copy, locale, onOpen, onStateChange, onPrepared },
  ref,
) {
  const { t } = useLocale();
  const recoveryCopy = useQuery({
    queryKey: ["new-project-copy", locale],
    queryFn: () => loadNewProjectCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (!recoveryCopy.data)
      onStateChange({ ready: false, pending: false, busy: null });
  }, [recoveryCopy.data, onStateChange]);
  const startRequest = useRef<ProjectStartHandle>(null);
  const snapshot = useRef<{ home: HomeDraft; project: ProjectDraft } | null>(
    null,
  );
  useImperativeHandle(ref, () => ({
    start(home) {
      const outcome = home.prompt.trim();
      const oneLine = outcome.replace(/\s+/g, " ");
      const definition = copy.modes[home.mode];
      const project: ProjectDraft = {
        version: 1,
        kind: "project",
        title:
          oneLine.length <= 92 ? oneLine : `${oneLine.slice(0, 89).trim()}…`,
        brief: composeProjectBrief(
          outcome,
          locale,
          definition.label,
          definition.instruction,
        ),
        priority: "normal",
        autonomyMode: "finite",
        cadenceSeconds: 3600,
      };
      snapshot.current = { home: { ...home }, project };
      startRequest.current?.start(project);
    },
  }));
  if (recoveryCopy.isError)
    return (
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
    );
  if (!recoveryCopy.data) return <p role="status">{t("loadingScreen")}</p>;
  return (
    <ProjectStartRecovery
      ref={startRequest}
      copy={recoveryCopy.data}
      onStateChange={onStateChange}
      onPrepared={() => {
        snapshot.current = null;
        onPrepared();
      }}
      onOpen={(id, submitted) => {
        // Reloaded and other-composer starts may be opened, but cannot acknowledge
        // the editable Home draft. Retain it unless this mounted snapshot matches.
        const saved = snapshot.current;
        onOpen(
          id,
          submitted &&
            saved &&
            JSON.stringify(saved.project) === JSON.stringify(submitted)
            ? saved.home
            : null,
        );
      }}
    />
  );
});
export default HomeProjectStartRecovery;
