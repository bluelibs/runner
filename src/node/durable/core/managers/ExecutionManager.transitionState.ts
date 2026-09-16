import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus, type Execution } from "../types";

export async function readLatestAttemptSnapshot(
  store: IDurableStore,
  execution: Execution<unknown, unknown>,
  expectedStatus: ExecutionStatus,
): Promise<Execution<unknown, unknown> | null> {
  const latest = await store.getExecution(execution.id);
  return latest?.status === expectedStatus &&
    latest.attempt === execution.attempt
    ? latest
    : null;
}

export function attachCurrentStepToError(
  error: NonNullable<Execution["error"]>,
  execution: Execution<unknown, unknown>,
): NonNullable<Execution["error"]> {
  if (error.stepId !== undefined || execution.current === undefined) {
    return error;
  }
  return { ...error, stepId: execution.current.stepId };
}
