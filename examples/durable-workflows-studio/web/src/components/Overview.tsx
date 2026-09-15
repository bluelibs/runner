import { useMemo, useState, type RefObject } from "react";
import { EXECUTION_STATUS_META } from "../../../src/shared/statuses.js";
import type {
  StudioExecutionSummary,
  StudioSchedule,
  StudioWorkflow,
} from "../../../src/shared/types.js";
import {
  buildDashboardModel,
  filterDashboardExecutions,
  type DashboardStatusFilter,
} from "../dashboard.js";
import { timeAgo, truncateId } from "../format.js";
import { ActivityChart, StatusMixChart } from "./DashboardCharts.js";
import { StatusPill } from "./StatusPill.js";

const FILTERS: Array<{ id: DashboardStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "sleeping", label: "Waiting" },
  { id: "failed", label: "Failed" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

export function Overview({
  executions,
  schedules,
  stuck,
  workflows,
  workflowFilter,
  onWorkflowFilter,
  onOpenExecution,
  onStart,
  searchRef,
  refreshedAt,
  now,
  totalExecutionCount,
  hasMoreExecutions = false,
}: {
  executions: StudioExecutionSummary[];
  schedules: StudioSchedule[];
  stuck: StudioExecutionSummary[];
  workflows: StudioWorkflow[];
  workflowFilter: string | null;
  onWorkflowFilter: (workflowKey: string | null) => void;
  onOpenExecution: (executionId: string) => void;
  onStart: () => void;
  searchRef: RefObject<HTMLInputElement>;
  refreshedAt: number;
  now: number;
  totalExecutionCount?: number;
  hasMoreExecutions?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<DashboardStatusFilter>("all");
  const filtered = useMemo(
    () =>
      filterDashboardExecutions(executions, {
        query,
        status,
        workflowKey: workflowFilter,
      }),
    [executions, query, status, workflowFilter],
  );
  const filteredIds = useMemo(
    () => new Set(filtered.map((execution) => execution.id)),
    [filtered],
  );
  const visibleWorkflows = workflowFilter
    ? workflows.filter((workflow) => workflow.key === workflowFilter)
    : workflows;
  const visibleSchedules = workflowFilter
    ? schedules.filter((schedule) => schedule.workflowKey === workflowFilter)
    : schedules;
  const model = useMemo(
    () =>
      buildDashboardModel({
        executions: filtered,
        schedules: visibleSchedules,
        stuck: stuck.filter((execution) => filteredIds.has(execution.id)),
        workflows: visibleWorkflows,
        nowMs: now,
      }),
    [filtered, filteredIds, now, stuck, visibleSchedules, visibleWorkflows],
  );
  const attentionCount = model.metrics.failed + model.metrics.stuck;

  return (
    <div className="overview">
      <header className="overview-head">
        <div>
          <p className="overview-kicker"><span /> Runtime intelligence</p>
          <h1>See what changed. Know what matters.</h1>
          <p className="overview-intro">
            Live workflow health, recent movement and operator signals in one view.
          </p>
        </div>
        <div className="overview-head-actions">
          <span className="sync-state">
            <i /> Updated {timeAgo(new Date(refreshedAt).toISOString(), now)}
          </span>
          <button type="button" className="btn primary" onClick={onStart}>
            + Start execution
          </button>
        </div>
      </header>

      <section className="overview-controls" aria-label="Dashboard filters">
        <label className="overview-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ID, workflow, status or current step…"
            aria-label="Search dashboard"
          />
          <kbd>/</kbd>
        </label>
        <select
          className="overview-select"
          value={workflowFilter ?? ""}
          onChange={(event) => onWorkflowFilter(event.target.value || null)}
          aria-label="Filter by workflow"
        >
          <option value="">All workflows</option>
          {workflows.map((workflow) => (
            <option key={workflow.key} value={workflow.key}>{workflow.title}</option>
          ))}
        </select>
        <div className="overview-filter-row" role="tablist" aria-label="Status filter">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={status === filter.id}
              className={status === filter.id ? "active" : ""}
              onClick={() => setStatus(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      <section className="metric-grid" aria-label="Key metrics">
        <Metric
          label={totalExecutionCount === undefined ? "Executions loaded" : "Total executions"}
          value={totalExecutionCount ?? `${model.metrics.total}${hasMoreExecutions ? "+" : ""}`}
          detail={totalExecutionCount === undefined
            ? hasMoreExecutions ? "older runs available" : `${model.metrics.live} live now`
            : `${model.metrics.total} loaded · ${model.metrics.live} live`}
          tone="blue"
        />
        <Metric label="Success rate" value={`${model.metrics.successRate}%`} detail="of loaded finished runs" tone="green" />
        <Metric label="Needs attention" value={attentionCount} detail={`${model.metrics.failed} failed · ${model.metrics.stuck} stuck`} tone={attentionCount > 0 ? "red" : "green"} />
        <Metric label="Active schedules" value={model.metrics.activeSchedules} detail={`${model.metrics.pausedSchedules} paused`} tone="amber" />
      </section>

      <section className="insight-strip" aria-label="Insights">
        {model.insights.map((insight) => (
          <article key={insight.label} className={`insight-card ${insight.tone}`}>
            <p>{insight.label}</p>
            <strong>{insight.title}</strong>
            <span>{insight.detail}</span>
          </article>
        ))}
      </section>

      <section className="dashboard-chart-grid">
        <article className="dashboard-panel activity-panel">
          <PanelHead title="Execution activity" detail="Created in the last 6 hours" />
          <ActivityChart activity={model.activity} />
        </article>
        <article className="dashboard-panel">
          <PanelHead title="Status mix" detail="Current loaded view" />
          <StatusMixChart statusMix={model.statusMix} />
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="dashboard-panel latest-panel">
          <PanelHead
            title="Latest activity"
            detail={`${filtered.length} matching loaded execution${filtered.length === 1 ? "" : "s"}`}
          />
          <div className="latest-list">
            {filtered.slice(0, 7).map((execution) => (
              <button key={execution.id} type="button" className="latest-row" onClick={() => onOpenExecution(execution.id)}>
                <span className="latest-identity">
                  <StatusPill status={execution.status} />
                  <span><strong>{execution.workflowTitle}</strong><code>{truncateId(execution.id, 18)}</code></span>
                </span>
                <span className="latest-position">{execution.position ?? EXECUTION_STATUS_META[execution.status].label}</span>
                <time>{timeAgo(execution.updatedAt, now)}</time>
                <span className="latest-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="overview-empty"><strong>No matching executions</strong><span>Try a broader search or remove a filter.</span></div>
            ) : null}
          </div>
        </article>

        <article className="dashboard-panel workflow-panel">
          <PanelHead title="Workflow health" detail="Across loaded finished runs" />
          <div className="workflow-health-list">
            {model.workflowHealth.map((workflow) => (
              <button key={workflow.key} type="button" onClick={() => onWorkflowFilter(workflow.key)}>
                <span><strong>{workflow.title}</strong><em>{workflow.total} total · {workflow.live} live</em></span>
                <span className="health-value">{workflow.successRate}%</span>
                <span className="health-track"><i style={{ width: `${workflow.successRate}%` }} /></span>
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: string }) {
  return <article className={`metric-card ${tone}`}><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>;
}

function PanelHead({ title, detail }: { title: string; detail: string }) {
  return <header className="panel-head"><div><h2>{title}</h2><p>{detail}</p></div></header>;
}
