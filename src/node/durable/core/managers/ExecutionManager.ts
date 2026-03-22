import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventBus } from "../interfaces/bus";
import type {
  DurableStartAndWaitResult,
  DurableServiceConfig,
  ExecuteOptions,
  ITaskExecutor,
  StartAndWaitOptions,
} from "../interfaces/service";
import type { ITask } from "../../../../types/task";
import { DurableAuditEntryKind } from "../audit";
import {
  ExecutionStatus,
  TimerStatus,
  TimerType,
  type Execution,
} from "../types";
import type { TaskRegistry } from "./TaskRegistry";
import type { AuditLogger } from "./AuditLogger";
import type { WaitManager } from "./WaitManager";
import { Logger } from "../../../../models/Logger";
import { DurableContext } from "../DurableContext";
import { SuspensionSignal } from "../interfaces/context";
import { getDeclaredDurableWorkflowSignalIds } from "../../tags/durableWorkflow.tag";
import { acquireStoreLock } from "../locking";
import { withExecutionWaitLock } from "../executionWaiters";
import { createExecutionWaitCompletionState } from "../executionWaitState";
import { commitDurableWaitCompletion } from "../waiterCore";
import {
  createExecutionId,
  isTimeoutExceededError,
  sleepMs,
  withTimeout,
} from "../utils";
import { durableExecutionInvariantError } from "../../../../errors";
import { NoopEventBus } from "../../bus/NoopEventBus";

export interface ExecutionManagerConfig {
  store: IDurableStore;
  queue?: IDurableQueue;
  eventBus?: IEventBus;
  taskExecutor?: ITaskExecutor;
  contextProvider?: DurableServiceConfig["contextProvider"];
  logger?: Logger;
  audit?: DurableServiceConfig["audit"];
  determinism?: DurableServiceConfig["determinism"];
  execution?: {
    maxAttempts?: number;
    timeout?: number;
    kickoffFailsafeDelayMs?: number;
  };
}

type ExecutionLockState = {
  lost: boolean;
  lossError: Error | null;
  lockId: string | "no-lock" | undefined;
  lockResource: string | undefined;
  lockTtlMs: number | undefined;
  triggerLoss: (error: Error) => void;
  waitForLoss: Promise<never>;
};

type ExecutionAttemptGuards = {
  assertLockOwnership: () => void;
  raceWithLockLoss: <T>(promise: Promise<T>) => Promise<T>;
  canPersistOutcome: () => Promise<boolean>;
  isCancelled: () => Promise<boolean>;
};

type ExecutionErrorInfo = {
  message: string;
  stack?: string;
};

type TaskAttemptOutcome =
  | { kind: "completed"; result: unknown }
  | { kind: "already-finalized" };

/**
 * Runs durable executions (the "workflow engine" for attempts).
 *
 * Responsibilities:
 * - persist new executions (including optional idempotency keys)
 * - enqueue work (queue mode) or run directly (embedded mode)
 * - execute a workflow attempt via `taskExecutor.run(...)`
 * - inject a per-attempt `DurableContext` (via `contextProvider` / ALS wrapper)
 * - interpret `SuspensionSignal` as "pause + reschedule" rather than failure
 * - update execution status/result/error and notify waiters (`WaitManager`)
 */
export class ExecutionManager {
  private readonly eventBus: IEventBus;
  private readonly logger: Logger;

  constructor(
    private readonly config: ExecutionManagerConfig,
    private readonly taskRegistry: TaskRegistry,
    private readonly auditLogger: AuditLogger,
    private readonly waitManager: WaitManager,
  ) {
    this.eventBus = this.config.eventBus ?? new NoopEventBus();
    const baseLogger =
      this.config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    this.logger = baseLogger.with({ source: "durable.execution" });
  }

