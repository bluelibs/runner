import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StudioWorkflow } from "../../../src/shared/types.js";

/** Virtualized catalog window; scrolling fetches the next server page. */
export function WorkflowNavigation({
  workflows,
  selectedKey,
  onSelect,
  query,
  hasMore = false,
  loading = false,
  onLoadMore,
  offset = 0,
  onLoadPrevious,
}: {
  workflows: StudioWorkflow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  query: string;
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
  offset?: number;
  onLoadPrevious?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const previousOffset = useRef(offset);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(500);
  const start = Math.max(0, Math.floor(top / 32) - 4);
  const end = Math.min(workflows.length, start + Math.ceil(height / 32) + 8);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    root.scrollTop = Math.max(
      0,
      root.scrollTop - (offset - previousOffset.current) * 32,
    );
    previousOffset.current = offset;
    setTop(root.scrollTop);
  }, [offset]);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setHeight(root.clientHeight));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !hasMore ||
      loading ||
      !sentinel ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore?.();
      },
      { root: scrollRef.current, rootMargin: "80px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);
  return (
    <div
      className="workflow-nav-list"
      ref={scrollRef}
      onScroll={(event) => setTop(event.currentTarget.scrollTop)}
    >
      {offset > 0 ? (
        <button
          className="load-more-btn"
          disabled={loading}
          onClick={onLoadPrevious}
        >
          Load previous workflows
        </button>
      ) : null}
      <div aria-hidden="true" style={{ height: start * 32, flexShrink: 0 }} />
      {workflows.slice(start, end).map((workflow) => (
        <button
          key={workflow.key}
          type="button"
          style={{ height: 32, minHeight: 32, flexShrink: 0 }}
          className={`side-link small${selectedKey === workflow.key ? " active" : ""}`}
          onClick={() => onSelect(workflow.key)}
          title={workflow.description}
        >
          <span className="side-link-label">{workflow.title}</span>
          <span className="side-cat">{workflow.category}</span>
        </button>
      ))}
      <div
        aria-hidden="true"
        style={{ height: (workflows.length - end) * 32, flexShrink: 0 }}
      />
      {workflows.length === 0 ? (
        <div className="side-search-empty">
          {loading
            ? "Loading workflows…"
            : `No workflows match “${query.trim()}”.`}
        </div>
      ) : null}
      {hasMore ? (
        <div className="workflow-load-zone" ref={sentinelRef}>
          <button
            type="button"
            className="load-more-btn"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? "Loading workflows…" : "Show more workflows"}
          </button>
          <span>{offset + workflows.length} workflows reached</span>
        </div>
      ) : null}
    </div>
  );
}
