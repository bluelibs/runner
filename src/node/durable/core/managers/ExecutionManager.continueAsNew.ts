import type { ContinueAsNewOptions } from "../interfaces/context";
import { ExecutionStatus, type Execution } from "../types";
import { createExecutionId } from "../utils";
import { durableLifecycleUnsupportedStoreCapabilityError } from "../../../../errors";
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

  const now = new Date();
  const successor: Execution = {
    id: createExecutionId(),
    workflowKey: latest.workflowKey,
    parentExecutionId: latest.parentExecutionId,
    input: params.nextInput,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: params.deps.persistence.maxAttempts,
    timeout: latest.timeout,
    continuedFromExecutionId: latest.id,
    createdAt: now,
    updatedAt: now,
  };

  // Carry state before the atomic commit: the save is an idempotent upsert,
  // so a commit failure only orphans a state record, never loses one.
  const carried: CarriedState =
    params.options?.state !== undefined
      ? { present: true, value: params.options.state }
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
  await kickoffWithFailsafe(params.deps.persistence, successor.id);
  await params.deps.notifyFinished(closedPrior);
}
