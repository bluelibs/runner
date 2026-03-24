import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus, type Execution } from "../types";

export type ExecutionCancellationState = {
  reason: string;
};

export function resolveCancellationReason(
  execution: Execution<unknown, unknown>,
  requestedReason?: string,
): string {
  if (execution.cancelRequestedAt && execution.error?.message) {
    return execution.error.message;
  }

  return requestedReason ?? "Execution cancelled";
}

export function getCancellationState(
  execution: Execution<unknown, unknown> | null,
): ExecutionCancellationState | null {
  if (!execution) {
    return null;
  }

  if (
    execution.status !== ExecutionStatus.Cancelled &&
    execution.status !== ExecutionStatus.Cancelling &&
    execution.cancelRequestedAt === undefined
  ) {
    return null;
  }

  return {
    reason: resolveCancellationReason(execution),
  };
}

export function startExecutionCancellationWatcher(params: {
  executionId: string;
  controller: AbortController;
  store: IDurableStore;
  abortActiveAttempt: (executionId: string, reason: string) => void;
}): () => void {
  const intervalMs = 250;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNextPoll = () => {
    timer = setTimeout(() => {
      timer = null;
      if (stopped || params.controller.signal.aborted) {
        return;
      }

      void params.store
        .getExecution(params.executionId)
        .then((execution) => {
          const cancellationState = getCancellationState(execution);
          if (cancellationState) {
            params.abortActiveAttempt(
              params.executionId,
              cancellationState.reason,
            );
          }
        })
        .catch(() => {
          // Cancellation polling is best-effort; durable boundaries still re-check store state.
        })
        .finally(() => {
          if (!stopped && !params.controller.signal.aborted) {
            scheduleNextPoll();
          }
        });
    }, intervalMs);
    timer.unref?.();
  };

  scheduleNextPoll();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export async function finalizeCancellationIfRequested(params: {
  store: IDurableStore;
  executionId: string;
  canPersistOutcome?: () => Promise<boolean>;
  transitionToCancelled: (p: {
    execution: Execution<unknown, unknown>;
    reason: string;
    canPersistOutcome?: () => Promise<boolean>;
  }) => Promise<void>;
}): Promise<boolean> {
  const current = await params.store.getExecution(params.executionId);
  const cancellationState = getCancellationState(current);
  if (!cancellationState) {
    return false;
  }

  if (current?.status === ExecutionStatus.Cancelled) {
    return true;
  }

  await params.transitionToCancelled({
    execution: current!,
    reason: cancellationState.reason,
    canPersistOutcome: params.canPersistOutcome,
  });
  return true;
}

export async function transitionRunningExecutionToCancelled(params: {
  store: IDurableStore;
  execution: Execution<unknown, unknown>;
  reason: string;
  canPersistOutcome?: () => Promise<boolean>;
  logStatusChange: (p: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus | null;
    to: ExecutionStatus;
    reason: string;
  }) => Promise<void>;
  notifyFinished: (execution: Execution) => Promise<void>;
}): Promise<void> {
  if (params.canPersistOutcome && !(await params.canPersistOutcome())) {
    return;
  }

  const current = await params.store.getExecution(params.execution.id);
  if (!current || current.status === ExecutionStatus.Cancelled) {
    return;
  }

  const cancellationState = getCancellationState(current);
  if (!cancellationState) {
    return;
  }

  const now = new Date();
  const cancelledExecution: Execution = {
    ...current,
    status: ExecutionStatus.Cancelled,
    current: undefined,
    cancelRequestedAt: current.cancelRequestedAt ?? now,
    cancelledAt: now,
    completedAt: now,
    error: { message: cancellationState.reason },
    updatedAt: now,
  };
  const expectedStatus =
    current.status === ExecutionStatus.Cancelling
      ? ExecutionStatus.Cancelling
      : ExecutionStatus.Running;
  const cancelled = await params.store.saveExecutionIfStatus(
    cancelledExecution,
    [expectedStatus],
  );
  if (!cancelled) {
    return;
  }

  await params.logStatusChange({
    execution: current,
    from: current.status,
    to: ExecutionStatus.Cancelled,
    reason: "cancelled",
  });
  await params.notifyFinished(cancelledExecution);
}
