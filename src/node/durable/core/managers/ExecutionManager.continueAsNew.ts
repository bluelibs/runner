import type { ContinueAsNewOptions } from "../interfaces/context";
import { ExecutionStatus, type Execution } from "../types";
import { createExecutionId } from "../utils";
import { transitionExecutionToFailed } from "./ExecutionManager.transitions";
import {
  durableContinueAsNewRejectedError,
  durableLifecycleUnsupportedStoreCapabilityError,
} from "../../../../errors";

/**
 * Default bound on continue-as-new hops per lineage. Traversals (waits,
 * signals, timers) walk the chain hop by hop, so an unbounded chain is a
 * slow-burn availability risk; bugs that chapter in a loop hit this instead
 * of growing forever. Override with `execution.maxContinuationDepth`.
 */
export const DEFAULT_MAX_CONTINUATION_DEPTH = 1000;
import { readLatestAttemptSnapshot } from "./ExecutionManager.transitionState";
import {
  kickoffWithFailsafe,
  logCreatedExecution,
  type ExecutionPersistenceDeps,
} from "./ExecutionManager.persistence";
import type { IDurableStore } from "../interfaces/store";

/**
 * Shared dependencies for the continue-as-new flow, which atomically closes
 * the prior run and creates/kicks its successor.
 */
export interface ExecutionContinueAsNewDeps {
  persistence: ExecutionPersistenceDeps;
  notifyFinished: (execution: Execution) => Promise<void>;
}

type StatusChangeCallback = (params: {
  execution: Execution<unknown, unknown>;
  from: ExecutionStatus | null;
  to: ExecutionStatus;
  reason: string;
}) => Promise<void>;

type FinalizeCancellationCallback = (
  execution: Execution<unknown, unknown>,
  canPersistOutcome?: () => Promise<boolean>,
) => Promise<boolean>;

type CarriedState = { present: false } | { present: true; value: unknown };

async function readCarriedState(
  store: IDurableStore,
  executionId: string,
): Promise<CarriedState> {
  if (!store.getWorkflowState) {
    // Stores without workflow state could never persist any, so there is
    // nothing to carry and no data loss in proceeding.
    return { present: false };
  }

  const record = await store.getWorkflowState(executionId);
  return record ? { present: true, value: record.state } : { present: false };
}

/**
 * Closes a running execution as `continued_as_new` and starts its successor
 * with the carried input (and, unless overridden, the carried workflow
 * state). The close-and-create commits atomically; a racing pause/cancel
 * resolves the commit to false and the continuation is dropped so the
 * operator's decision stands. Waiters and signals follow the forward link
 * to the live tip.
 */
export async function continueExecutionAsNew(params: {
  deps: ExecutionContinueAsNewDeps;
  runningExecution: Execution<unknown, unknown>;
  nextInput: unknown;
  options?: ContinueAsNewOptions;
  canPersistOutcome?: () => Promise<boolean>;
  logStatusChange: StatusChangeCallback;
  finalizeCancellation: FinalizeCancellationCallback;
}): Promise<void> {
  if (params.canPersistOutcome && !(await params.canPersistOutcome())) {
    return;
  }

  const store = params.deps.persistence.store;
  if (!store.createContinuedExecution) {
    return durableLifecycleUnsupportedStoreCapabilityError.throw({
      operation: "continue-as-new",
    });
  }

  const latest = await readLatestAttemptSnapshot(
    store,
    params.runningExecution,
    ExecutionStatus.Running,
  );
  if (!latest) {
    await params.finalizeCancellation(
      params.runningExecution,
      params.canPersistOutcome,
    );
    return;
  }

  const continuationDepth = (latest.continuationDepth ?? 0) + 1;
  const maxDepth =
    params.deps.persistence.maxContinuationDepth ??
    DEFAULT_MAX_CONTINUATION_DEPTH;
  if (continuationDepth > maxDepth) {
    // Fail terminally (instead of throwing past the attempt handler) so the
    // run never strands in `running`: waiters resolve with the rejection and
    // the operator sees a failed run with a clear reason. A racing
    // pause/cancel still wins via the compare-and-set.
    const rejection = durableContinueAsNewRejectedError.new({
      executionId: latest.id,
      reason: `continuation depth limit of ${maxDepth} exceeded`,
    });
    await transitionExecutionToFailed({
      store,
      execution: latest,
      from: ExecutionStatus.Running,
      reason: "continuation_depth_exceeded",
      error: { message: rejection.message },
      logStatusChange: params.logStatusChange,
      notifyFinished: params.deps.notifyFinished,
      finalizeCancellation: params.finalizeCancellation,
    });
    return;
  }

  const now = new Date();
  const successor: Execution = {
    id: createExecutionId(),
    workflowKey: latest.workflowKey,
    parentExecutionId: latest.parentExecutionId,
    input: params.nextInput,
    // Workflow code supplies the next input without a boundary check here;
    // the first worker that runs the successor validates it instead.
    inputNeedsValidation: true,
    continuationDepth,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: params.deps.persistence.maxAttempts,
    timeout: latest.timeout,
    continuedFromExecutionId: latest.id,
    createdAt: now,
    updatedAt: now,
  };

  // Carry state before the atomic commit: the save is an idempotent upsert,
  // so a commit failure only orphans a state record, never loses one. A
  // present `state` key (even `undefined`) overrides; only omitting it carries.
  const carried: CarriedState =
    params.options && "state" in params.options
      ? {
          present: params.options.state !== undefined,
          value: params.options.state,
        }
      : await readCarriedState(store, latest.id);
  if (carried.present) {
    if (!store.saveWorkflowState) {
      return durableLifecycleUnsupportedStoreCapabilityError.throw({
        operation: "save-workflow-state",
      });
    }
    await store.saveWorkflowState({
      executionId: successor.id,
      state: carried.value,
      updatedAt: now,
    });
  }

  const closedPrior: Execution = {
    ...latest,
    status: ExecutionStatus.ContinuedAsNew,
    current: undefined,
    continuedAsExecutionId: successor.id,
    completedAt: now,
    updatedAt: now,
  };
  const committed = await store.createContinuedExecution({
    priorExecution: closedPrior,
    successorExecution: successor,
  });
  if (!committed) {
    await params.finalizeCancellation(
      params.runningExecution,
      params.canPersistOutcome,
    );
    return;
  }

  await params.logStatusChange({
    execution: latest,
    from: ExecutionStatus.Running,
    to: ExecutionStatus.ContinuedAsNew,
    reason: "continued_as_new",
  });
  await logCreatedExecution(params.deps.persistence.auditLogger, successor);
  await params.deps.notifyFinished(closedPrior);
  // Move waiters onto the persisted successor before kickoff. In queue mode
  // an enqueue failure must not strand waiters forever on the now-terminal
  // prior run; in direct mode a parent can safely register on the pending tip.
  await kickoffWithFailsafe(params.deps.persistence, successor.id);
}
