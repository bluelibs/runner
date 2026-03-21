import type { IDurableStore } from "../interfaces/store";
import type { Timer, Execution } from "../types";
import { ExecutionStatus, TimerType } from "../types";
import { DurableAuditEntryKind } from "../audit";
import type { AuditLogger } from "./AuditLogger";
import type { TaskRegistry } from "./TaskRegistry";
import type { ScheduleManager } from "./ScheduleManager";
import { parseSignalState } from "../utils";
import {
  deleteSignalWaiter,
  getSignalIdFromStepId,
  withSignalLock,
} from "../signalWaiters";
import { Logger } from "../../../../models/Logger";
import { durableExecutionInvariantError } from "../../../../errors";

export async function handleSleepTimer(params: {
  store: IDurableStore;
  auditLogger: AuditLogger;
  timer: Timer;
}): Promise<void> {
  if (
    params.timer.type !== TimerType.Sleep ||
    !params.timer.executionId ||
    !params.timer.stepId
  ) {
    return;
  }

  await params.store.saveStepResult({
    executionId: params.timer.executionId,
    stepId: params.timer.stepId,
    result: { state: "completed" },
    completedAt: new Date(),
  });

  const execution = await params.store.getExecution(params.timer.executionId);
  await params.auditLogger.log({
    kind: DurableAuditEntryKind.SleepCompleted,
    executionId: params.timer.executionId,
    taskId: execution?.taskId,
    attempt: execution ? execution.attempt : 0,
    stepId: params.timer.stepId,
    timerId: params.timer.id,
  });
}

export async function handleSignalTimeoutTimer(params: {
  store: IDurableStore;
  logger: Logger;
  timer: Timer;
}): Promise<string | null> {
  if (
    params.timer.type !== TimerType.SignalTimeout ||
    !params.timer.executionId ||
    !params.timer.stepId
  ) {
    return null;
  }

  const fallbackSignalId = params.timer.stepId.startsWith("__signal:")
    ? getSignalIdFromStepId(params.timer.stepId)
    : params.timer.stepId.split(":")[0];
  const currentSignalStep = await params.store.getStepResult(
    params.timer.executionId,
    params.timer.stepId,
  );
  const currentSignalState = parseSignalState(currentSignalStep?.result);
  const signalIdForLock = currentSignalState?.signalId ?? fallbackSignalId;
  const lockSignalId = signalIdForLock ?? "__unknown_signal_timeout__";

  if (!signalIdForLock) {
    try {
      await params.logger.warn(
        "Durable signal-timeout handler fell back to an unknown signal id.",
        {
          data: {
            timerId: params.timer.id,
            executionId: params.timer.executionId,
            stepId: params.timer.stepId,
            fallbackSignalId: lockSignalId,
            timerType: params.timer.type,
          },
        },
      );
    } catch {
      // Logging must not crash durable timer handling.
    }
  }

  return await withSignalLock({
    store: params.store,
    executionId: params.timer.executionId,
    signalId: lockSignalId,
    fn: async () => {
      const existing = await params.store.getStepResult(
        params.timer.executionId!,
        params.timer.stepId!,
      );
      const state = parseSignalState(existing?.result);
      if (state?.state !== "waiting") {
        return null;
      }

      const signalId = state.signalId ?? fallbackSignalId;
      if (!signalId) {
        return durableExecutionInvariantError.throw({
          message: `Invalid signal timeout step id '${params.timer.stepId}' for timer '${params.timer.id}'`,
        });
      }

      await deleteSignalWaiter({
        store: params.store,
        executionId: params.timer.executionId!,
        signalId,
        stepId: params.timer.stepId!,
      });

      const timedOutState =
        state.signalId !== undefined
          ? { state: "timed_out" as const, signalId: state.signalId }
          : { state: "timed_out" as const };
      await params.store.saveStepResult({
        executionId: params.timer.executionId!,
        stepId: params.timer.stepId!,
        result: timedOutState,
        completedAt: new Date(),
      });

      return signalId;
    },
  });
}

export async function persistTaskTimerExecution(params: {
  store: IDurableStore;
  timer: Timer;
  taskId: string;
  maxAttempts: number;
  defaultTimeout: number | undefined;
}): Promise<string> {
  const executionId = `timer:${params.timer.id}`;
  const execution: Execution<unknown, unknown> = {
    id: executionId,
    taskId: params.taskId,
    input: params.timer.input,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: params.maxAttempts,
    timeout: params.defaultTimeout,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (params.store.createExecutionWithIdempotencyKey) {
    const created = await params.store.createExecutionWithIdempotencyKey({
      execution,
      taskId: params.taskId,
      idempotencyKey: `timer:${params.timer.id}`,
    });
    return created.executionId;
  }

  await params.store.saveExecution(execution);
  return executionId;
}

export async function handleExecutionTimer(params: {
  timer: Timer;
  queue:
    | {
        enqueue: (message: {
          type: "resume";
          payload: { executionId: string };
          maxAttempts: number;
        }) => Promise<unknown>;
      }
    | undefined;
  maxAttempts: number;
  processExecution: (executionId: string) => Promise<void>;
  onDurableSideEffectCommitted?: () => void;
}): Promise<boolean> {
  if (!params.timer.executionId) {
    return false;
  }

  if (params.queue) {
    await params.queue.enqueue({
      type: "resume",
      payload: { executionId: params.timer.executionId },
      maxAttempts: params.maxAttempts,
    });
  } else {
    await params.processExecution(params.timer.executionId);
  }

  params.onDurableSideEffectCommitted?.();
  return true;
}

export async function handleScheduledTaskTimer(params: {
  store: IDurableStore;
  timer: Timer;
  taskRegistry: TaskRegistry;
  scheduleManager: ScheduleManager;
  kickoffExecution: (executionId: string) => Promise<void>;
  persistTaskTimerExecution: (params: {
    timer: Timer;
    taskId: string;
  }) => Promise<string>;
  assertTimerClaimIsStillOwned: () => void;
  onDurableSideEffectCommitted?: () => void;
}): Promise<boolean> {
  if (!params.timer.taskId) {
    return false;
  }

  if (params.timer.scheduleId) {
    const schedule = await params.store.getSchedule(params.timer.scheduleId);
    params.assertTimerClaimIsStillOwned();
    if (!schedule || schedule.status !== "active") {
      return false;
    }
    if (
      schedule.nextRun &&
      params.timer.fireAt.getTime() !== schedule.nextRun.getTime()
    ) {
      return false;
    }
  }

  const task = params.taskRegistry.find(params.timer.taskId);
  if (!task) {
    return false;
  }

  const executionId = await params.persistTaskTimerExecution({
    timer: params.timer,
    taskId: params.taskRegistry.getPersistenceId(task),
  });
  params.onDurableSideEffectCommitted?.();
  params.assertTimerClaimIsStillOwned();
  await params.kickoffExecution(executionId);
  params.assertTimerClaimIsStillOwned();

  if (params.timer.scheduleId) {
    const schedule = await params.store.getSchedule(params.timer.scheduleId);
    params.assertTimerClaimIsStillOwned();
    if (schedule && schedule.status === "active") {
      await params.scheduleManager.reschedule(schedule, {
        lastRunAt: new Date(),
      });
      params.assertTimerClaimIsStillOwned();
    }
  }

  return true;
}
