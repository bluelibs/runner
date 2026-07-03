import type { IDurableStore } from "../interfaces/store";
import type { AuditLogger } from "./AuditLogger";
import { ExecutionStatus, isExecutionTerminal, type Execution } from "../types";
import { sleepMs } from "../utils";
import { durableExecutionInvariantError } from "../../../../errors";
import { resolveCancellationReason } from "./ExecutionManager.cancellation";
import { logExecutionStatusChange } from "./ExecutionManager.persistence";

/**
 * Shared dependencies for the terminal-transition flows (cancellation and
 * delivery-exhaustion), which both drive an execution to a final state under a
 * bounded optimistic-concurrency retry loop.
 */
export interface ExecutionTerminalDeps {
  store: IDurableStore;
  auditLogger: AuditLogger;
  abortActiveAttempt: (executionId: string, reason: string) => void;
  publishLiveCancellationRequested: (
    executionId: string,
    reason: string,
  ) => Promise<void>;
  notifyFinished: (execution: Execution) => Promise<void>;
}

/**
 * Cancels an execution. A `Running` execution is moved to `Cancelling` (so its
 * active attempt can stop cooperatively and broadcast a live cancellation),
 * while any other non-terminal state is finalised straight to `Cancelled`.
 * Retries on optimistic-concurrency conflicts and throws if it cannot converge.
 */
export async function cancelExecution(
  deps: ExecutionTerminalDeps,
  executionId: string,
  reason?: string,
): Promise<void> {
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const execution = await deps.store.getExecution(executionId);
    if (!execution) return;
    if (isExecutionTerminal(execution.status)) return;
    if (execution.status === ExecutionStatus.Cancelling) return;

    const now = new Date();
    const cancellationReason = resolveCancellationReason(execution, reason);
    const nextExecution: Execution =
      execution.status === ExecutionStatus.Running
        ? {
            ...execution,
            status: ExecutionStatus.Cancelling,
            cancelRequestedAt: execution.cancelRequestedAt ?? now,
            error: { message: cancellationReason },
            updatedAt: now,
          }
        : {
            ...execution,
            status: ExecutionStatus.Cancelled,
            current: undefined,
            cancelRequestedAt: execution.cancelRequestedAt ?? now,
            cancelledAt: now,
            completedAt: now,
            error: { message: cancellationReason },
            updatedAt: now,
          };
    const saved = await deps.store.saveExecutionIfStatus(nextExecution, [
      execution.status,
    ]);
    if (!saved) {
      if (attempt < maxAttempts) {
        await sleepMs(Math.min(2 ** (attempt - 1), 25));
      }
      continue;
    }

    deps.abortActiveAttempt(executionId, cancellationReason);

    if (execution.status === ExecutionStatus.Running) {
      await deps.publishLiveCancellationRequested(
        executionId,
        cancellationReason,
      );
      return;
    }

    await logExecutionStatusChange(deps.auditLogger, {
      execution,
      from: execution.status,
      to: ExecutionStatus.Cancelled,
      reason: "cancelled",
    });
    await deps.notifyFinished(nextExecution);
    return;
  }

  const latestExecution = await deps.store.getExecution(executionId);
  if (!latestExecution || isExecutionTerminal(latestExecution.status)) {
    return;
  }

  durableExecutionInvariantError.throw({
    message: `Failed to cancel durable execution '${executionId}' after ${maxAttempts} attempts due to concurrent state changes.`,
  });
}

/**
 * Fails an execution because the queue exhausted its delivery attempts. Retries
 * on optimistic-concurrency conflicts and throws if it cannot converge.
 */
export async function failExecutionDeliveryExhausted(
  deps: ExecutionTerminalDeps,
  executionId: string,
  details: {
    messageId: string;
    attempts: number;
    maxAttempts: number;
    errorMessage: string;
  },
): Promise<void> {
  const message =
    `Queue delivery attempts exhausted for execution ${executionId} ` +
    `(message ${details.messageId}, attempts ${details.attempts}/${details.maxAttempts}): ` +
    details.errorMessage;
  const maxTransitionAttempts = 5;

  for (
    let transitionAttempt = 1;
    transitionAttempt <= maxTransitionAttempts;
    transitionAttempt += 1
  ) {
    const execution = await deps.store.getExecution(executionId);
    if (!execution) return;
    if (isExecutionTerminal(execution.status)) return;

    const completedAt = new Date();
    const failedExecution: Execution = {
      ...execution,
      status: ExecutionStatus.Failed,
      current: undefined,
      error: { message },
      completedAt,
      updatedAt: completedAt,
    };
    const failed = await deps.store.saveExecutionIfStatus(failedExecution, [
      execution.status,
    ]);
    if (!failed) {
      if (transitionAttempt < maxTransitionAttempts) {
        await sleepMs(Math.min(2 ** (transitionAttempt - 1), 25));
      }
      continue;
    }

    await logExecutionStatusChange(deps.auditLogger, {
      execution,
      from: execution.status,
      to: ExecutionStatus.Failed,
      reason: "delivery_attempts_exhausted",
    });
    await deps.notifyFinished(failedExecution);
    return;
  }

  const latestExecution = await deps.store.getExecution(executionId);
  if (!latestExecution || isExecutionTerminal(latestExecution.status)) {
    return;
  }

  durableExecutionInvariantError.throw({
    message: `Failed to transition durable execution '${executionId}' to failed after ${maxTransitionAttempts} attempts while handling exhausted queue delivery.`,
  });
}
