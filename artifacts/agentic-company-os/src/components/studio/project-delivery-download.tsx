import type { Task } from "@workspace/api-client-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { taskStatusLabel } from "@/lib/format";
import {
  downloadDeliveryText,
  projectDeliveryExport,
} from "@/lib/project-delivery-export";
import { loadDeliveryDownloadCopy } from "@/lib/delivery-download-copy";
import type { ProjectStudioCopy } from "@/lib/project-studio-copy";

export function ProjectDeliveryDownload({
  project,
  context,
}: {
  project: Task;
  context: ProjectStudioCopy;
}) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["delivery-download-copy", locale],
    queryFn: () => loadDeliveryDownloadCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const operatorCopy = useQuery({
    queryKey: ["task-result-review-copy", locale],
    queryFn: async () =>
      (await import("@/lib/task-result-review-copy")).loadTaskResultReviewCopy(
        locale,
      ),
    enabled: project.completionAuthority === "operator",
    staleTime: Infinity,
    retry: false,
  });
  const [failedSnapshot, setFailedSnapshot] = useState<{
    id: number;
    summary: string;
  } | null>(null);
  const summary = project.resultSummary?.trim();
  if (!summary) return null;
  if (
    !copy.data ||
    (project.completionAuthority === "operator" && !operatorCopy.data)
  )
    return (
      <LanguagePackStatus
        as="div"
        error={copy.isError || operatorCopy.isError}
        className="min-w-0 max-w-full text-sm [overflow-wrap:anywhere]"
        buttonClassName="mt-2 min-h-11"
      />
    );
  const c = copy.data;
  const formatMarker = "(.txt)",
    formatStart = c.downloadDelivery.indexOf(formatMarker);
  const downloadFailed =
    failedSnapshot?.id === project.id && failedSnapshot.summary === summary;
  function download() {
    if (!summary || !copy.data) return;
    setFailedSnapshot(null);
    try {
      const file = projectDeliveryExport(
        project,
        {
          ...context,
          ...copy.data,
          operatorProvenance: operatorCopy.data?.provenanceHelp,
        },
        taskStatusLabel(project.status, locale),
      );
      if (!file) throw new Error("delivery_export_unavailable");
      downloadDeliveryText(file);
    } catch {
      setFailedSnapshot({ id: project.id, summary });
    }
  }
  return (
    <div className="min-w-0 max-w-full">
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
              {c.downloadDelivery.slice(formatStart + formatMarker.length)}
            </>
          )}
        </span>
      </Button>
      {downloadFailed ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {c.deliveryDownloadError}
        </p>
      ) : null}
    </div>
  );
}
