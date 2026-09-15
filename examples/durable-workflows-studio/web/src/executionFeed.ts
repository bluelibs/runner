import { useEffect, useRef, useState } from "react";
import type { StudioExecutionSummary } from "../../src/shared/types.js";
import type { ExecutionFilters, StudioApi } from "./api.js";
import { ExecutionPager, type PagerSnapshot } from "./executionPager.js";
export { EXECUTION_PAGE_SIZE } from "./executionPager.js";

/** Merges summaries by exact storage identity in canonical listing order. */
export function mergeExecutions(
  current: StudioExecutionSummary[],
  incoming: StudioExecutionSummary[],
): StudioExecutionSummary[] {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/** Query changes dispose the old pager, including any late in-flight responses. */
export function useExecutionFeed({
  api,
  paused,
  onError,
  workflowKey,
  status,
  executionId,
}: {
  api: StudioApi;
  paused: boolean;
  onError: (error: unknown) => void;
} & ExecutionFilters) {
  const [snapshot, setSnapshot] = useState<PagerSnapshot>({
    executions: [],
    startOffset: 0,
    totalCount: null,
    hasMore: false,
    hasPrevious: false,
    loading: true,
    loadingMore: false,
    error: null,
  });
  const pagerRef = useRef<ExecutionPager>();
  useEffect(() => {
    const pager = new ExecutionPager(
      api,
      { workflowKey, status, executionId },
      setSnapshot,
      onError,
    );
    pagerRef.current = pager;
    setSnapshot(pager.snapshot);
    if (paused) return () => pager.dispose();
    const debounce = window.setTimeout(
      () => void pager.refreshHead(),
      executionId ? 250 : 0,
    );
    const timer = window.setInterval(() => void pager.poll(), 2500);
    return () => {
      pager.dispose();
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [api, paused, onError, workflowKey, status, executionId]);
  const actions = useRef({
    loadMore: async () => {
      await pagerRef.current?.loadMore();
    },
    loadPrevious: async () => {
      await pagerRef.current?.loadPrevious();
    },
    refreshHead: async () => {
      await pagerRef.current?.refreshHead();
    },
  });
  return { ...snapshot, ...actions.current };
}
