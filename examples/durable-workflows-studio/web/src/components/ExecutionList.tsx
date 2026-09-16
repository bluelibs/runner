import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EXECUTION_STATUS_META } from "../../../src/shared/statuses.js";
import type { StudioExecutionSummary } from "../../../src/shared/types.js";
import { timeAgo, truncateId } from "../format.js";

export function ExecutionList({
  executions,
  selectedId,
  onSelect,
  now,
  hasMore = false,
  loading = false,
  loadingMore = false,
  onLoadMore,
  loadedCount = executions.length,
  filtered = false,
  startOffset = 0,
  hasPrevious = false,
  onLoadPrevious,
  error,
  onRefresh,
}: {
  executions: StudioExecutionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
  hasMore?: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  loadedCount?: number;
  filtered?: boolean;
  startOffset?: number;
  hasPrevious?: boolean;
  onLoadPrevious?: () => void;
  error?: string | null;
  onRefresh?: () => void;
}) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousOffset = useRef(startOffset);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);
  const rowHeight = 58;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const end = Math.min(
    executions.length,
    start + Math.ceil(height / rowHeight) + 10,
  );
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    root.scrollTop = Math.max(
      0,
      root.scrollTop - (startOffset - previousOffset.current) * rowHeight,
    );
    previousOffset.current = startOffset;
    setScrollTop(root.scrollTop);
  }, [startOffset]);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setHeight(root.clientHeight));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loadingMore || !onLoadMore || error) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { root: target.closest(".exec-scroll"), rootMargin: "160px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore, error]);

  return (
    <div
      className="exec-scroll"
      ref={scrollRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {hasPrevious ? (
        <button
          className="load-more-btn"
          disabled={loadingMore}
          onClick={onLoadPrevious}
        >
          Load newer runs
        </button>
      ) : null}
      {executions.length === 0 ? (
        <div className="empty-list">
          <p className="empty-title">
            {loading
              ? "Loading executions…"
              : filtered
                ? "No matching executions"
                : "No executions yet"}
          </p>
          <p className="empty-sub">
            {filtered
              ? hasMore
                ? "Searching older pages as you scroll."
                : "Try a broader search or remove a filter."
              : "Start a workflow to watch it move through steps, sleeps and signals."}
          </p>
        </div>
      ) : (
        <ul className="exec-list">
          <li
            aria-hidden="true"
            style={{ height: start * rowHeight, flexShrink: 0 }}
          />
          {executions.slice(start, end).map((execution) => {
            const meta = EXECUTION_STATUS_META[execution.status];
            return (
              <li
                key={execution.id}
                style={{ height: rowHeight, flexShrink: 0 }}
              >
                <button
                  type="button"
                  className={`exec-row${execution.id === selectedId ? " selected" : ""}`}
                  onClick={() => onSelect(execution.id)}
                >
                  <span className={`status-dot tone-${meta.tone}`} />
                  <span className="exec-main">
                    <span className="exec-title">
                      {execution.workflowTitle}
                    </span>
                    <span className="exec-sub">
                      <code>{truncateId(execution.id, 10)}</code>
                      {" · "}
                      {execution.position ?? meta.label}
                    </span>
                  </span>
                  <span className="exec-time">
                    {timeAgo(execution.updatedAt, now)}
                  </span>
                </button>
              </li>
            );
          })}
          <li
            aria-hidden="true"
            style={{
              height: (executions.length - end) * rowHeight,
              flexShrink: 0,
            }}
          />
        </ul>
      )}
      <div ref={loadMoreRef} className="exec-load-zone" aria-live="polite">
        {error ? (
          <button
            type="button"
            className="load-more-btn"
            onClick={hasMore ? onLoadMore : onRefresh}
          >
            {error} · Retry
          </button>
        ) : null}
        {hasMore ? (
          <button
            type="button"
            className="load-more-btn"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "Loading older runs…" : "Load older runs"}
          </button>
        ) : loadedCount > 0 ? (
          <span>End of results · {startOffset + loadedCount} runs</span>
        ) : null}
      </div>
    </div>
  );
}
