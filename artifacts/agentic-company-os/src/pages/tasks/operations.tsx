import { OperationsCopyBoundary } from "../../components/operations/operations-copy-boundary";
import { OperationRecoveryPanel } from "../../components/operations/operation-recovery-panel";
import { useOperationsCopy } from "../../components/operations/operations-copy-context";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Link, useRoute } from "wouter";
import {
  getGetProjectOperationsQueryKey,
  useGetProjectOperations,
  type ProjectOperationsSnapshot,
} from "@workspace/api-client-react";

import { ProjectOperationsRoom } from "../../components/operations/project-operations-room";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { useClock } from "../../hooks/use-clock";
import { useOperationsStream } from "../../hooks/use-operations-stream";
import { chooseNewestOperationsSnapshot } from "../../lib/operations-snapshot-cache";
import { buildOperationsRoomModel } from "../../lib/operations-view-model";

export default function ProjectOperationsPage() {
  return (
    <OperationsCopyBoundary>
      <ProjectOperationsContent />
    </OperationsCopyBoundary>
  );
}
function ProjectOperationsContent() {
  const [, projectParams] = useRoute("/projects/:projectId/operations");
  const [, legacyParams] = useRoute("/tasks/:taskId/operations");
  const taskId = Number(projectParams?.projectId ?? legacyParams?.taskId);
  return (
    <>
      {Number.isInteger(taskId) && taskId > 0 && taskId <= 2147483647 && (
        <OperationRecoveryPanel key={taskId} projectId={taskId} />
      )}
      <ProjectOperationsSnapshotContent />
    </>
  );
}
function ProjectOperationsSnapshotContent() {
  const { t } = useOperationsCopy();

  const [, projectParams] = useRoute("/projects/:projectId/operations");
  const [, legacyParams] = useRoute("/tasks/:taskId/operations");
  const rawId = projectParams?.projectId ?? legacyParams?.taskId;
  const taskId = Number(rawId);
  const validTaskId = Number.isInteger(taskId) && taskId > 0;
  const query = useGetProjectOperations(taskId, undefined, {
    query: {
      queryKey: getGetProjectOperationsQueryKey(taskId),
      enabled: validTaskId,
      refetchInterval: 20_000,
      refetchOnWindowFocus: "always",
      structuralSharing: (current, incoming) =>
        chooseNewestOperationsSnapshot(
          current,
          incoming as ProjectOperationsSnapshot,
        ),
    },
  });
  const stream = useOperationsStream({
    scope: { scope: "project", taskId: validTaskId ? taskId : 1 },
    enabled: validTaskId && query.isSuccess,
  });
  const now = useClock();
  const model = query.data
    ? buildOperationsRoomModel(query.data, { now, stream })
    : null;

  if (!validTaskId) {
    return (
      <OperationsUnavailable
        title={t("invalidAddress")}
        description={t("invalidAddressHelp")}
      />
    );
  }
  if (query.isError && !query.data) {
    const notFound = query.error?.status === 404;
    return (
      <OperationsUnavailable
        title={notFound ? t("projectMissing") : t("projectError")}
        description={notFound ? t("projectMissingHelp") : t("projectErrorHelp")}
        onRetry={notFound ? undefined : () => void query.refetch()}
      />
    );
  }
  if (query.isPending || !model) return <OperationsRoomSkeleton />;

  return (
    <ProjectOperationsRoom
      key={taskId}
      project={query.data.rootTask}
      model={model}
      now={now}
      refreshing={query.isFetching}
      refreshFailed={query.isRefetchError}
      onRefresh={() => void query.refetch()}
    />
  );
}

function OperationsRoomSkeleton() {
  const { t } = useOperationsCopy();

  return (
    <div
      className="space-y-4 p-4 sm:p-5"
      role="status"
      aria-label={t("projectLoading")}
    >
      <Skeleton className="h-72 w-full rounded-none" />
      <Skeleton className="h-28 w-full rounded-none" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-none" />
        <Skeleton className="h-80 rounded-none" />
      </div>
    </div>
  );
}

function OperationsUnavailable({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const { t } = useOperationsCopy();

  return (
    <div
      className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center"
      role="alert"
    >
      <span className="grid size-12 place-items-center rounded-full border border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300">
        <AlertTriangle size={20} aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <div className="mt-5 flex items-center gap-2">
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center gap-1.5 border border-border bg-card px-3 text-xs font-semibold hover:border-primary/40"
        >
          <ArrowLeft size={13} aria-hidden />
          {t("backProjects")}
        </Link>
        {onRetry ? (
          <Button type="button" size="sm" onClick={onRetry}>
            <RefreshCw size={13} aria-hidden />
            {t("retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