  async start(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<string> {
    const task = this.resolveTaskReference(taskRef, "start");
    this.taskRegistry.register(task);
    this.assertCanExecute();

    if (options?.idempotencyKey) {
      return this.startWithIdempotencyKey(
        task,
        input,
        options.idempotencyKey,
        options,
      );
    }

    const executionId = await this.persistNewExecution(task, input, options);
    await this.kickoffWithFailsafe(executionId);
    return executionId;
  }

  // ─── Idempotent start ──────────────────────────────────────────────────────

  /**
   * Start a workflow with deduplication: if the same (taskId, idempotencyKey)
   * was already started, returns the existing executionId instead of creating
   * a duplicate. Relies on an atomic store primitive so create + dedupe claim
   * happen in one transaction.
   */
  private async startWithIdempotencyKey(
    task: ITask<any, Promise<any>, any, any, any, any>,
    input: unknown | undefined,
    idempotencyKey: string,
    options: ExecuteOptions | undefined,
  ): Promise<string> {
    this.assertStoreSupportsIdempotency();
    const execution = this.createPendingExecution(task, input, options);
    const created = await this.config.store.createExecutionWithIdempotencyKey!({
      execution,
      taskId: this.getTaskPersistenceId(task),
      idempotencyKey,
    });

    if (!created.created) {
      return created.executionId;
    }

    await this.logCreatedExecution(execution);
    await this.kickoffWithFailsafe(execution.id);
    return execution.id;
  }

  private assertCanExecute(): void {
    if (!this.config.queue && !this.config.taskExecutor) {
      durableExecutionInvariantError.throw({
        message:
          "DurableService requires `taskExecutor` to execute Runner tasks (when no queue is configured). Use a Runner durable workflow resource such as `resources.memoryWorkflow.fork(...).with(...)` or provide a custom executor in config.",
      });
    }
  }

  private assertStoreSupportsIdempotency(): void {
    if (!this.config.store.createExecutionWithIdempotencyKey) {
      durableExecutionInvariantError.throw({
        message:
          "Durable store does not support execution idempotency keys. Implement createExecutionWithIdempotencyKey() on the store to use ExecuteOptions.idempotencyKey.",
      });
    }
  }

  // ─── Execution persistence ─────────────────────────────────────────────────

  private getTaskPersistenceId(
    task: ITask<any, Promise<any>, any, any, any, any>,
  ): string {
    return this.taskRegistry.getPersistenceId(task);
  }

  private createPendingExecution(
    task: ITask<any, Promise<any>, any, any, any, any>,
    input: unknown | undefined,
    options: ExecuteOptions | undefined,
    executionId?: string,
  ): Execution<unknown, unknown> {
    return {
      id: executionId ?? createExecutionId(),
      taskId: this.getTaskPersistenceId(task),
      parentExecutionId: options?.parentExecutionId,
      input,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: this.config.execution?.maxAttempts ?? 3,
      timeout: options?.timeout ?? this.config.execution?.timeout,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private async logCreatedExecution(execution: Execution): Promise<void> {
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.ExecutionStatusChanged,
      executionId: execution.id,
      taskId: execution.taskId,
      attempt: execution.attempt,
      from: null,
      to: ExecutionStatus.Pending,
      reason: "created",
    });
  }

  /**
   * Creates a new execution record, persists it to the store, and logs an
   * audit entry. Returns the executionId.
   */
  private async persistNewExecution(
    task: ITask<any, Promise<any>, any, any, any, any>,
    input: unknown | undefined,
    options: ExecuteOptions | undefined,
    executionId?: string,
  ): Promise<string> {
    const execution = this.createPendingExecution(
      task,
      input,
      options,
      executionId,
    );

    await this.config.store.saveExecution(execution);
    await this.logCreatedExecution(execution);

    return execution.id;
  }

  /**
   * Kicks off an execution with a failsafe timer for queue mode.
   * If the queue enqueue succeeds, the timer is cleaned up immediately.
   * If enqueue fails, the timer remains so the polling loop can retry later.
   */
  private async kickoffWithFailsafe(executionId: string): Promise<void> {
    const failsafeDelayMs =
      this.config.execution?.kickoffFailsafeDelayMs ?? 10_000;
    const shouldArmFailsafe = Boolean(this.config.queue) && failsafeDelayMs > 0;

    if (shouldArmFailsafe) {
      const timerId = `kickoff:${executionId}`;
      await this.config.store.createTimer({
        id: timerId,
        executionId,
        type: TimerType.Retry,
        fireAt: new Date(Date.now() + failsafeDelayMs),
        status: TimerStatus.Pending,
      });

      // If kickoffExecution throws (eg. broker outage), the failsafe timer
      // stays in the store so the polling loop can retry.
      await this.kickoffExecution(executionId);

      try {
        await this.config.store.deleteTimer(timerId);
      } catch {
        // Best-effort timer cleanup; ignore.
      }
      return;
    }

    await this.kickoffExecution(executionId);
  }

  async cancelExecution(executionId: string, reason?: string): Promise<void> {
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const execution = await this.config.store.getExecution(executionId);
      if (!execution) return;
      if (this.isExecutionTerminal(execution.status)) return;

      const now = new Date();
      const cancelledExecution: Execution = {
        ...execution,
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: execution.cancelRequestedAt ?? now,
        cancelledAt: now,
        completedAt: now,
        error: { message: reason ?? "Execution cancelled" },
        updatedAt: now,
      };
      const cancelled = await this.config.store.saveExecutionIfStatus(
        cancelledExecution,
        [execution.status],
      );
      if (!cancelled) {
        if (attempt < maxAttempts) {
          await sleepMs(Math.min(2 ** (attempt - 1), 25));
        }
        continue;
      }

      await this.auditLogger.log({
        kind: DurableAuditEntryKind.ExecutionStatusChanged,
        executionId,
        taskId: execution.taskId,
        attempt: execution.attempt,
        from: execution.status,
        to: ExecutionStatus.Cancelled,
        reason: "cancelled",
      });
      await this.notifyExecutionFinished(cancelledExecution);
      return;
    }

    const latestExecution = await this.config.store.getExecution(executionId);
    if (!latestExecution || this.isExecutionTerminal(latestExecution.status)) {
      return;
    }

    durableExecutionInvariantError.throw({
      message: `Failed to cancel durable execution '${executionId}' after ${maxAttempts} attempts due to concurrent state changes.`,
    });
  }

