import type { WaitForExecutionOptions } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { createExecutionWaitCurrent, setExecutionCurrent } from "../current";
import { withExecutionWaitLock } from "../executionWaiters";
import { durableExecutionInvariantError } from "../../../../errors";
import { attemptExecutionWaitHop } from "./DurableContext.waitForExecutionHop";
import { createExecutionStepId } from "./DurableContext.waitForExecutionState";
import type {
  WaitForExecutionOutcome,
  WriteExecutionWaitCurrent,
} from "./DurableContext.waitForExecutionTypes";

export type { WaitForExecutionOutcome };

export async function waitForExecutionDurably<TResult>(params: {
  store: IDurableStore;
  executionId: string;
  targetExecutionId: string;
  expectedWorkflowKey: string;
  assertCanContinue: () => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  options?: WaitForExecutionOptions;
}): Promise<TResult | WaitForExecutionOutcome<TResult>> {
  await params.assertCanContinue();

  if (params.executionId === params.targetExecutionId) {
    return durableExecutionInvariantError.throw({
      message:
        `Cannot wait for execution '${params.targetExecutionId}': ` +
        "an execution cannot wait for itself because it would deadlock.",
    });
  }

  const hasTimeout = params.options?.timeoutMs !== undefined;
  const stepId = createExecutionStepId(
    params.targetExecutionId,
    params.options,
  );
  params.assertUniqueStepId(stepId);

  const writeExecutionWaitCurrent: WriteExecutionWaitCurrent = async (
    options,
  ): Promise<void> =>
    await setExecutionCurrent(
      params.store,
      params.executionId,
      createExecutionWaitCurrent({
        stepId,
        targetExecutionId: params.targetExecutionId,
        targetWorkflowKey: params.expectedWorkflowKey,
        timeoutMs: options.timeoutMs,
        timeoutAtMs: options.timeoutAtMs,
        timerId: options.timerId,
        startedAt: options.startedAt,
      }),
    );

  // Follow the continuation chain hop by hop, holding only one wait lock at a
  // time: each hop either settles on a live tip or reports the successor to
  // follow, so no waiter is ever orphaned on a finished run.
  let tipExecutionId = params.targetExecutionId;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(tipExecutionId)) {
      return durableExecutionInvariantError.throw({
        message: `Continuation chain for execution '${params.targetExecutionId}' is cyclic at '${tipExecutionId}'.`,
      });
    }
    visited.add(tipExecutionId);

    const outcome = await withExecutionWaitLock({
      store: params.store,
      targetExecutionId: tipExecutionId,
      fn: async () =>
        await attemptExecutionWaitHop<TResult>({
          store: params.store,
          executionId: params.executionId,
          targetExecutionId: params.targetExecutionId,
          tipExecutionId,
          expectedWorkflowKey: params.expectedWorkflowKey,
          stepId,
          hasTimeout,
          options: params.options,
          writeExecutionWaitCurrent,
        }),
    });

    if (outcome.kind === "done") {
      return outcome.value;
    }
    tipExecutionId = outcome.follow;
  }
}
