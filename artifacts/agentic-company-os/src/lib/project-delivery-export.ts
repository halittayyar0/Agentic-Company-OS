import type { Task } from "@workspace/api-client-react";
import { type ProjectStudioCopy, studioText } from "./project-studio-copy";

type Delivery = Pick<Task, "id" | "title" | "resultSummary" | "autonomyMode">;
type ExportCopy = Pick<
  ProjectStudioCopy,
  | "deliverySummary"
  | "deliveryExportProject"
  | "deliveryExportStatus"
  | "deliveryExportNotice"
  | "cycleDeliveryNote"
>;

export function projectDeliveryExport(
  project: Delivery,
  c: ExportCopy,
  status: string,
): { filename: string; text: string } | null {
  const summary = project.resultSummary?.trim();
  if (!summary || !Number.isSafeInteger(project.id) || project.id <= 0)
    return null;
  return {
    filename: `project-${project.id}-summary.txt`,
    text: [
      c.deliverySummary,
      studioText(c.deliveryExportProject, {
        id: project.id,
        title: project.title,
      }),
      studioText(c.deliveryExportStatus, { status }),
      "",
      c.deliveryExportNotice,
      ...(project.autonomyMode === "continuous" ? [c.cycleDeliveryNote] : []),
      "",
      summary,
      "",
    ].join("\n"),
  };
}

export function downloadDeliveryText(file: { filename: string; text: string }) {
  const url = URL.createObjectURL(
    new Blob([file.text], { type: "text/plain;charset=utf-8" }),
  );
  let link: HTMLAnchorElement | undefined;
  try {
    link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    document.body.append(link);
    link.click();
  } finally {
    link?.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
