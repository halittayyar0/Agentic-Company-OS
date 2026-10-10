import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { Task } from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { Button } from "@/components/ui/button";
import { loadReusableWorkCopy } from "@/lib/reusable-work-copy";
import { preparePersonalGuide, prepareProjectText } from "@/lib/project-reuse";
import { taskStatusLabel } from "@/lib/format";

export default function ProjectReuseActions({
  project,
  sourceUnavailable,
}: {
  project: Task;
  sourceUnavailable: boolean;
}) {
  const { locale } = useLocale(),
    [, navigate] = useLocation();
  const [error, setError] = useState(false);
  const copy = useQuery({
    queryKey: ["reusable-work-copy", locale],
    queryFn: () => loadReusableWorkCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const text = prepareProjectText(project);
  if (!text || text.source?.kind !== "project") return null;
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        onRetry={() => void copy.refetch()}
        className="mt-4 text-sm"
      />
    );
  const c = copy.data;
  function prepare(guide: boolean) {
    if (sourceUnavailable || !text || text.source?.kind !== "project") return;
    try {
      if (guide) {
        const manifest = preparePersonalGuide(
          project,
          `user-${crypto.randomUUID()}`,
          c.guideSource.replace("{id}", String(project.id)),
        );
        if (!manifest) throw Error("Invalid source text");
        navigate("/skills", {
          state: { acosGuideDraft: { manifest, source: text.source } },
        });
      } else navigate("/projects/new", { state: { acosSkillDraft: text } });
    } catch {
      setError(true);
    }
  }
  return (
    <section
      aria-labelledby="project-reuse-title"
      className="mt-4 space-y-3 rounded-xl border border-border p-4 text-sm leading-6 [overflow-wrap:anywhere]"
    >
      <h2 id="project-reuse-title" className="font-semibold">
        {c.savedBrief} · <bdi>#{project.id}</bdi> ·{" "}
        {taskStatusLabel(project.status, locale)}
      </h2>
      <p className="text-muted-foreground">{c.sourceHelp}</p>
      <time dateTime={project.updatedAt}>
        {new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(project.updatedAt))}
      </time>
      {error && <p role="alert">{c.choiceError}</p>}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 max-w-full whitespace-normal"
          disabled={sourceUnavailable}
          onClick={() => prepare(false)}
        >
          {c.useBrief}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 max-w-full whitespace-normal"
          disabled={sourceUnavailable}
          onClick={() => prepare(true)}
        >
          {c.prepareGuide}
        </Button>
      </div>
    </section>
  );
}
