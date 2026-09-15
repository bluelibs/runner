import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioExecutionSummary } from "../../src/shared/types.js";
import type { StudioApi } from "./api.js";

export const EXECUTION_PAGE_SIZE = 40;

function newestFirst(
  left: StudioExecutionSummary,
  right: StudioExecutionSummary,
): number {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

/** Merges refreshed and paged rows by storage identity. */
export function mergeExecutions(
  current: StudioExecutionSummary[],
  incoming: StudioExecutionSummary[],
): StudioExecutionSummary[] {
  const byId = new Map(current.map((execution) => [execution.id, execution]));
  for (const execution of incoming) byId.set(execution.id, execution);
  return [...byId.values()].sort(newestFirst);
}

export interface ExecutionFeed {
  executions: StudioExecutionSummary[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  refreshHead: () => Promise<void>;
}

/**
 * Keeps a bounded live head while older pages are appended on demand.
 * New head rows advance the stored offset so polling cannot make the next
 * page skip older executions.
 */
export function useExecutionFeed({
  api,
  paused,
  onError,
}: {
  api: StudioApi;
  paused: boolean;
  onError: (error: unknown) => void;
}): ExecutionFeed {
  const [executions, setExecutions] = useState<StudioExecutionSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const executionsRef = useRef<StudioExecutionSummary[]>([]);
  const nextOffsetRef = useRef(0);
  const headRequestInFlight = useRef(false);
  const pageRequestInFlight = useRef(false);
  const generationRef = useRef(0);

  const replaceFromStart = useCallback(async () => {
    if (paused || headRequestInFlight.current) return;
    const generation = generationRef.current;
    headRequestInFlight.current = true;
    setLoading(true);
    try {
      const page = await api.listExecutionPage({
        limit: EXECUTION_PAGE_SIZE,
        offset: 0,
      });
      if (generation !== generationRef.current) return;
      executionsRef.current = page.executions;
      nextOffsetRef.current = page.nextOffset ?? page.executions.length;
      setExecutions(page.executions);
      setHasMore(page.hasMore);
    } catch (error) {
      if (generation === generationRef.current) onError(error);
    } finally {
      headRequestInFlight.current = false;
      if (generation === generationRef.current) setLoading(false);
    }
  }, [api, onError, paused]);

  const refreshHead = useCallback(async () => {
    if (paused || headRequestInFlight.current) return;
    const generation = generationRef.current;
    headRequestInFlight.current = true;
    try {
      const page = await api.listExecutionPage({
        limit: EXECUTION_PAGE_SIZE,
        offset: 0,
      });
      if (generation !== generationRef.current) return;
      const current = executionsRef.current;
      if (current.length === 0) {
        executionsRef.current = page.executions;
        nextOffsetRef.current = page.nextOffset ?? page.executions.length;
        setExecutions(page.executions);
        setHasMore(page.hasMore);
        return;
      }

      const currentIds = new Set(current.map((execution) => execution.id));
      const overlaps = page.executions.some((execution) =>
        currentIds.has(execution.id),
      );
      if (page.hasMore && !overlaps) {
        // More than one head page arrived between polls. Restart from the new
        // head rather than risk silently skipping the unseen middle.
        executionsRef.current = page.executions;
        nextOffsetRef.current = page.nextOffset ?? page.executions.length;
        setExecutions(page.executions);
        setHasMore(true);
        return;
      }

      const newHeadCount = page.executions.filter(
        (execution) => !currentIds.has(execution.id),
      ).length;
      const merged = mergeExecutions(current, page.executions);
      executionsRef.current = merged;
      nextOffsetRef.current += newHeadCount;
      setExecutions(merged);
    } catch (error) {
      if (generation === generationRef.current) onError(error);
    } finally {
      headRequestInFlight.current = false;
    }
  }, [api, onError, paused]);

  const loadMore = useCallback(async () => {
    if (paused || pageRequestInFlight.current || !hasMore) return;
    const generation = generationRef.current;
    pageRequestInFlight.current = true;
    setLoadingMore(true);
    try {
      const page = await api.listExecutionPage({
        limit: EXECUTION_PAGE_SIZE,
        offset: nextOffsetRef.current,
      });
      if (generation !== generationRef.current) return;
      const merged = mergeExecutions(executionsRef.current, page.executions);
      executionsRef.current = merged;
      nextOffsetRef.current = page.nextOffset ?? nextOffsetRef.current;
      setExecutions(merged);
      setHasMore(page.hasMore);
    } catch (error) {
      if (generation === generationRef.current) onError(error);
    } finally {
      pageRequestInFlight.current = false;
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }, [api, hasMore, onError, paused]);

  useEffect(() => {
    generationRef.current += 1;
    executionsRef.current = [];
    nextOffsetRef.current = 0;
    setExecutions([]);
    setHasMore(false);
    if (paused) return;
    void replaceFromStart();
    const timer = window.setInterval(() => void refreshHead(), 2_500);
    return () => {
      generationRef.current += 1;
      window.clearInterval(timer);
    };
  }, [paused, refreshHead, replaceFromStart]);

  return {
    executions,
    hasMore,
    loading,
    loadingMore,
    loadMore,
    refreshHead,
  };
}
