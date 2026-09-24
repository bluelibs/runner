import type { WorkflowState } from "../core/types";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

export async function getWorkflowState<TState = unknown>(
  runtime: RedisStoreRuntime,
  executionId: string,
): Promise<WorkflowState<TState> | null> {
  const data = runtime.parseRedisString(
    await runtime.redis.get(runtime.workflowStateKey(executionId)),
  );
  return data
    ? (runtime.serializer.parse(data) as WorkflowState<TState>)
    : null;
}

export async function saveWorkflowState(
  runtime: RedisStoreRuntime,
  state: WorkflowState,
): Promise<void> {
  await runtime.redis.set(
    runtime.workflowStateKey(state.executionId),
    runtime.serializer.stringify(state),
  );
}
