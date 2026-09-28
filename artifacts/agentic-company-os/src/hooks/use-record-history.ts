import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useDocumentVisible } from "./use-page-activity";
import {
  fetchRecordPage,
  RecordPager,
  type HistoryRecord,
  type HistorySource,
} from "../lib/record-history";

export function useRecordHistory<T extends HistoryRecord>(
  source: HistorySource,
  {
    limit = 200,
    enabled = true,
    interval = 5000,
  }: { limit?: number; enabled?: boolean; interval?: number } = {},
) {
  const visible = useDocumentVisible();
  const scope = JSON.stringify(source);
  const pager = useMemo(
    () =>
      new RecordPager<T>((beforeId, signal) =>
        fetchRecordPage<T>(
          JSON.parse(scope) as HistorySource,
          limit,
          beforeId,
          signal,
        ),
      ),
    [scope, limit],
  );
  const state = useSyncExternalStore(
    pager.subscribe,
    pager.getSnapshot,
    pager.getSnapshot,
  );
  useEffect(() => {
    if (!enabled || !visible) return;
    void pager.start();
    const timer = setInterval(pager.poll, interval);
    return () => {
      clearInterval(timer);
      pager.stop();
    };
  }, [pager, enabled, visible, interval]);
  return {
    ...state,
    pager,
    limit,
    data: state.page?.records,
    dataUpdatedAt: state.page?.capturedAt ?? 0,
    isLoading: enabled && !state.page && !state.error,
    isFetching: state.pending,
    isError: state.error,
    refetch: pager.retry,
  };
}
