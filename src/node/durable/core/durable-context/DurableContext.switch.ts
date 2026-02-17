import type { SwitchBranch } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { DurableAuditEntryKind, type DurableAuditEntryInput } from "../audit";
import { durableExecutionInvariantError } from "../../../../errors";

/**
 * Persisted result shape for a durable switch evaluation.
 *
 * `branchId` is the stable identifier of the matched branch.
 * `result` is the return value of the branch's `run()` function.
 */
interface SwitchStepResult<TResult> {
  branchId: string;
  result: TResult;
}

/**
 * Replay-safe switch implementation for durable workflows.
 *
 * On first execution the matchers are evaluated in order; the first matching
 * branch's `run()` is invoked and the `{ branchId, result }` pair is persisted.
 * On replay the cached branch result is returned immediately — matchers and
 * `run()` are never re-executed.
 */
export async function switchDurably<TValue, TResult>(params: {
  store: IDurableStore;
  executionId: string;
  assertNotCancelled: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  stepId: string;
  value: TValue;
  branches: SwitchBranch<TValue, TResult>[];
  defaultBranch?: Omit<SwitchBranch<TValue, TResult>, "match">;
}): Promise<TResult> {
  await params.assertNotCancelled();

  params.assertUniqueStepId(params.stepId);

  // Fast-path: check for cached result (replay)
  const cached = await params.store.getStepResult(
    params.executionId,
    params.stepId,
  );
  if (cached) {
    const persisted = cached.result as SwitchStepResult<TResult>;
    return persisted.result;
  }

  // First execution: evaluate matchers in order
  const startedAt = Date.now();
  let matchedBranch: {
    id: string;
    run: (v: TValue) => Promise<TResult>;
  } | null = null;

  for (const branch of params.branches) {
    if (branch.match(params.value)) {
      matchedBranch = { id: branch.id, run: branch.run };
      break;
    }
  }

  // Fall back to defaultBranch if no matcher hit
  if (!matchedBranch && params.defaultBranch) {
    matchedBranch = {
      id: params.defaultBranch.id,
      run: params.defaultBranch.run,
    };
  }

  if (!matchedBranch) {
    return durableExecutionInvariantError.throw({
      message: `Durable switch '${params.stepId}': no branch matched and no default provided`,
    });
  }

  const selectedBranch = matchedBranch;

  // Execute the selected branch
  const result = await selectedBranch.run(params.value);
  const durationMs = Date.now() - startedAt;

  // Persist the outcome for replay
  await params.store.saveStepResult({
    executionId: params.executionId,
    stepId: params.stepId,
    result: {
      branchId: selectedBranch.id,
      result,
    } satisfies SwitchStepResult<TResult>,
    completedAt: new Date(),
  });

  await params.appendAuditEntry({
    kind: DurableAuditEntryKind.SwitchEvaluated,
    stepId: params.stepId,
    branchId: selectedBranch.id,
    durationMs,
  });

  return result;
}
