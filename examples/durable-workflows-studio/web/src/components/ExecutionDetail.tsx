import { useState } from "react";
import type {
  StudioExecutionDetail,
  StudioWorkflow,
} from "../../../src/shared/types.js";
import { isLiveStatus } from "../../../src/shared/statuses.js";
import {
  formatDateTime,
  formatDuration,
  timeAgo,
  truncateId,
} from "../format.js";
import { JsonView } from "./JsonView.js";
import { ExecutionRelations } from "./ExecutionRelations.js";
import { SignalHistory } from "./SignalHistory.js";
import { StatusPill } from "./StatusPill.js";
import { Timeline } from "./Timeline.js";

type Tab = "timeline" | "relations" | "signals" | "data" | "audit";

const AUDIT_LABELS: Record<string, string> = {
  execution_status_changed: "Status changed",
  step_completed: "Step completed",
  sleep_scheduled: "Sleep scheduled",
  sleep_completed: "Sleep completed",
  signal_waiting: "Waiting for signal",
  signal_delivered: "Signal delivered",
  signal_timed_out: "Signal timed out",
  emit_published: "Event emitted",
  switch_evaluated: "Branch evaluated",
  note: "Note",
};

export function ExecutionDetail({
  detail,
  workflow,
  now,
  onSignal,
  onCancel,
  onRetry,
  onPause,
  onResume,
  onRestart,
  onForceFail,
  onSkip,
  onEdit,
  onExport,
  onOpenExecution,
}: {
  detail: StudioExecutionDetail;
  workflow: StudioWorkflow | undefined;
  now: number;
  onSignal: (signalId?: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onForceFail: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onExport: () => void;
  onOpenExecution: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("timeline");
  const live = isLiveStatus(detail.status);
  const paused = detail.status === "paused";
  const canRetry =
    detail.status === "failed" ||
    detail.status === "cancelled" ||
    detail.status === "compensation_failed";
  const canRestart = !live || paused;
  const waitingSignals = detail.timeline.filter(
    (node) => node.state === "waiting" && node.wait?.signalId,
  );

  async function copyId() {
    try {
      await navigator.clipboard.writeText(detail.id);
    } catch {
      // Selection still works where clipboard is unavailable.
    }
  }

  return (
    <div className="detail">
      <header className="detail-head">
        <div className="detail-title-row">
          <div>
            <h2>{detail.workflowTitle}</h2>
            <button
              type="button"
              className="id-copy"
              onClick={copyId}
              title="Copy execution id"
            >
              <code>{truncateId(detail.id, 16)}</code>
            </button>
          </div>
          <StatusPill status={detail.status} />
        </div>
        {detail.position ? <p className="detail-position">{detail.position}</p> : null}
        <div className="detail-facts">
          <span>
            Started <strong>{formatDateTime(detail.createdAt)}</strong>
          </span>
          <span>
            Duration{" "}
            <strong>{formatDuration(detail.createdAt, detail.completedAt)}</strong>
          </span>
          <span>
            Attempt <strong>#{detail.attempt}</strong>
          </span>
          <span>
            Updated <strong>{timeAgo(detail.updatedAt, now)}</strong>
          </span>
        </div>
        <div className="detail-actions">
          {(workflow?.signals.length ?? 0) > 0 ? (
            <button
              type="button"
              className="btn primary"
              disabled={!live}
              onClick={() => onSignal(waitingSignals[0]?.wait?.signalId)}
              title={
                waitingSignals.length === 0
                  ? "Deliver or queue a signal"
                  : `Send ${waitingSignals[0]?.wait?.signalId}`
              }
            >
              Send signal
            </button>
          ) : null}
          {canRetry ? (
            <button type="button" className="btn ghost" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {live && !paused ? (
            <button type="button" className="btn ghost" onClick={onPause}>
              Pause
            </button>
          ) : null}
          {paused ? (
            <button type="button" className="btn ghost" onClick={onResume}>
              Resume
            </button>
          ) : null}
          {canRestart ? (
            <button type="button" className="btn ghost" onClick={onRestart}>
              Restart
            </button>
          ) : null}
          <details className="operator-menu">
            <summary className="btn ghost">Operate ▾</summary>
            <div className="operator-menu-popover">
              <button type="button" onClick={onSkip}>Skip step</button>
              <button type="button" onClick={onEdit}>Edit state</button>
              <button type="button" onClick={onExport}>Export JSON</button>
              <span className="operator-menu-rule" />
              <button type="button" disabled={!live} onClick={onCancel}>
                Cancel execution
              </button>
              <button
                type="button"
                className="danger-text"
                disabled={!live}
                onClick={onForceFail}
              >
                Force fail
              </button>
            </div>
          </details>
        </div>
        {detail.error ? (
          <div className="error-banner">
            <strong>
              Failed{detail.error.stepId ? ` at ${detail.error.stepId}` : ""}:
            </strong>{" "}
            {detail.error.message}
          </div>
        ) : null}
      </header>

      <nav className="tabs" aria-label="Execution views">
        {(["timeline", "relations", "signals", "data", "audit"] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            className={`tab${tab === name ? " active" : ""}`}
            onClick={() => setTab(name)}
          >
            {name === "timeline" ? `Timeline · ${detail.timeline.length}` : null}
            {name === "relations"
              ? `Tree · ${detail.relations.children.length}`
              : null}
            {name === "signals"
              ? `Signals · ${detail.signals.reduce((total, journal) => total + journal.history.length, 0)}`
              : null}
            {name === "data" ? "Data" : null}
            {name === "audit" ? `Audit · ${detail.audit.length}` : null}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === "timeline" ? (
          <Timeline
            nodes={detail.timeline}
            edges={detail.edges}
            now={now}
            onSignal={onSignal}
          />
        ) : null}
        {tab === "relations" ? (
          <ExecutionRelations
            detail={detail}
            now={now}
            onOpen={onOpenExecution}
          />
        ) : null}
        {tab === "signals" ? (
          <SignalHistory journals={detail.signals} />
        ) : null}
        {tab === "data" ? (
          <div className="data-tab">
            <section>
              <h3>Input</h3>
              <JsonView value={detail.input} label="input" />
            </section>
            <section>
              <h3>Result</h3>
              {detail.result === null || detail.result === undefined ? (
                <p className="muted">No result yet — the workflow is still running.</p>
              ) : (
                <JsonView value={detail.result} label="result" />
              )}
            </section>
            <section>
              <h3>Workflow state</h3>
              {detail.state === null ? (
                <p className="muted">No workflow state recorded — the workflow has not set state yet.</p>
              ) : (
                <>
                  <p className="muted">Updated {formatDateTime(detail.state.updatedAt)}</p>
                  <JsonView value={detail.state.state} label="state" />
                </>
              )}
            </section>
            {detail.error?.stack ? (
              <section>
                <h3>Error stack</h3>
                <pre className="stack">{detail.error.stack}</pre>
              </section>
            ) : null}
            {workflow ? (
              <section>
                <h3>Workflow</h3>
                <p className="muted">{workflow.description}</p>
              </section>
            ) : null}
          </div>
        ) : null}
        {tab === "audit" ? (
          <ol className="audit-list">
            {detail.audit.length === 0 ? (
              <p className="muted">No audit entries recorded.</p>
            ) : null}
            {[...detail.audit].reverse().map((entry) => (
              <li key={entry.id} className="audit-row">
                <div className="audit-top">
                  <span className="audit-kind">
                    {AUDIT_LABELS[entry.kind] ?? entry.kind}
                  </span>
                  <span className="audit-time">
                    {formatDateTime(entry.at)}
                  </span>
                </div>
                <JsonView value={entry.detail} collapsed label="detail" />
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
