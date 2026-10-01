import type { Task } from "@workspace/api-client-react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/lib/markdown";
import { type ProjectStudioCopy, studioText } from "@/lib/project-studio-copy";

export function ProjectDeliverySummary({
  project,
  c,
  onReview,
}: {
  project: Task;
  c: ProjectStudioCopy;
  onReview: () => void;
}) {
  const summary = project.resultSummary?.trim();
  if (!summary && project.status !== "completed") return null;

  return (
    <section
      id="project-delivery-summary"
      aria-labelledby="project-delivery-heading"
      className="min-w-0 border-b border-border/60 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="project-delivery-heading"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <FileText size={18} className="text-primary" aria-hidden />
          {c.deliverySummary}
        </h2>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 max-w-full whitespace-normal"
          onClick={onReview}
        >
          {c.reviewDelivery}
        </Button>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {studioText(c.deliveryHelp, { tab: c.evidence })}
      </p>
      {project.autonomyMode === "continuous" && summary ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {c.cycleDeliveryNote}
        </p>
      ) : null}
      {summary ? (
        <div dir="auto" className="mt-4 min-w-0 [overflow-wrap:anywhere]">
          <Markdown content={summary} />
        </div>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {c.noDelivery}
        </p>
      )}
    </section>
  );
}
