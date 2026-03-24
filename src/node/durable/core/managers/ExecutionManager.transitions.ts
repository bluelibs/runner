import type { IDurableStore } from "../interfaces/store";
import {
  ExecutionStatus,
  TimerStatus,
  TimerType,
  type Execution,
} from "../types";

type StatusChangeCallback = (params: {
  execution: Execution<unknown, unknown>;
  from: ExecutionStatus | null;
  to: ExecutionStatus;
  reason: string;
}) => Promise<void>;

type NotifyFinishedCallback = (execution: Execution) => Promise<void>;

type FinalizeCancellationCallback = (
  execution: Execution<unknown, unknown>,
  canPersistOutcome?: () => Promise<boolean>,
) => Promise<boolean>;

export async function transitionExecutionToRunning(params: {
  store: IDurableStore;
  execution: Execution<unknown, unknown>;
  logStatusChange: StatusChangeCallback;
}): Promise<Execution<unknown, unknown> | null> {
  if (params.execution.status === ExecutionStatus.Running) {
    if (params.execution.current === undefined) {
      return params.execution;
    }

    const resumedExecution: Execution = {
      ...params.execution,
      current: undefined,
      updatedAt: new Date(),
    };
    const resumed = await params.store.saveExecutionIfStatus(resumedExecution, [
      ExecutionStatus.Running,
    ]);

    return resumed ? resumedExecution : null;
  }

  const now = new Date();
  const runningExecution: Execution = {
    ...params.execution,
    status: ExecutionStatus.Running,
    current: undefined,
    result: undefined,
    error: undefined,
    completedAt: undefined,
    updatedAt: now,
  };
  const started = await params.store.saveExecutionIfStatus(runningExecution, [
    params.execution.status,
  ]);
  if (!started) {
    return null;
  }

  await params.logStatusChange({
    execution: params.execution,
    from: params.execution.status,
    to: ExecutionStatus.Running,
    reason: "start_attempt",
  });

  return runningExecution;
}

export async function transitionExecutionToFailed(params: {
  store: IDurableStore;
  execution: Execution<unknown, unknown>;
  from: ExecutionStatus;
  reason:
    | "failed"
    | "timed_out"
    | "workflow_key_missing"
    | "task_not_registered"
    | "delivery_attempts_exhausted";
  error: {
    message: string;
    stack?: string;
  };
  logStatusChange: StatusChangeCallback;
  notifyFinished: NotifyFinishedCallback;
  finalizeCancellation: FinalizeCancellationCallback;
}): Promise<void> {
  const completedAt = new Date();
  const failedExecution: Execution = {
    ...params.execution,
    status: ExecutionStatus.Failed,
    current: undefined,
    error: params.error,
    completedAt,
    updatedAt: completedAt,
  };

  const failed = await params.store.saveExecutionIfStatus(failedExecution, [
    params.from,
  ]);
  if (!failed) {
    if (params.from === ExecutionStatus.Running) {
      await params.finalizeCancellation(params.execution);
    }
    return;
  }
  await params.logStatusChange({
    execution: params.execution,
    from: params.from,
    to: ExecutionStatus.Failed,
    reason: params.reason,
  });
  await params.notifyFinished(failedExecution);
}

export async function completeExecutionAttempt(params: {
  store: IDurableStore;
  execution: Execution<unknown, unknown>;
  result: unknown;
  canPersistOutcome?: () => Promise<boolean>;
  logStatusChange: StatusChangeCallback;
  notifyFinished: NotifyFinishedCallback;
  finalizeCancellation: FinalizeCancellationCallback;
}): Promise<void> {
  if (params.canPersistOutcome && !(await params.canPersistOutcome())) {
    return;
  }

  const finishedExecution: Execution = {
    ...params.execution,
    status: ExecutionStatus.Completed,
    current: undefined,
    result: params.result,
    error: undefined,
    completedAt: new Date(),
    updatedAt: new Date(),
  };
  const completed = await params.store.saveExecutionIfStatus(
    finishedExecution,
    [ExecutionStatus.Running],
  );
  if (!completed) {
    await params.finalizeCancellation(
      params.execution,
      params.canPersistOutcome,
    );
    return;
  }

  await params.logStatusChange({
    execution: params.execution,
    from: ExecutionStatus.Running,
    to: ExecutionStatus.Completed,
    reason: "completed",
  });
  await params.notifyFinished(finishedExecution);
}

export async function suspendExecutionAttempt(params: {
  store: IDurableStore;
  execution: Execution<unknown, unknown>;
  reason: string;
  canPersistOutcome?: () => Promise<boolean>;
  logStatusChange: StatusChangeCallback;
  finalizeCancellation: FinalizeCancellationCallback;
}): Promise<void> {
  if (params.canPersistOutcome && !(await params.canPersistOutcome())) {
    return;
  }

  const sleepingExecution: Execution = {
    ...params.execution,
    status: ExecutionStatus.Sleeping,
    updatedAt: new Date(),
  };
  const suspended = await params.store.saveExecutionIfStatus(
    sleepingExecution,
    [ExecutionStatus.Running],
  );
  if (!suspended) {
    await params.finalizeCancellation(
      params.execution,
      params.canPersistOutcome,
    );
    return;
  }

  await params.logStatusChange({
    execution: params.execution,
    from: ExecutionStatus.Running,
    to: ExecutionStatus.Sleeping,
    reason: `suspend:${params.reason}`,
  });
}

export async function scheduleExecutionRetry(params: {
  store: IDurableStore;
  runningExecution: Execution<unknown, unknown>;
  error: { message: string; stack?: string };
  canPersistOutcome?: () => Promise<boolean>;
  logStatusChange: StatusChangeCallback;
  finalizeCancellation: FinalizeCancellationCallback;
}): Promise<void> {
  if (params.canPersistOutcome && !(await params.canPersistOutcome())) {
    return;
  }

  const delayMs = Math.pow(2, params.runningExecution.attempt) * 1000;
  const fireAt = new Date(Date.now() + delayMs);
  const retryTimerId = `retry:${params.runningExecution.id}:${params.runningExecution.attempt}`;

  await params.store.createTimer({
    id: retryTimerId,
    executionId: params.runningExecution.id,
    type: TimerType.Retry,
    fireAt,
    status: TimerStatus.Pending,
  });

  const retryingExecution: Execution = {
    ...params.runningExecution,
    status: ExecutionStatus.Retrying,
    current: undefined,
    attempt: params.runningExecution.attempt + 1,
    error: params.error,
    updatedAt: new Date(),
  };
  const scheduledRetry = await params.store.saveExecutionIfStatus(
    retryingExecution,
    [ExecutionStatus.Running],
  );
  if (!scheduledRetry) {
    try {
      await params.store.deleteTimer(retryTimerId);
    } catch {
      // Best-effort cleanup; ignore.
    }
    await params.finalizeCancellation(
      params.runningExecution,
      params.canPersistOutcome,
    );
    return;
  }

  await params.logStatusChange({
    execution: params.runningExecution,
    from: ExecutionStatus.Running,
    to: ExecutionStatus.Retrying,
    reason: "retry_scheduled",
  });
}
