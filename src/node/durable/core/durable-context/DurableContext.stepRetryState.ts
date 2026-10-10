import { Match } from "../../../../tools/check";
import type { IDurableStore } from "../interfaces/store";

const retryState = Match.compile({
  workflowAttempt: Match.Range({ min: 1, integer: true }),
  count: Match.Range({ min: 1, integer: true }),
});

interface StepRetryStateIdentity {
  store: IDurableStore;
  executionId: string;
  stepId: string;
  workflowAttempt: number;
}

function stateId(stepId: string): string {
  return `__step-retries:${JSON.stringify(stepId)}`;
}

/** Restores callback retries consumed before admission suspended this workflow attempt. */
export async function loadStepRetryCount(
  params: StepRetryStateIdentity,
): Promise<number> {
  const existing = await params.store.getStepResult(
    params.executionId,
    stateId(params.stepId),
  );
  if (!existing) return 0;
  const state = retryState.parse(existing.result);
  return state.workflowAttempt === params.workflowAttempt ? state.count : 0;
}

/** Journals retry consumption independently of the callback's eventual completed result. */
export async function saveStepRetryCount(
  params: StepRetryStateIdentity & { count: number },
): Promise<void> {
  await params.store.saveStepResult({
    executionId: params.executionId,
    stepId: stateId(params.stepId),
    result: { workflowAttempt: params.workflowAttempt, count: params.count },
    completedAt: new Date(),
  });
}
