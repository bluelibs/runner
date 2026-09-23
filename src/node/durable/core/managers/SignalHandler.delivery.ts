import type { IDurableStore } from "../interfaces/store";
import type { ITask } from "../../../../types/task";
import type { Logger } from "../../../../models/Logger";
import {
  type DurableSignalRecord,
  ExecutionStatus,
  isExecutionTerminal,
} from "../types";
import { getDeclaredDurableWorkflowSignalIds } from "../../tags/durableWorkflow.tag";
import { shouldPersistStableSignalId, parseSignalState } from "../utils";
import { clearExecutionCurrentIfSuspendedOnStep } from "../current";
import {
  commitDurableWaitCompletion,
  runBestEffortCleanup,
} from "../waiterCore";
import { durableExecutionInvariantError } from "../../../../errors";

/** Collaborators needed to deliver one signal record to one chain hop. */
export interface SignalHopDeps {
  store: IDurableStore;
  logger: Pick<Logger, "warn">;
  resolveTask: (
    workflowKey: string,
  ) => ITask<any, Promise<any>, any, any, any, any> | undefined;
}

/**
 * What happened at one hop of the continuation chain:
 * - `dropped`: nothing to deliver to (missing, terminal, or broken chain)
 * - `follow`: the hop continued; retry on its successor
 * - `delivered`: completed a waiter or buffered on this hop
 * - `stranded`: buffered, but the hop continued meanwhile, so the record sits
 *   on a closed run and must be handed to the chain again
 */
export type SignalHopOutcome =
  | { kind: "dropped" }
  | { kind: "follow"; nextExecutionId: string }
  | { kind: "delivered"; auditStepId: string; shouldResume: boolean }
  | { kind: "stranded" };

const MAX_COMMIT_CONFLICTS = 10;

function inspectSignalWaiterState(params: {
  signalId: string;
  result: unknown;
}): { kind: "stale" } | { kind: "waiting"; timerId?: string } {
  const state = parseSignalState(params.result);
  if (!state) return { kind: "stale" };
  if (state.signalId !== undefined && state.signalId !== params.signalId) {
    return { kind: "stale" };
  }
  if (state.state !== "waiting") return { kind: "stale" };
  return { kind: "waiting", timerId: state.timerId };
}

async function warnBestEffort(
  deps: SignalHopDeps,
  message: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.logger.warn(message, details);
  } catch {
    // Observability stays best-effort; the delivery outcome is the contract.
  }
}

async function clearSignalWaitCurrentBestEffort(
  deps: SignalHopDeps,
  params: { executionId: string; stepId: string; signalId: string },
): Promise<void> {
  try {
    await clearExecutionCurrentIfSuspendedOnStep(
      deps.store,
      params.executionId,
      { stepId: params.stepId, kinds: ["waitForSignal"] },
    );
  } catch (error) {
    await warnBestEffort(
      deps,
      "Durable waitForSignal current cleanup failed; resuming execution anyway.",
      { ...params, error },
    );
  }
}

async function commitDeliveredSignal(
  store: IDurableStore,
  params: {
    executionId: string;
    signalId: string;
    stepId: string;
    completedSignalState: Record<string, unknown>;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  },
): Promise<boolean> {
  const stepResult = {
    executionId: params.executionId,
    stepId: params.stepId,
    result: params.completedSignalState,
    completedAt: new Date(),
  };

  return await commitDurableWaitCompletion({
    store,
    stepResult,
    timerId: params.timerId,
    commitAtomically: store.commitSignalDelivery
      ? async () =>
          await store.commitSignalDelivery!({
            executionId: params.executionId,
            signalId: params.signalId,
            stepId: params.stepId,
            stepResult,
            signalRecord: params.signalRecord,
            timerId: params.timerId,
          })
      : undefined,
    onFallbackCommitted: async () => {
      await runBestEffortCleanup(() =>
        store.appendSignalRecord(
          params.executionId,
          params.signalId,
          params.signalRecord,
        ),
      );
      await runBestEffortCleanup(() =>
        store.deleteSignalWaiter(
          params.executionId,
          params.signalId,
          params.stepId,
        ),
      );
    },
  });
}

