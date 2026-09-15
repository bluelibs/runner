import { useEffect, useRef } from "react";
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
}) {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loadingMore || !onLoadMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { root: target.closest(".exec-scroll"), rootMargin: "160px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <div className="exec-scroll">
      {executions.length === 0 ? (
        <div className="empty-list">
          <p className="empty-title">
            {loading ? "Loading executions…" : filtered ? "No matches loaded" : "No executions yet"}
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
          {executions.map((execution) => {
            const meta = EXECUTION_STATUS_META[execution.status];
            return (
              <li key={execution.id}>
                <button
                  type="button"
                  className={`exec-row${execution.id === selectedId ? " selected" : ""}`}
                  onClick={() => onSelect(execution.id)}
                >
                  <span className={`status-dot tone-${meta.tone}`} />
                  <span className="exec-main">
                    <span className="exec-title">{execution.workflowTitle}</span>
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
        </ul>
      )}
      <div ref={loadMoreRef} className="exec-load-zone" aria-live="polite">
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
          <span>All {loadedCount} loaded runs are in view</span>
        ) : null}
      </div>
    </div>
  );
}
