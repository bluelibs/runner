import type { StudioTone } from "../../../src/shared/statuses.js";
import {
  EXECUTION_STATUS_META,
  NODE_STATE_META,
} from "../../../src/shared/statuses.js";
import type {
  StudioExecutionStatus,
  StudioNodeState,
} from "../../../src/shared/types.js";

export function StatusPill({
  status,
  showDot = true,
}: {
  status: StudioExecutionStatus;
  showDot?: boolean;
}) {
  const meta = EXECUTION_STATUS_META[status] ?? {
    label: status,
    tone: "neutral" as StudioTone,
  };
  const live = status === "running" || status === "sleeping" || status === "retrying";
  return (
    <span className={`pill tone-${meta.tone}`}>
      {showDot ? <span aria-hidden="true" className={`pill-dot${live ? " pulse" : ""}`} /> : null}
      {meta.label}
    </span>
  );
}

export function NodeStateTag({ state }: { state: StudioNodeState }) {
  const meta = NODE_STATE_META[state];
  return <span className={`tag tone-${meta.tone}`}>{meta.label}</span>;
}