  async startAndWait(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: StartAndWaitOptions,
  ): Promise<DurableStartAndWaitResult<unknown>> {
    const executionId = await this.start(taskRef, input, options);
    const data = await this.waitManager.waitForResult(executionId, {
      timeout: options?.completionTimeout,
      waitPollIntervalMs: options?.waitPollIntervalMs,
    });
    return {
      durable: { executionId },
      data,
    };
  }

  async processExecution(executionId: string): Promise<void> {
    const snapshot = await this.config.store.getExecution(executionId);
    if (!snapshot) return;
    if (this.isExecutionTerminal(snapshot.status)) return;

    const lockResource = `execution:${executionId}`;
    const lockTtlMs = 30_000;
    const acquiredLock = await acquireStoreLock({
      store: this.config.store,
      resource: lockResource,
      ttlMs: lockTtlMs,
      sleep: sleepMs,
    });

    if (acquiredLock === null) return;

    const executionLockState = this.createExecutionLockState();
    executionLockState.lockId = acquiredLock.lockId;
    executionLockState.lockResource = lockResource;
    executionLockState.lockTtlMs = lockTtlMs;
    const stopLockHeartbeat = this.startLockHeartbeat({
      lockResource,
      lockId: acquiredLock.lockId,
      lockTtlMs,
      lockState: executionLockState,
    });

    try {
      const execution = await this.config.store.getExecution(executionId);
      if (!execution) return;
      if (this.isExecutionTerminal(execution.status)) return;

      const task = this.taskRegistry.find(execution.taskId);
      if (!task) {
        await this.transitionExecutionToFailed({
          execution,
          from: execution.status,
          reason: "task_not_registered",
          error: { message: `Task not registered: ${execution.taskId}` },
        });
        return;
      }

      await this.runExecutionAttempt(execution, task, executionLockState);
    } finally {
      stopLockHeartbeat();
      await acquiredLock.release();
    }
  }

