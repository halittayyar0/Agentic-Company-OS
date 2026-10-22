import type { Task } from "@workspace/api-client-react";
import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { Markdown } from "@/lib/markdown";
import { taskStatusLabel } from "@/lib/format";
import {
  downloadDeliveryText,
  projectDeliveryExport,
} from "@/lib/project-delivery-export";
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
  const { locale } = useLocale();
  const [failedSnapshot, setFailedSnapshot] = useState<{
    id: number;
    summary: string;
  } | null>(null);
  const summary = project.resultSummary?.trim();
  const formatMarker = "(.txt)";
  const formatStart = c.downloadDelivery.indexOf(formatMarker);
  const downloadFailed =
    failedSnapshot?.id === project.id && failedSnapshot.summary === summary;
  if (!summary && project.status !== "completed") return null;

  function download() {
    if (!summary) return;
    setFailedSnapshot(null);
    try {
      const file = projectDeliveryExport(
        project,
        c,
        taskStatusLabel(project.status, locale),
      );
      if (!file) throw new Error("delivery_export_unavailable");
      downloadDeliveryText(file);
    } catch {
      setFailedSnapshot({ id: project.id, summary });
    }
  }

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
        <div className="flex max-w-full flex-wrap gap-2">
          {summary ? (
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 max-w-full gap-1 whitespace-normal px-2 py-2 [overflow-wrap:anywhere]"
              onClick={download}
            >
              <Download size={16} className="shrink-0" aria-hidden />
              <span className="min-w-0">
                {formatStart < 0 ? (
                  c.downloadDelivery
                ) : (
                  <>
                    {c.downloadDelivery.slice(0, formatStart)}
                    <bdi dir="ltr">{formatMarker}</bdi>
                    {c.downloadDelivery.slice(
                      formatStart + formatMarker.length,
                    )}
                  </>
                )}
              </span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-11 max-w-full gap-1 whitespace-normal px-2 py-2 [overflow-wrap:anywhere]"
            onClick={onReview}
          >
            {c.reviewDelivery}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {studioText(c.deliveryHelp, { tab: c.evidence })}
      </p>
      {project.autonomyMode === "continuous" && summary ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {c.cycleDeliveryNote}
        </p>
      ) : null}
      {downloadFailed ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {c.deliveryDownloadError}
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
