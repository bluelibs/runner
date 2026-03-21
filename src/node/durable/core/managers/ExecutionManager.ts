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
  triggerLoss: (error: Error) => void;
  waitForLoss: Promise<never>;
};

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
    while (true) {
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
  }

  async startAndWait(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: StartAndWaitOptions,
  ): Promise<DurableStartAndWaitResult<unknown>> {
    const executionId = await this.start(taskRef, input, options);
    const data = await this.waitManager.waitForResult(executionId, {
      timeout: options?.waitTimeout,
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
      triggerLoss: (error) => {
        if (didLoseLock || rejectLoss === null) return;
        didLoseLock = true;
        rejectLoss(error);
      },
      waitForLoss,
    };
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
    const execution = await this.config.store.getExecution(executionId);
    if (!execution) return;
    if (this.isExecutionTerminal(execution.status)) return;

    const message =
      `Queue delivery attempts exhausted for execution ${executionId} ` +
      `(message ${details.messageId}, attempts ${details.attempts}/${details.maxAttempts}): ` +
      details.errorMessage;

    await this.transitionExecutionToFailed({
      execution,
      from: execution.status,
      reason: "delivery_attempts_exhausted",
      error: { message },
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
              const lossError = durableExecutionInvariantError.new({
                message: `Execution lock lost for '${params.lockResource}' while the attempt was still running.`,
              });
              params.lockState.lost = true;
              params.lockState.lossError = lossError;
              params.lockState.triggerLoss(lossError);
            }
          })
          .catch(() => {
            const lossError = durableExecutionInvariantError.new({
              message: `Execution lock lost for '${params.lockResource}' while the attempt was still running.`,
            });
            params.lockState.lost = true;
            params.lockState.lossError = lossError;
            params.lockState.triggerLoss(lossError);
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

  async notifyExecutionFinished(execution: Execution): Promise<void> {
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

  private async runExecutionAttempt(
    execution: Execution<unknown, unknown>,
    task: ITask<unknown, Promise<unknown>, any, any, any, any>,
    executionLockState: ExecutionLockState,
  ): Promise<void> {
    const assertLockOwnership = (): void => {
      if (executionLockState.lost) {
        durableExecutionInvariantError.throw({
          message: `Execution lock lost for '${execution.id}' while the attempt was still running.`,
        });
      }
    };
    const raceWithLockLoss = async <T>(promise: Promise<T>): Promise<T> =>
      await Promise.race([promise, executionLockState.waitForLoss]);

    const isCancelled = async (): Promise<boolean> => {
      const current = await this.config.store.getExecution(execution.id);
      return current?.status === ExecutionStatus.Cancelled;
    };

    assertLockOwnership();

    if (await isCancelled()) return;

    if (!this.config.taskExecutor) {
      durableExecutionInvariantError.throw({
        message:
          "DurableService cannot run executions without `taskExecutor` in config.",
      });
    }

    let runningExecution = execution;
    if (execution.status !== ExecutionStatus.Running) {
      const now = new Date();
      const nextRunningExecution: Execution = {
        ...execution,
        status: ExecutionStatus.Running,
        result: undefined,
        error: undefined,
        completedAt: undefined,
        updatedAt: now,
      };
      const started = await this.config.store.saveExecutionIfStatus(
        nextRunningExecution,
        [execution.status],
      );
      if (!started) {
        return;
      }

      runningExecution = nextRunningExecution;
      await this.auditLogger.log({
        kind: DurableAuditEntryKind.ExecutionStatusChanged,
        executionId: execution.id,
        taskId: execution.taskId,
        attempt: execution.attempt,
        from: execution.status,
        to: ExecutionStatus.Running,
        reason: "start_attempt",
      });
    }

    const context = new DurableContext(
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
      },
    );
    const failExecution = async (
      reason: "failed" | "timed_out",
      error: {
        message: string;
        stack?: string;
      },
    ): Promise<void> => {
      await this.transitionExecutionToFailed({
        execution: runningExecution,
        from: ExecutionStatus.Running,
        reason,
        error,
      });
    };

    try {
      const contextProvider =
        this.config.contextProvider ?? ((_ctx, fn) => fn());
      const promise = Promise.resolve(
        contextProvider(context, () =>
          this.config.taskExecutor!.run(task, runningExecution.input),
        ),
      );
      const timeoutMessage = `Execution ${runningExecution.id} timed out`;

      let result: unknown;
      if (runningExecution.timeout) {
        const now = Date.now();
        const elapsed = now - runningExecution.createdAt.getTime();
        const remainingTimeout = Math.max(
          0,
          runningExecution.timeout - elapsed,
        );

        if (remainingTimeout === 0 && runningExecution.timeout > 0) {
          await failExecution("timed_out", {
            message: timeoutMessage,
          });
          return;
        }

        result = await raceWithLockLoss(
          withTimeout(promise, remainingTimeout, timeoutMessage),
        );
      } else {
        result = await raceWithLockLoss(promise);
      }

      assertLockOwnership();

      // Cancellation wins over completion.
      if (await isCancelled()) return;

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
      await this.auditLogger.log({
        kind: DurableAuditEntryKind.ExecutionStatusChanged,
        executionId: runningExecution.id,
        taskId: runningExecution.taskId,
        attempt: runningExecution.attempt,
        from: ExecutionStatus.Running,
        to: ExecutionStatus.Completed,
        reason: "completed",
      });
      await this.notifyExecutionFinished(finishedExecution);
    } catch (error) {
      if (error === executionLockState.lossError) {
        return;
      }
      if (executionLockState.lost) {
        return;
      }

      if (error instanceof SuspensionSignal) {
        assertLockOwnership();
        if (await isCancelled()) return;
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
        await this.auditLogger.log({
          kind: DurableAuditEntryKind.ExecutionStatusChanged,
          executionId: runningExecution.id,
          taskId: runningExecution.taskId,
          attempt: runningExecution.attempt,
          from: ExecutionStatus.Running,
          to: ExecutionStatus.Sleeping,
          reason: `suspend:${error.reason}`,
        });
        return;
      }

      if (
        error instanceof Error &&
        error.message.startsWith("Compensation failed")
      ) {
        return;
      }

      // Cancellation wins over failure/retry scheduling.
      if (await isCancelled()) return;

      const errorInfo = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      const timedOut = isTimeoutExceededError(error);

      if (
        timedOut ||
        runningExecution.attempt >= runningExecution.maxAttempts
      ) {
        assertLockOwnership();
        await failExecution(timedOut ? "timed_out" : "failed", errorInfo);
        return;
      }

      const delayMs = Math.pow(2, runningExecution.attempt) * 1000;
      const fireAt = new Date(Date.now() + delayMs);
      const retryTimerId = `retry:${runningExecution.id}:${runningExecution.attempt}`;

      assertLockOwnership();
      await this.config.store.createTimer({
        id: retryTimerId,
        executionId: runningExecution.id,
        type: TimerType.Retry,
        fireAt,
        status: TimerStatus.Pending,
      });

      const retryingExecution: Execution = {
        ...runningExecution,
        status: ExecutionStatus.Retrying,
        attempt: runningExecution.attempt + 1,
        error: errorInfo,
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
      await this.auditLogger.log({
        kind: DurableAuditEntryKind.ExecutionStatusChanged,
        executionId: runningExecution.id,
        taskId: runningExecution.taskId,
        attempt: runningExecution.attempt,
        from: ExecutionStatus.Running,
        to: ExecutionStatus.Retrying,
        reason: "retry_scheduled",
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
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.ExecutionStatusChanged,
      executionId: params.execution.id,
      taskId: params.execution.taskId,
      attempt: params.execution.attempt,
      from: params.from,
      to: ExecutionStatus.Failed,
      reason: params.reason,
    });
    await this.notifyExecutionFinished(failedExecution);
  }
}