  private createExecutionLockState(): ExecutionLockState {
    let didLoseLock = false;
    let rejectLoss: ((error: Error) => void) | null = null;
    const waitForLoss = new Promise<never>((_, reject) => {
      rejectLoss = reject;
    });
    void waitForLoss.catch(() => {});

    return {
      lost: false,
      lossError: null,
      lockId: undefined,
      lockResource: undefined,
      lockTtlMs: undefined,
      triggerLoss: (error) => {
        if (didLoseLock || rejectLoss === null) return;
        didLoseLock = true;
        rejectLoss(error);
      },
      waitForLoss,
    };
  }

  private markExecutionLockLost(
    executionLockState: ExecutionLockState,
    lockResource: string,
  ): Error {
    const lossError = durableExecutionInvariantError.new({
      message: `Execution lock lost for '${lockResource}' while the attempt was still running.`,
    });
    executionLockState.lost = true;
    executionLockState.lossError = lossError;
    executionLockState.triggerLoss(lossError);
    return lossError;
  }

  private async assertStoreLockOwnership(
    executionLockState: ExecutionLockState,
  ): Promise<void> {
    const lockId = executionLockState.lockId;
    const lockResource = executionLockState.lockResource;
    const lockTtlMs = executionLockState.lockTtlMs;

    if (
      executionLockState.lost ||
      lockId === undefined ||
      lockResource === undefined ||
      lockTtlMs === undefined ||
      lockId === "no-lock" ||
      !this.config.store.renewLock
    ) {
      if (executionLockState.lost) {
        throw executionLockState.lossError;
      }
      return;
    }

    try {
      const renewed = await this.config.store.renewLock(
        lockResource,
        lockId,
        lockTtlMs,
      );
      if (renewed) {
        return;
      }
    } catch {
      // Failing closed avoids persisting an outcome after ownership may be lost.
    }

    throw this.markExecutionLockLost(executionLockState, lockResource);
  }

  async failExecutionDeliveryExhausted(
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
      const execution = await this.config.store.getExecution(executionId);
      if (!execution) return;
      if (this.isExecutionTerminal(execution.status)) return;

      const completedAt = new Date();
      const failedExecution: Execution = {
        ...execution,
        status: ExecutionStatus.Failed,
        error: { message },
        completedAt,
        updatedAt: completedAt,
      };
      const failed = await this.config.store.saveExecutionIfStatus(
        failedExecution,
        [execution.status],
      );
      if (!failed) {
        if (transitionAttempt < maxTransitionAttempts) {
          await sleepMs(Math.min(2 ** (transitionAttempt - 1), 25));
        }
        continue;
      }

      await this.logExecutionStatusChange({
        execution,
        from: execution.status,
        to: ExecutionStatus.Failed,
        reason: "delivery_attempts_exhausted",
      });
      await this.notifyExecutionFinished(failedExecution);
      return;
    }

    const latestExecution = await this.config.store.getExecution(executionId);
    if (!latestExecution || this.isExecutionTerminal(latestExecution.status)) {
      return;
    }

