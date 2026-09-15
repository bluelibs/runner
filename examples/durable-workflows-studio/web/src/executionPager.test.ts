import { describe, expect, it, vi } from "vitest";
import {
  ExecutionPager,
  EXECUTION_CACHE_PAGES,
  EXECUTION_PAGE_SIZE,
} from "./executionPager.js";
import type {
  StudioExecutionPage,
  StudioExecutionSummary,
} from "../../src/shared/types.js";
import type { ExecutionFilters } from "./api.js";

const row = (index: number): StudioExecutionSummary => ({
  id: String(index),
  workflowKey: "workflow",
  workflowTitle: "Workflow",
  status: "completed",
  attempt: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  position: "completed",
});

describe("progressive execution pager", () => {
  it("reaches result 100,000 while retaining at most 400 summaries and can page back", async () => {
    const listExecutionPage = vi.fn(
      async (query: ExecutionFilters = {}): Promise<StudioExecutionPage> => {
        const start = Number(query.cursor ?? 0);
        const end = Math.min(start + query.limit!, 100000);
        return {
          executions: Array.from({ length: end - start }, (_, index) =>
            row(start + index),
          ),
          nextCursor: end < 100000 ? String(end) : null,
          hasMore: end < 100000,
          nextOffset: null,
          total: 100000,
        };
      },
    );
    const error = vi.fn();
    const pager = new ExecutionPager(
      { listExecutionPage },
      { status: "completed" },
      () => {},
      error,
    );
    await pager.loadMore();
    await pager.loadPrevious();
    expect(listExecutionPage).not.toHaveBeenCalled();
    await pager.refreshHead();
    do {
      await pager.loadMore();
      expect(pager.snapshot.executions.length).toBeLessThanOrEqual(
        EXECUTION_CACHE_PAGES * EXECUTION_PAGE_SIZE,
      );
    } while (pager.snapshot.hasMore);
    expect(pager.snapshot.executions.at(-1)?.id).toBe("99999");
    expect(pager.snapshot.startOffset).toBe(99600);
    await pager.poll();
    expect(listExecutionPage).toHaveBeenCalledTimes(2500);
    await pager.loadPrevious();
    expect(pager.snapshot.startOffset).toBe(99560);
    await pager.loadMore();
    expect(pager.snapshot.executions.at(-1)?.id).toBe("99999");
    await pager.refreshHead();
    expect(pager.snapshot.startOffset).toBe(0);
    await pager.poll();
    expect(pager.snapshot.executions[0].id).toBe("0");
    expect(error).not.toHaveBeenCalled();
  });

  it("deduplicates in-flight requests, ignores disposed responses, and permits retry", async () => {
    let resolve!: (page: StudioExecutionPage) => void;
    const listExecutionPage = vi.fn(
      () =>
        new Promise<StudioExecutionPage>((done) => {
          resolve = done;
        }),
    );
    const changed = vi.fn();
    const error = vi.fn();
    const pager = new ExecutionPager({ listExecutionPage }, {}, changed, error);
    const pending = pager.refreshHead();
    await pager.refreshHead();
    expect(listExecutionPage).toHaveBeenCalledTimes(1);
    pager.dispose();
    changed.mockClear();
    resolve({
      executions: [row(0)],
      hasMore: false,
      nextOffset: null,
      nextCursor: null,
    });
    await pending;
    await pager.loadMore();
    expect(changed).not.toHaveBeenCalled();
    const retryApi = {
      listExecutionPage: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({
          executions: [row(0)],
          nextCursor: "same",
          hasMore: true,
          nextOffset: null,
        }),
    };
    const retry = new ExecutionPager(retryApi, {}, () => {}, error);
    await retry.refreshHead();
    expect(error).toHaveBeenCalledTimes(1);
    await retry.refreshHead();
    await retry.loadMore();
    expect(error).toHaveBeenLastCalledWith(
      new Error("Execution cursor did not advance."),
    );
  });
});
