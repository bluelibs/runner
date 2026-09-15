import type { DurableExecutionState } from "@bluelibs/runner/node";
import type { StudioExecutionSummary } from "../shared/types.js";
import { EXECUTION_STATUS_META } from "../shared/statuses.js";
import { getWorkflow } from "../workflows/catalog.js";

/** List rows use persisted metadata only; steps and payloads belong to detail reads. */
export function toExecutionSummary(
  state: DurableExecutionState,
): StudioExecutionSummary {
  return {
    id: state.id,
    workflowKey: state.workflowKey,
    workflowTitle: getWorkflow(state.workflowKey)?.title ?? state.workflowKey,
    status: state.status,
    attempt: state.attempt,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
    completedAt: state.completedAt?.toISOString() ?? null,
    position:
      state.current?.stepId ?? EXECUTION_STATUS_META[state.status].label,
    ...(state.parentExecutionId
      ? { parentExecutionId: state.parentExecutionId }
      : {}),
  };
}
