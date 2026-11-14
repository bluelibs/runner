import { isDeepStrictEqual } from "node:util";
import type { DurableCheckpointBranch } from "../../core/interfaces/history";
import type { MemoryStoreRuntime } from "./runtime";

/** The source comparison and every branch record commit without an asynchronous gap. */
export async function createCheckpointExecution(
  runtime: MemoryStoreRuntime,
  branch: DurableCheckpointBranch,
): Promise<boolean> {
  runtime.assertOwnership();
  if (
    runtime.executions.has(branch.execution.id) ||
    !isDeepStrictEqual(
      runtime.executions.get(branch.expected.id),
      branch.expected,
    )
  )
    return false;
  runtime.executions.set(
    branch.execution.id,
    structuredClone(branch.execution),
  );
  runtime.stepResults.set(
    branch.execution.id,
    new Map(branch.steps.map((step) => [step.stepId, structuredClone(step)])),
  );
  runtime.histories.set(branch.execution.id, {
    sequence: Math.max(
      ...branch.history.flatMap((entry) => [
        entry.startedOrder,
        entry.completedOrder ?? 0,
      ]),
    ),
    entries: new Map(
      structuredClone(branch.history).map((entry) => [entry.stepId, entry]),
    ),
  });
  if (branch.state)
    runtime.workflowStates.set(branch.execution.id, {
      executionId: branch.execution.id,
      state: structuredClone(branch.state.value),
      updatedAt: branch.execution.createdAt,
    });
  await runtime.persistDurableMutation();
  return true;
}
