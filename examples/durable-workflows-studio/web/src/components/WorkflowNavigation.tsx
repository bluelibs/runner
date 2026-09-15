import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioWorkflow } from "../../../src/shared/types.js";

const WORKFLOW_BATCH_SIZE = 20;

/** Reveals catalog matches as the operator scrolls, with a keyboard fallback. */
export function WorkflowNavigation({
  workflows,
  selectedKey,
  onSelect,
  query,
}: {
  workflows: StudioWorkflow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  query: string;
}) {
  const [visibleCount, setVisibleCount] = useState(WORKFLOW_BATCH_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = visibleCount < workflows.length;
  const showMore = useCallback(() => {
    setVisibleCount((count) => Math.min(count + WORKFLOW_BATCH_SIZE, workflows.length));
  }, [workflows.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore();
      },
      { root: scrollRef.current, rootMargin: "80px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, showMore, visibleCount]);

  return (
    <div className="workflow-nav-list" ref={scrollRef}>
      {workflows.slice(0, visibleCount).map((workflow) => (
        <button
          key={workflow.key}
          type="button"
          className={`side-link small${selectedKey === workflow.key ? " active" : ""}`}
          onClick={() => onSelect(workflow.key)}
          title={workflow.description}
        >
          <span className="side-link-label">{workflow.title}</span>
          <span className="side-cat">{workflow.category}</span>
        </button>
      ))}
      {workflows.length === 0 ? (
        <div className="side-search-empty">No workflows match “{query.trim()}”.</div>
      ) : null}
      {hasMore ? (
        <div className="workflow-load-zone" ref={sentinelRef}>
          <button type="button" className="load-more-btn" onClick={showMore}>
            Show more workflows
          </button>
          <span>{visibleCount} of {workflows.length} shown</span>
        </div>
      ) : null}
    </div>
  );
}
