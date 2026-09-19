import type { WorkflowState } from "../../core/types";
import { cloneWorkflowState } from "./shared";
import type { MemoryStoreRuntime } from "./runtime";

export async function getWorkflowState<TState = unknown>(
  runtime: MemoryStoreRuntime,
  executionId: string,
): Promise<WorkflowState<TState> | null> {
  const record = runtime.workflowStates.get(executionId);
  return record ? (cloneWorkflowState(record) as WorkflowState<TState>) : null;
}

export async function saveWorkflowState(
  runtime: MemoryStoreRuntime,
  state: WorkflowState,
): Promise<void> {
  runtime.workflowStates.set(state.executionId, cloneWorkflowState(state));
  await runtime.persistDurableMutation();
}
