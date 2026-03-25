import type { BusEvent, BusEventHandler, IEventBus } from "../interfaces/bus";
import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus, type Execution } from "../types";

export type ExecutionCancellationState = {
  reason: string;
};

export const DURABLE_EXECUTION_CONTROL_CHANNEL = "durable:execution-control";
export const DurableExecutionControlEventType = {
  CancellationRequested: "cancellation_requested",
} as const;

type CancellationRequestedPayload = {
  executionId: string;
  reason: string;
};

function isCancellationRequestedPayload(
  value: unknown,
): value is CancellationRequestedPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "executionId" in value &&
    typeof value.executionId === "string" &&
    "reason" in value &&
    typeof value.reason === "string"
  );
}

function parseCancellationRequestedEvent(
  event: BusEvent,
): CancellationRequestedPayload | null {
  if (event.type !== DurableExecutionControlEventType.CancellationRequested) {
    return null;
  }

  return isCancellationRequestedPayload(event.payload) ? event.payload : null;
}

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

export async function startLiveExecutionCancellationListener(params: {
  eventBus: IEventBus;
  abortActiveAttempt: (executionId: string, reason: string) => void;
}): Promise<() => Promise<void>> {
  const handler: BusEventHandler = async (event) => {
    const cancellationRequested = parseCancellationRequestedEvent(event);
    if (!cancellationRequested) {
      return;
    }

    params.abortActiveAttempt(
      cancellationRequested.executionId,
      cancellationRequested.reason,
    );
  };

  await params.eventBus.subscribe(DURABLE_EXECUTION_CONTROL_CHANNEL, handler);

  return async () => {
    await params.eventBus.unsubscribe(
      DURABLE_EXECUTION_CONTROL_CHANNEL,
      handler,
    );
  };
}

export async function publishExecutionCancellationRequested(params: {
  eventBus: IEventBus;
  executionId: string;
  reason: string;
}): Promise<void> {
  await params.eventBus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
    type: DurableExecutionControlEventType.CancellationRequested,
    payload: {
      executionId: params.executionId,
      reason: params.reason,
    },
    timestamp: new Date(),
  });
}

export function startExecutionCancellationPollingFallback(params: {
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
