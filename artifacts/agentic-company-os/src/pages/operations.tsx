import { OperationsCopyBoundary } from "../components/operations/operations-copy-boundary";
import { useOperationsCopy } from "../components/operations/operations-copy-context";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  getGetOperationsOverviewQueryKey,
  getListRuntimeInstancesQueryKey,
  useGetOperationsOverview,
  useListRuntimeInstances,
  type OperationsOverview,
} from "@workspace/api-client-react";

import { FleetOperationsRoom } from "../components/operations/fleet-operations-room";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useClock } from "../hooks/use-clock";
import { useOperationsStream } from "../hooks/use-operations-stream";
import { chooseNewestOperationsSnapshot } from "../lib/operations-snapshot-cache";
import { buildFleetOperationsModel } from "../lib/operations-view-model";

export default function OperationsPage() {
  return (
    <OperationsCopyBoundary>
      <OperationsContent />
    </OperationsCopyBoundary>
  );
}
function OperationsContent() {
  const { t } = useOperationsCopy();

  const overview = useGetOperationsOverview(undefined, {
    query: {
      queryKey: getGetOperationsOverviewQueryKey(),
      refetchInterval: 20_000,
      refetchOnWindowFocus: "always",
      structuralSharing: (current, incoming) =>
        chooseNewestOperationsSnapshot(current, incoming as OperationsOverview),
    },
  });
  const stream = useOperationsStream({
    scope: { scope: "global" },
    enabled: overview.isSuccess,
  });
  const instances = useListRuntimeInstances(undefined, {
    query: {
      queryKey: getListRuntimeInstancesQueryKey(),
      refetchInterval: 10_000,
      refetchOnWindowFocus: "always",
    },
  });
  const now = useClock();
  const model = overview.data
    ? buildFleetOperationsModel(overview.data, { now, stream })
    : null;

  if (overview.isError && !overview.data) {
    return (
      <div
        className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center"
        role="alert"
      >
        <span className="grid size-12 place-items-center rounded-full border border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300">
          <AlertTriangle size={20} aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-tight">
          {t("fleetError")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t("fleetErrorHelp")}
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-5"
          onClick={() => void overview.refetch()}
          disabled={overview.isFetching}
        >
          <RefreshCw size={13} aria-hidden />
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (overview.isPending || !model) return <FleetRoomSkeleton />;

  return (
    <FleetOperationsRoom
      model={model}
      instances={instances.data?.instances ?? []}
      instancesGeneratedAt={instances.data?.generatedAt}
      instancesTruncated={instances.data?.truncated}
      instancesLoading={instances.isPending}
      instancesUnavailable={instances.isError}
      now={now}
      refreshing={overview.isFetching || instances.isFetching}
      refreshFailed={overview.isRefetchError}
      onRefresh={() => {
        void overview.refetch();
        void instances.refetch();
      }}
    />
  );
}

function FleetRoomSkeleton() {
  const { t } = useOperationsCopy();

  return (
    <div className="space-y-4" role="status" aria-label={t("fleetLoading")}>
      <Skeleton className="h-72 w-full rounded-none" />
      <Skeleton className="h-28 w-full rounded-none" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-none" />
        <Skeleton className="h-80 rounded-none" />
      </div>
    </div>
  );
}
