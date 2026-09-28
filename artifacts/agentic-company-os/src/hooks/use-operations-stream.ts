import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOperationsOverviewQueryKey,
  getGetProjectOperationsQueryKey,
  type OperationsOverview,
  type ProjectOperationsSnapshot,
} from "@workspace/api-client-react";

import {
  createOperationsStreamClient,
  operationsStreamScopeKey,
  type OperationsStreamClient,
  type OperationsStreamScope,
  type OperationsStreamSnapshot,
} from "../lib/operations-event-stream";
import {
  chooseNewestOperationsSnapshot,
  operationsSnapshotMatchesScope,
} from "../lib/operations-snapshot-cache";

const DISABLED_SNAPSHOT: OperationsStreamSnapshot = Object.freeze({
  state: "disabled",
  lastEventId: null,
  lastEventAt: null,
  transportLastFrameAt: null,
  reconnectCount: 0,
});

const CONNECTING_SNAPSHOT: OperationsStreamSnapshot = Object.freeze({
  state: "connecting",
  lastEventId: null,
  lastEventAt: null,
  transportLastFrameAt: null,
  reconnectCount: 0,
});

export function useOperationsStream({
  scope,
  enabled = true,
}: {
  scope: OperationsStreamScope;
  enabled?: boolean;
}): OperationsStreamSnapshot {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<OperationsStreamClient | null>(null);
  const scopeKey = operationsStreamScopeKey(scope);
  const stableScope = useMemo<OperationsStreamScope>(
    () =>
      scope.scope === "project"
        ? { scope: "project", taskId: scope.taskId }
        : { scope: "global" },
    // scopeKey captures both the tag and the only supported scope identifier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey],
  );

  useEffect(() => {
    if (!enabled) {
      setClient(null);
      return;
    }
    const nextClient = createOperationsStreamClient({
      scope: stableScope,
      onSnapshot(snapshot, cursor) {
        if (!operationsSnapshotMatchesScope(snapshot, stableScope, cursor)) {
          return;
        }
        if (stableScope.scope === "project") {
          const projectSnapshot = snapshot as ProjectOperationsSnapshot;
          queryClient.setQueryData<ProjectOperationsSnapshot>(
            getGetProjectOperationsQueryKey(stableScope.taskId),
            (current) =>
              chooseNewestOperationsSnapshot(current, projectSnapshot),
          );
        } else {
          const overviewSnapshot = snapshot as OperationsOverview;
          queryClient.setQueryData<OperationsOverview>(
            getGetOperationsOverviewQueryKey(),
            (current) =>
              chooseNewestOperationsSnapshot(current, overviewSnapshot),
          );
        }
      },
    });
    setClient(nextClient);
    return () => nextClient.destroy();
  }, [enabled, queryClient, stableScope]);

  const subscribe = useCallback(
    (listener: () => void) =>
      enabled && client?.scopeKey === scopeKey
        ? client.subscribe(listener)
        : () => undefined,
    [client, enabled, scopeKey],
  );
  const getSnapshot = useCallback(
    () =>
      (enabled && client?.scopeKey === scopeKey
        ? client.getSnapshot()
        : undefined) ?? (enabled ? CONNECTING_SNAPSHOT : DISABLED_SNAPSHOT),
    [client, enabled, scopeKey],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
