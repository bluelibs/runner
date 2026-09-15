import { useState } from "react";
import { useWorkflowFeed } from "../workflowFeed.js";
import type { StudioWorkflow } from "../../../src/shared/types.js";
import { WorkflowNavigation } from "./WorkflowNavigation.js";
import {
  WORKFLOW_SEARCH_THRESHOLD,
} from "../workflowCatalog.js";

export type StudioView = "overview" | "executions" | "schedules";

export function Sidebar({
  workflows,
  view,
  onView,
  workflowFilter,
  onWorkflowFilter,
  counts,
  totalExecutionCount,
  hasMoreExecutions,
  stuckCount,
  onRecover,
  recovering,
  demo,
  authed,
  onLogout,
}: {
  workflows: StudioWorkflow[];
  view: StudioView;
  onView: (view: StudioView) => void;
  workflowFilter: string | null;
  onWorkflowFilter: (key: string | null) => void;
  counts: { total: number; live: number; failed: number };
  totalExecutionCount?: number;
  hasMoreExecutions?: boolean;
  stuckCount: number;
  onRecover: () => void;
  recovering: boolean;
  demo: boolean;
  authed?: boolean;
  onLogout?: () => void;
}) {
  const [workflowQuery, setWorkflowQuery] = useState("");
  const feed = useWorkflowFeed(workflows, workflowQuery);
  const visibleWorkflows = feed.workflows;
  const searchable = feed.total > WORKFLOW_SEARCH_THRESHOLD;
  const displayedExecutionCount = totalExecutionCount ?? counts.total;
  const executionCountIsLowerBound =
    totalExecutionCount === undefined && hasMoreExecutions;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 32 32">
            <rect x="4" y="4" width="10" height="10" rx="2.5" fill="#5e6ad2" />
            <rect x="18" y="4" width="10" height="10" rx="5" fill="#38bdf8" />
            <rect x="4" y="18" width="10" height="10" rx="5" fill="#34d399" />
            <rect x="18" y="18" width="10" height="10" rx="2.5" fill="#f59e0b" />
          </svg>
        </span>
        <span className="brand-text">
          <strong>Durable Studio</strong>
          <em>{demo ? "demo data" : "live runtime"}</em>
        </span>
        <span className={`conn-dot${demo ? " demo" : ""}`} title={demo ? "Demo mode" : "Connected"} />
      </div>

      <nav className="side-nav" aria-label="Views">
        <button
          type="button"
          className={`side-link${view === "overview" ? " active" : ""}`}
          onClick={() => onView("overview")}
        >
          <span className="side-link-label">Overview</span>
          <span className="live-nav-mark" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`side-link${view === "executions" ? " active" : ""}`}
          onClick={() => onView("executions")}
        >
          <span className="side-link-label">Executions</span>
          <span
            className="count"
            title={
              hasMoreExecutions
                ? totalExecutionCount === undefined
                  ? `${counts.total} executions loaded; older runs are available`
                  : `${counts.total} of ${totalExecutionCount} executions loaded`
                : `${displayedExecutionCount} executions`
            }
          >
            {displayedExecutionCount}{executionCountIsLowerBound ? "+" : ""}
          </span>
        </button>
        <button
          type="button"
          className={`side-link${view === "schedules" ? " active" : ""}`}
          onClick={() => onView("schedules")}
        >
          <span className="side-link-label">Schedules</span>
        </button>
      </nav>

      <div className="side-stats">
        <div className="stat">
          <span className="stat-num">{counts.live}</span>
          <span className="stat-label">live loaded</span>
        </div>
        <div className="stat">
          <span className={`stat-num${counts.failed > 0 ? " bad" : ""}`}>
            {counts.failed}
          </span>
          <span className="stat-label">failed loaded</span>
        </div>
        <div className="stat">
          <span className={`stat-num${stuckCount > 0 ? " warn" : ""}`}>
            {stuckCount}
          </span>
          <span className="stat-label">stuck loaded</span>
        </div>
      </div>

      <div className="side-section workflows-section">
        <div className="side-heading-row">
          <p className="side-heading">Workflows</p>
          {searchable ? (
            <span
              aria-label={`Showing ${visibleWorkflows.length} of ${feed.total} workflows`}
            >
              {visibleWorkflows.length}/{feed.total}
            </span>
          ) : null}
        </div>
        {searchable ? (
          <label className="side-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={workflowQuery}
              onChange={(event) => setWorkflowQuery(event.target.value)}
              placeholder="Find workflow…"
              aria-label="Search workflows"
            />
            {workflowQuery ? (
              <button
                type="button"
                onClick={() => setWorkflowQuery("")}
                aria-label="Clear workflow search"
              >
                ×
              </button>
            ) : null}
          </label>
        ) : null}
        <button
          type="button"
          className={`side-link small${workflowFilter === null ? " active" : ""}`}
          onClick={() => onWorkflowFilter(null)}
        >
          All workflows
        </button>
        <WorkflowNavigation
          key={workflowQuery}
          workflows={visibleWorkflows}
          selectedKey={workflowFilter}
          onSelect={onWorkflowFilter}
          query={workflowQuery}
          hasMore={feed.nextCursor !== null && !feed.error}
          loading={feed.loading}
          onLoadMore={feed.loadMore}
          offset={feed.offset}
          onLoadPrevious={feed.loadPrevious}
        />
        {feed.error ? <button className="load-more-btn" onClick={feed.retry}>{feed.error} Retry</button> : null}
      </div>

      <div className="side-foot">
        <button
          type="button"
          className="btn ghost small full"
          disabled={recovering}
          onClick={onRecover}
          title="Resume orphaned executions"
        >
          {recovering ? "Recovering…" : "Recover orphans"}
        </button>
        {authed && onLogout ? (
          <button
            type="button"
            className="btn ghost small full"
            onClick={onLogout}
            title="Clear the admin token and lock the studio"
          >
            Log out
          </button>
        ) : null}
        {demo ? (
          <p className="demo-note">
            Demo mode simulates a runtime in your browser.{" "}
            <a href={window.location.pathname}>Use live data</a>
          </p>
        ) : (
          <p className="demo-note">
            <a href="?demo=1">Preview with demo data</a>
          </p>
        )}
      </div>
    </aside>
  );
}
