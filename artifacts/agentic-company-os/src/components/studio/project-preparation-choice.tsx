import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { Button } from "@/components/ui/button";
import { loadReusableWorkCopy } from "@/lib/reusable-work-copy";
import type { ProjectPreparation } from "@/lib/project-preparation";

export default function ProjectPreparationChoice({
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
