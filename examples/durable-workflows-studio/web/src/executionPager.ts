import type {
  StudioExecutionPage,
  StudioExecutionSummary,
} from "../../src/shared/types.js";
import type { ExecutionFilters, StudioApi } from "./api.js";

export const EXECUTION_PAGE_SIZE = 40;
export const EXECUTION_CACHE_PAGES = 10;

export interface PagerSnapshot {
  executions: StudioExecutionSummary[];
  startOffset: number;
  totalCount: number | null;
  hasMore: boolean;
  hasPrevious: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

/** Keeps ten pages, not an ever-growing copy of the database, in browser memory. */
export class ExecutionPager {
  private pages: Array<{ cursor?: string; page: StudioExecutionPage }> = [];
  private previous: Array<string | undefined> = [];
  private active = true;
  private busy = false;
  private failure: string | null = null;
  snapshot: PagerSnapshot = {
    executions: [],
    startOffset: 0,
    totalCount: null,
    hasMore: false,
    hasPrevious: false,
    loading: true,
    loadingMore: false,
    error: null,
  };

  constructor(
    private readonly api: Pick<StudioApi, "listExecutionPage">,
    private readonly filters: ExecutionFilters,
    private readonly changed: (snapshot: PagerSnapshot) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  dispose(): void {
    this.active = false;
  }

  private publish(loading = false): void {
    if (!this.active) return;
    const last = this.pages[this.pages.length - 1]?.page;
    this.snapshot = {
      executions: this.pages.flatMap(({ page }) => page.executions),
      startOffset: this.previous.length * EXECUTION_PAGE_SIZE,
      totalCount: last?.total ?? null,
      hasMore: last?.nextCursor != null,
      hasPrevious: this.previous.length > 0,
      loading: loading && !this.pages.length,
      loadingMore: loading && this.pages.length > 0,
      error: this.failure,
    };
    this.changed(this.snapshot);
  }

  private async request(
    direction: "head" | "next" | "previous",
  ): Promise<void> {
    if (!this.active || this.busy) return;
    const last = this.pages[this.pages.length - 1];
    if (direction === "next" && !last?.page.nextCursor) return;
    if (direction === "previous" && !this.previous.length) return;
    const cursor =
      direction === "next"
        ? last!.page.nextCursor!
        : direction === "previous"
          ? this.previous[this.previous.length - 1]
          : undefined;
    this.busy = true;
    this.failure = null;
    this.publish(true);
    try {
      const page = await this.api.listExecutionPage({
        ...this.filters,
        limit: EXECUTION_PAGE_SIZE,
        cursor,
      });
      if (!this.active) return;
      if (page.nextCursor && page.nextCursor === cursor)
        throw new Error("Execution cursor did not advance.");
      if (direction === "head") {
        this.pages = [{ cursor, page }];
        this.previous = [];
      } else if (direction === "next") {
        this.pages.push({ cursor, page });
        if (this.pages.length > EXECUTION_CACHE_PAGES)
          this.previous.push(this.pages.shift()!.cursor);
      } else {
        this.previous.pop();
        this.pages.unshift({ cursor, page });
        this.pages.length = Math.min(this.pages.length, EXECUTION_CACHE_PAGES);
      }
    } catch (error) {
      if (this.active) {
        this.failure =
          error instanceof Error ? error.message : "Could not load executions.";
        this.onError(error);
      }
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  loadMore = (): Promise<void> => this.request("next");
  loadPrevious = (): Promise<void> => this.request("previous");
  refreshHead = (): Promise<void> => this.request("head");
  // Freeze history while browsing it: polling must not shift or replace the scroll window.
  poll = (): Promise<void> =>
    this.pages.length <= 1 && !this.previous.length
      ? this.request("head")
      : Promise.resolve();
}