    durableExecutionInvariantError.throw({
      message: `Failed to transition durable execution '${executionId}' to failed after ${maxTransitionAttempts} attempts while handling exhausted queue delivery.`,
    });
  }

  private startLockHeartbeat(params: {
    lockResource: string;
    lockId: string | "no-lock";
    lockTtlMs: number;
    lockState: ExecutionLockState;
  }): () => void {
    if (params.lockId === "no-lock") return () => {};
    if (!this.config.store.renewLock) return () => {};

    const intervalMs = Math.max(1_000, Math.floor(params.lockTtlMs / 3));
    let stopped = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRenewal = () => {
      heartbeatTimer = setTimeout(() => {
        heartbeatTimer = null;
        if (stopped) return;
        void this.config.store.renewLock!(
          params.lockResource,
          params.lockId,
          params.lockTtlMs,
        )
          .then((renewed) => {
            if (!renewed) {
              this.markExecutionLockLost(params.lockState, params.lockResource);
            }
          })
          .catch(() => {
            // A transient renew failure should not abandon the attempt outright;
            // outcome writes still re-check ownership against the store.
          })
          .finally(() => {
            if (!stopped) {
              scheduleRenewal();
            }
          });
      }, intervalMs);
      heartbeatTimer.unref?.();
    };

    scheduleRenewal();

    return () => {
      stopped = true;
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
  }

  async kickoffExecution(executionId: string): Promise<void> {
    if (this.config.queue) {
      await this.config.queue.enqueue({
        type: "execute",
        payload: { executionId },
        maxAttempts: this.config.execution?.maxAttempts ?? 3,
      });
      return;
    }

    await this.processExecution(executionId);
  }

  /**
   * Recovery should reuse the same queue-mode failsafe as normal starts so a
   * broker outage does not strand recovered executions without a retry path.
   */
  async recoverExecution(executionId: string): Promise<void> {
    await this.kickoffWithFailsafe(executionId);
  }

  async notifyExecutionFinished(execution: Execution): Promise<void> {
    await this.resolveExecutionWaiters(execution);

    try {
      await this.eventBus.publish(`execution:${execution.id}`, {
        type: "finished",
        payload: execution,
        timestamp: new Date(),
      });
    } catch (error) {
      // Completion state lives in the durable store; pub/sub notification is best-effort.
      try {
        await this.logger.error(
          "Durable execution finished notification failed.",
          {
            executionId: execution.id,
            status: execution.status,
            error,
          },
        );
      } catch {
        // Logging must not affect durable terminal state handling.
      }
    }
  }

  private async resolveExecutionWaiters(execution: Execution): Promise<void> {
    await withExecutionWaitLock({
      store: this.config.store,
      targetExecutionId: execution.id,
      fn: async () => {
        const waiters = await this.config.store.listExecutionWaiters(
          execution.id,
        );
        for (const waiter of waiters) {
          const stepResult = {
            executionId: waiter.executionId,
            stepId: waiter.stepId,
            result: createExecutionWaitCompletionState(execution),
            completedAt: new Date(),
          };

          const completed = await commitDurableWaitCompletion({
            store: this.config.store,
            stepResult,
            timerId: waiter.timerId,
            commitAtomically: this.config.store.commitExecutionWaiterCompletion
              ? async () =>
                  await this.config.store.commitExecutionWaiterCompletion!({
                    targetExecutionId: execution.id,
                    executionId: waiter.executionId,
                    stepId: waiter.stepId,
                    stepResult,
                    timerId: waiter.timerId,
                  })
              : undefined,
            onFallbackCommitted: async () => {
              await this.config.store.deleteExecutionWaiter(
                execution.id,
                waiter.executionId,
                waiter.stepId,
              );
            },
          });

          if (!completed) {
            continue;
          }

          await this.kickoffWithFailsafe(waiter.executionId);
        }
      },
    });
  }

  private async logExecutionStatusChange(params: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus | null;
    to: ExecutionStatus;
    reason: string;
  }): Promise<void> {
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.ExecutionStatusChanged,
      executionId: params.execution.id,
      taskId: params.execution.taskId,
      attempt: params.execution.attempt,
      from: params.from,
      to: params.to,
      reason: params.reason,
    });
  }

  private createExecutionAttemptGuards(
    executionId: string,
    executionLockState: ExecutionLockState,
  ): ExecutionAttemptGuards {
    const assertLockOwnership = (): void => {
      if (executionLockState.lost) {
        durableExecutionInvariantError.throw({
          message: `Execution lock lost for '${executionId}' while the attempt was still running.`,
        });
      }
    };

    return {
      assertLockOwnership,
      raceWithLockLoss: async <T>(promise: Promise<T>): Promise<T> =>
        await Promise.race([promise, executionLockState.waitForLoss]),
      canPersistOutcome: async (): Promise<boolean> => {
        try {
          assertLockOwnership();
          await this.assertStoreLockOwnership(executionLockState);
          return true;
        } catch (error) {
          if (
            error === executionLockState.lossError ||
            executionLockState.lost
          ) {
            return false;
          }
          throw error;
        }
      },
      isCancelled: async (): Promise<boolean> => {
        const current = await this.config.store.getExecution(executionId);
        return current?.status === ExecutionStatus.Cancelled;
      },
    };
  }

  private assertTaskExecutorConfigured(): void {
    if (!this.config.taskExecutor) {
      durableExecutionInvariantError.throw({
        message:
          "DurableService cannot run executions without `taskExecutor` in config.",
      });
    }
  }

  private async transitionExecutionToRunning(
    execution: Execution<unknown, unknown>,
  ): Promise<Execution<unknown, unknown> | null> {
    if (execution.status === ExecutionStatus.Running) {
      return execution;
    }

    const now = new Date();
    const runningExecution: Execution = {
      ...execution,
      status: ExecutionStatus.Running,
      result: undefined,
      error: undefined,
      completedAt: undefined,
      updatedAt: now,
    };
    const started = await this.config.store.saveExecutionIfStatus(
      runningExecution,
      [execution.status],
    );
    if (!started) {
      return null;
    }

    await this.logExecutionStatusChange({
      execution,
      from: execution.status,
      to: ExecutionStatus.Running,
      reason: "start_attempt",
    });

    return runningExecution;
  }

  private createExecutionContext(
    runningExecution: Execution<unknown, unknown>,
    task: ITask<unknown, Promise<unknown>, any, any, any, any>,
    assertLockOwnership: () => void,
  ): DurableContext {
    return new DurableContext(
      this.config.store,
      this.eventBus,
      runningExecution.id,
      runningExecution.attempt,
      {
        auditEnabled: this.config.audit?.enabled === true,
        auditEmitter: this.config.audit?.emitter,
        implicitInternalStepIds:
          this.config.determinism?.implicitInternalStepIds,
        declaredSignalIds: getDeclaredDurableWorkflowSignalIds(task),
        assertLockOwnership,
        startWorkflowExecution: async (childTask, input, options) =>
          await this.start(childTask, input, options),
        getTaskPersistenceId: (childTask) =>
          this.getTaskPersistenceId(childTask),
      },
    );
  }

  private async runTaskAttempt(params: {
    task: ITask<unknown, Promise<unknown>, any, any, any, any>;
    input: unknown;
    context: DurableContext;
    execution: Execution<unknown, unknown>;
    raceWithLockLoss: <T>(promise: Promise<T>) => Promise<T>;
    canPersistOutcome: () => Promise<boolean>;
  }): Promise<TaskAttemptOutcome> {
    const contextProvider = this.config.contextProvider ?? ((_ctx, fn) => fn());
    const taskPromise = Promise.resolve(
      contextProvider(params.context, () =>
        this.config.taskExecutor!.run(params.task, params.input),
      ),
    );

    if (!params.execution.timeout) {
      return {
        kind: "completed",
        result: await params.raceWithLockLoss(taskPromise),
      };
    }

    const timeoutMessage = `Execution ${params.execution.id} timed out`;
    const elapsed = Date.now() - params.execution.createdAt.getTime();
    const remainingTimeout = Math.max(0, params.execution.timeout - elapsed);

    if (remainingTimeout === 0 && params.execution.timeout > 0) {
      if (!(await params.canPersistOutcome())) {
        return { kind: "already-finalized" };
      }
      await this.transitionExecutionToFailed({
        execution: params.execution,
        from: ExecutionStatus.Running,
        reason: "timed_out",
        error: { message: timeoutMessage },
      });
      return { kind: "already-finalized" };
    }

    return {
      kind: "completed",
      result: await params.raceWithLockLoss(
        withTimeout(taskPromise, remainingTimeout, timeoutMessage),
      ),
    };
  }

  private async completeExecutionAttempt(
    runningExecution: Execution<unknown, unknown>,
    result: unknown,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<void> {
    if (canPersistOutcome && !(await canPersistOutcome())) {
      return;
    }

    const finishedExecution: Execution = {
      ...runningExecution,
      status: ExecutionStatus.Completed,
      result,
      error: undefined,
      completedAt: new Date(),
      updatedAt: new Date(),
    };
    const completed = await this.config.store.saveExecutionIfStatus(
      finishedExecution,
      [ExecutionStatus.Running],
    );
    if (!completed) {
      return;
    }

    await this.logExecutionStatusChange({
      execution: runningExecution,
      from: ExecutionStatus.Running,
      to: ExecutionStatus.Completed,
      reason: "completed",
    });
    await this.notifyExecutionFinished(finishedExecution);
  }

  private async suspendExecutionAttempt(
    runningExecution: Execution<unknown, unknown>,
    reason: string,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<void> {
    if (canPersistOutcome && !(await canPersistOutcome())) {
      return;
    }

    const sleepingExecution: Execution = {
      ...runningExecution,
      status: ExecutionStatus.Sleeping,
      updatedAt: new Date(),
    };
    const suspended = await this.config.store.saveExecutionIfStatus(
      sleepingExecution,
      [ExecutionStatus.Running],
    );
    if (!suspended) {
      return;
    }

    await this.logExecutionStatusChange({
      execution: runningExecution,
      from: ExecutionStatus.Running,
      to: ExecutionStatus.Sleeping,
      reason: `suspend:${reason}`,
    });
  }

  private toExecutionErrorInfo(error: unknown): ExecutionErrorInfo {
    return {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  private isCompensationFailure(error: unknown): boolean {
    return (
      error instanceof Error && error.message.startsWith("Compensation failed")
    );
  }

  private async scheduleExecutionRetry(params: {
    runningExecution: Execution<unknown, unknown>;
    error: ExecutionErrorInfo;
    canPersistOutcome?: () => Promise<boolean>;
  }): Promise<void> {
    if (params.canPersistOutcome && !(await params.canPersistOutcome())) {
      return;
    }

    const delayMs = Math.pow(2, params.runningExecution.attempt) * 1000;
    const fireAt = new Date(Date.now() + delayMs);
    const retryTimerId = `retry:${params.runningExecution.id}:${params.runningExecution.attempt}`;

    await this.config.store.createTimer({
      id: retryTimerId,
      executionId: params.runningExecution.id,
      type: TimerType.Retry,
      fireAt,
      status: TimerStatus.Pending,
    });

    const retryingExecution: Execution = {
      ...params.runningExecution,
      status: ExecutionStatus.Retrying,
      attempt: params.runningExecution.attempt + 1,
      error: params.error,
      updatedAt: new Date(),
    };
    const scheduledRetry = await this.config.store.saveExecutionIfStatus(
      retryingExecution,
      [ExecutionStatus.Running],
    );
    if (!scheduledRetry) {
      try {
        await this.config.store.deleteTimer(retryTimerId);
      } catch {
        // Best-effort cleanup; ignore.
      }
      return;
    }

    await this.logExecutionStatusChange({
      execution: params.runningExecution,
      from: ExecutionStatus.Running,
      to: ExecutionStatus.Retrying,
      reason: "retry_scheduled",
    });
  }

  private async handleExecutionAttemptError(params: {
    error: unknown;
    runningExecution: Execution<unknown, unknown>;
    guards: ExecutionAttemptGuards;
    executionLockState: ExecutionLockState;
  }): Promise<void> {
    if (
      params.error === params.executionLockState.lossError ||
      params.executionLockState.lost
    ) {
      return;
    }

    if (params.error instanceof SuspensionSignal) {
      if (await params.guards.isCancelled()) {
        return;
      }
      await this.suspendExecutionAttempt(
        params.runningExecution,
        params.error.reason,
        params.guards.canPersistOutcome,
      );
      return;
    }

    if (this.isCompensationFailure(params.error)) {
      return;
    }

    if (await params.guards.isCancelled()) {
      return;
    }

    const errorInfo = this.toExecutionErrorInfo(params.error);
    const timedOut = isTimeoutExceededError(params.error);
    const exhaustedAttempts =
      params.runningExecution.attempt >= params.runningExecution.maxAttempts;

    if (timedOut || exhaustedAttempts) {
      if (!(await params.guards.canPersistOutcome())) {
        return;
      }
      await this.transitionExecutionToFailed({
        execution: params.runningExecution,
        from: ExecutionStatus.Running,
        reason: timedOut ? "timed_out" : "failed",
        error: errorInfo,
      });
      return;
    }

    await this.scheduleExecutionRetry({
      runningExecution: params.runningExecution,
      error: errorInfo,
      canPersistOutcome: params.guards.canPersistOutcome,
    });
  }

  private async runExecutionAttempt(
    execution: Execution<unknown, unknown>,
    task: ITask<unknown, Promise<unknown>, any, any, any, any>,
    executionLockState: ExecutionLockState,
  ): Promise<void> {
    const guards = this.createExecutionAttemptGuards(
      execution.id,
      executionLockState,
    );
    guards.assertLockOwnership();

    if (await guards.isCancelled()) return;

    this.assertTaskExecutorConfigured();

    const runningExecution =
      (await this.transitionExecutionToRunning(execution)) ?? null;
    if (!runningExecution) {
      return;
    }

    const context = this.createExecutionContext(
      runningExecution,
      task,
      guards.assertLockOwnership,
    );

    try {
      const outcome = await this.runTaskAttempt({
        task,
        input: runningExecution.input,
        context,
        execution: runningExecution,
        raceWithLockLoss: guards.raceWithLockLoss,
        canPersistOutcome: guards.canPersistOutcome,
      });
      if (outcome.kind === "already-finalized") {
        return;
      }

      // Cancellation wins over completion.
      if (await guards.isCancelled()) return;

      await this.completeExecutionAttempt(
        runningExecution,
        outcome.result,
        guards.canPersistOutcome,
      );
    } catch (error) {
      await this.handleExecutionAttemptError({
        error,
        runningExecution,
        guards,
        executionLockState,
      });
    }
  }

  private resolveTaskReference(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    apiMethod: string,
  ): ITask<any, Promise<any>, any, any, any, any> {
    if (typeof taskRef !== "string") {
      return taskRef;
    }

    const resolved = this.taskRegistry.find(taskRef);
    if (!resolved) {
      durableExecutionInvariantError.throw({
        message: `DurableService.${apiMethod}() could not resolve task id "${taskRef}". Ensure the task is registered in the runtime store.`,
      });
    }
    return resolved!;
  }

  private isExecutionTerminal(status: ExecutionStatus): boolean {
    return (
      status === ExecutionStatus.Completed ||
      status === ExecutionStatus.Failed ||
      status === ExecutionStatus.CompensationFailed ||
      status === ExecutionStatus.Cancelled
    );
  }

  private async transitionExecutionToFailed(params: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus;
    reason:
      | "failed"
      | "timed_out"
      | "task_not_registered"
      | "delivery_attempts_exhausted";
    error: {
      message: string;
      stack?: string;
    };
  }): Promise<void> {
    const completedAt = new Date();
    const failedExecution: Execution = {
      ...params.execution,
      status: ExecutionStatus.Failed,
      error: params.error,
      completedAt,
      updatedAt: completedAt,
    };

    const failed = await this.config.store.saveExecutionIfStatus(
      failedExecution,
      [params.from],
    );
    if (!failed) {
      return;
    }
    await this.logExecutionStatusChange({
      execution: params.execution,
      from: params.from,
      to: ExecutionStatus.Failed,
      reason: params.reason,
    });
    await this.notifyExecutionFinished(failedExecution);
  }
}
