import type {
  StudioExecutionDetail,
  StudioExecutionSummary,
} from "../../../src/shared/types.js";
import { timeAgo, truncateId } from "../format.js";
import { StatusPill } from "./StatusPill.js";

function RelationCard({
  execution,
  role,
  now,
  onOpen,
}: {
  execution: StudioExecutionSummary;
  role: string;
  now: number;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="relation-card"
      onClick={() => onOpen(execution.id)}
    >
      <span className="relation-card-top">
        <span className="relation-role">{role}</span>
        <StatusPill status={execution.status} />
      </span>
      <strong>{execution.workflowTitle}</strong>
      <code>{truncateId(execution.id, 20)}</code>
      <span className="relation-position">
        {execution.position ?? `Updated ${timeAgo(execution.updatedAt, now)}`}
      </span>
    </button>
  );
}

export function ExecutionRelations({
  detail,
  now,
  onOpen,
}: {
  detail: StudioExecutionDetail;
  now: number;
  onOpen: (id: string) => void;
}) {
  const current: StudioExecutionSummary = {
    id: detail.id,
    workflowKey: detail.workflowKey,
    workflowTitle: detail.workflowTitle,
    status: detail.status,
    attempt: detail.attempt,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    completedAt: detail.completedAt,
    position: detail.position,
    ...(detail.parentExecutionId
      ? { parentExecutionId: detail.parentExecutionId }
      : {}),
  };

  const lineage: Array<{ role: string; id: string }> = [
    ...(detail.continuedFromExecutionId
      ? [{ role: "Continued from", id: detail.continuedFromExecutionId }]
      : []),
    ...(detail.continuedAsExecutionId
      ? [{ role: "Continued as", id: detail.continuedAsExecutionId }]
      : []),
    ...(detail.restartedFromExecutionId
      ? [{ role: "Restarted from", id: detail.restartedFromExecutionId }]
      : []),
    ...(detail.restartedAsExecutionId
      ? [{ role: "Restarted as", id: detail.restartedAsExecutionId }]
      : []),
  ];

  return (
    <section className="relations-view" aria-label="Execution relationships">
      <div className="inspection-summary">
        <div>
          <span className="eyebrow">Execution tree</span>
          <h3>Follow work across workflow boundaries</h3>
        </div>
        <span className="inspection-count">
          {detail.relations.children.length} direct children
        </span>
      </div>
      <div className="relation-tree">
        {detail.relations.parent ? (
          <>
            <RelationCard
              execution={detail.relations.parent}
              role="Parent"
              now={now}
              onOpen={onOpen}
            />
            <span className="relation-line" aria-hidden="true" />
          </>
        ) : null}
        <div className="relation-current">
          <RelationCard execution={current} role="Selected" now={now} onOpen={onOpen} />
        </div>
        {detail.relations.children.length > 0 ? (
          <>
            <span className="relation-line" aria-hidden="true" />
            <div className="relation-children">
              {detail.relations.children.map((child, index) => (
                <RelationCard
                  key={child.id}
                  execution={child}
                  role={`Child ${index + 1}`}
                  now={now}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </>
        ) : detail.relations.parent === null ? (
          <p className="inspection-empty">
            This execution is a root with no children. Start the portfolio demo
            to inspect a fan-out tree.
          </p>
        ) : null}
      </div>
      {lineage.length > 0 ? (
        <div className="lineage-block">
          <span className="eyebrow">Lifecycle lineage</span>
          <div className="lineage-links">
            {lineage.map((link) => (
              <button
                key={link.role}
                type="button"
                className="lineage-link"
                onClick={() => onOpen(link.id)}
              >
                <span className="relation-role">{link.role}</span>
                <code>{truncateId(link.id, 20)}</code>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
