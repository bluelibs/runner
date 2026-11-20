import { Match } from "../../../../tools/check";
import type { IDurableStore } from "../interfaces/store";

const retryState = Match.compile({
  workflowAttempt: Match.Range({ min: 1, integer: true }),
  count: Match.Range({ min: 1, integer: true }),
  nextAttemptAtMs: Match.Optional(Match.Range({ min: 0 })),
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

/** Restores both the consumed budget and an interrupted backoff deadline. */
export async function loadStepRetryState(
  params: StepRetryStateIdentity,
): Promise<{ count: number; nextAttemptAtMs?: number }> {
  const saved = await params.store.getStepResult(
    params.executionId,
    stateId(params.stepId),
  );
  if (!saved) return { count: 0 };
  const state = retryState.parse(saved.result);
  return state.workflowAttempt === params.workflowAttempt
    ? state
    : { count: 0 };
}

/** Journals retry consumption independently of the callback's eventual completed result. */
export async function saveStepRetryCount(
  params: StepRetryStateIdentity & { count: number; nextAttemptAtMs?: number },
): Promise<void> {
  await params.store.saveStepResult({
    executionId: params.executionId,
    stepId: stateId(params.stepId),
    result: {
      workflowAttempt: params.workflowAttempt,
      count: params.count,
      ...(params.nextAttemptAtMs === undefined
        ? {}
        : { nextAttemptAtMs: params.nextAttemptAtMs }),
    },
    completedAt: new Date(),
  });
}