/** Completes the earliest live waiter; resolves its step id, or null if none. */
async function completeNextWaiter(
  deps: SignalHopDeps,
  executionId: string,
  signalId: string,
  record: DurableSignalRecord,
): Promise<string | null> {
  let commitConflictCount = 0;

  for (;;) {
    const waiter = await deps.store.peekNextSignalWaiter(executionId, signalId);
    if (!waiter) return null;

    const waitingStep = await deps.store.getStepResult(
      executionId,
      waiter.stepId,
    );
    const waiterState = waitingStep
      ? inspectSignalWaiterState({ signalId, result: waitingStep.result })
      : ({ kind: "stale" } as const);
    if (waiterState.kind === "stale") {
      await deps.store.deleteSignalWaiter(executionId, signalId, waiter.stepId);
      continue;
    }

    const completedSignalState = shouldPersistStableSignalId(
      waiter.stepId,
      signalId,
    )
      ? { state: "completed" as const, signalId, payload: record.payload }
      : { state: "completed" as const, payload: record.payload };
    const committed = await commitDeliveredSignal(deps.store, {
      executionId,
      signalId,
      stepId: waiter.stepId,
      completedSignalState,
      signalRecord: record,
      timerId: waiterState.timerId ?? waiter.timerId,
    });
    if (!committed) {
      commitConflictCount += 1;
      if (commitConflictCount >= MAX_COMMIT_CONFLICTS) {
        return durableExecutionInvariantError.throw({
          message: `Signal '${signalId}' delivery for execution '${executionId}' exceeded the atomic commit retry budget.`,
        });
      }
      continue;
    }
    await clearSignalWaitCurrentBestEffort(deps, {
      executionId,
      signalId,
      stepId: waiter.stepId,
    });
    return waiter.stepId;
  }
}

/**
 * Delivers one signal record to one hop. Callers hold that hop's signal lock,
 * so the follow decision and the delivery are atomic against other signals.
 */
export async function deliverSignalToHop(
  deps: SignalHopDeps,
  params: {
    requestedExecutionId: string;
    hopExecutionId: string;
    signalId: string;
    record: DurableSignalRecord;
  },
): Promise<SignalHopOutcome> {
  const { hopExecutionId, signalId } = params;
  const execution = await deps.store.getExecution(hopExecutionId);
  const brokenChain = (reason: string) =>
    warnBestEffort(
      deps,
      "Durable signal dropped: continuation chain is broken.",
      {
        executionId: params.requestedExecutionId,
        tipExecutionId: hopExecutionId,
        reason,
      },
    );
  if (!execution) {
    // A missing address is a quiet no-op by contract, but a missing
    // successor mid-chain means corrupt lineage worth surfacing.
    if (hopExecutionId !== params.requestedExecutionId) {
      await brokenChain("successor record is missing");
    }
    return { kind: "dropped" };
  }
  if (execution.status === ExecutionStatus.ContinuedAsNew) {
    if (!execution.continuedAsExecutionId) {
      await brokenChain("continued_as_new without a successor link");
      return { kind: "dropped" };
    }
    return {
      kind: "follow",
      nextExecutionId: execution.continuedAsExecutionId,
    };
  }
  if (isExecutionTerminal(execution.status)) return { kind: "dropped" };

  const task = deps.resolveTask(execution.workflowKey);
  const declaredSignalIds = task
    ? getDeclaredDurableWorkflowSignalIds(task)
    : null;
  if (declaredSignalIds !== null && !declaredSignalIds.has(signalId)) {
    return durableExecutionInvariantError.throw({
      message: `Signal '${signalId}' is not declared in durableWorkflow.signals for workflow '${execution.workflowKey}'.`,
    });
  }

  const completedStepId = await completeNextWaiter(
    deps,
    hopExecutionId,
    signalId,
    params.record,
  );
  if (completedStepId !== null) {
    return {
      kind: "delivered",
      auditStepId: completedStepId,
      shouldResume: true,
    };
  }

  await deps.store.bufferSignalRecord(hopExecutionId, signalId, params.record);
  // Continue-as-new commits without this lock and hands over the backlog it
  // sees; a buffer that lands just after that commit would sit on the closed
  // run forever, so re-check and let the caller hand it to the chain again.
  const afterBuffer = await deps.store.getExecution(hopExecutionId);
  if (afterBuffer?.status === ExecutionStatus.ContinuedAsNew) {
    return { kind: "stranded" };
  }
  return {
    kind: "delivered",
    auditStepId: `__signal:${signalId}`,
    shouldResume: false,
  };
}
