import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventBus } from "../interfaces/bus";
import type {
  DurableStartAndWaitResult,
  DurableServiceConfig,
  ExecuteOptions,
  ITaskExecutor,
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
import { DurableContext } from "../DurableContext";
import { SuspensionSignal } from "../interfaces/context";
import { createExecutionId, sleepMs, withTimeout } from "../utils";

export interface ExecutionManagerConfig {
  store: IDurableStore;
  queue?: IDurableQueue;
  eventBus?: IEventBus;
  taskExecutor?: ITaskExecutor;
  contextProvider?: DurableServiceConfig["contextProvider"];
  audit?: DurableServiceConfig["audit"];
  determinism?: DurableServiceConfig["determinism"];
  execution?: {
    maxAttempts?: number;
    timeout?: number;
    kickoffFailsafeDelayMs?: number;
  };
}

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
  constructor(
    private readonly config: ExecutionManagerConfig,
    private readonly taskRegistry: TaskRegistry,
    private readonly auditLogger: AuditLogger,
    private readonly waitManager: WaitManager,
  ) {}

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
   * a duplicate. Uses a distributed lock to prevent concurrent races.
   */
  private async startWithIdempotencyKey(
    task: ITask<any, Promise<any>, any, any, any, any>,
    input: unknown | undefined,
    idempotencyKey: string,
    options: ExecuteOptions | undefined,
  ): Promise<string> {
    this.assertStoreSupportsIdempotency();

    return this.withIdempotencyLock(task.id, idempotencyKey, async () => {
      // Fast path: key already claimed by a previous caller
      const existingId = await this.config.store
        .getExecutionIdByIdempotencyKey!({
        taskId: task.id,
        idempotencyKey,
      });
      if (existingId) return existingId;

      // Claim the key for a new execution
      const executionId = createExecutionId();
      const claimed = await this.config.store.setExecutionIdByIdempotencyKey!({
        taskId: task.id,
        idempotencyKey,
        executionId,
      });

      if (!claimed) {
        return this.resolveRacedIdempotencyKey(task.id, idempotencyKey);
      }

      await this.persistNewExecution(task, input, options, executionId);
      await this.kickoffExecution(executionId);
      return executionId;
    });
  }

  private assertCanExecute(): void {
    if (!this.config.queue && !this.config.taskExecutor) {
      throw new Error(
        "DurableService requires `taskExecutor` to execute Runner tasks (when no queue is configured). Use `durableResource.fork(...).with(...)` in a Runner runtime, or provide a custom executor in config.",
      );
    }
  }

  private assertStoreSupportsIdempotency(): void {
    if (
      !this.config.store.getExecutionIdByIdempotencyKey ||
      !this.config.store.setExecutionIdByIdempotencyKey
    ) {
      throw new Error(
        "Durable store does not support execution idempotency keys. Implement getExecutionIdByIdempotencyKey/setExecutionIdByIdempotencyKey on the store to use ExecuteOptions.idempotencyKey.",
      );
    }
  }

  /**
   * Acquires a distributed lock around the idempotency check-and-set,
   * falling back to lock-free operation when the store has no locking support.
   */
  private async withIdempotencyLock<T>(
    taskId: string,
    idempotencyKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const canLock =
      !!this.config.store.acquireLock && !!this.config.store.releaseLock;
    if (!canLock) return fn();

    const lockResource = `idempotency:${taskId}:${idempotencyKey}`;
    const lockTtlMs = 10_000;
    const maxAttempts = 50;

    let lockId: string | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      lockId = await this.config.store.acquireLock!(lockResource, lockTtlMs);
      if (lockId !== null) break;
      await sleepMs(5);
    }

    if (lockId === null) {
      throw new Error(
        `Failed to acquire idempotency lock for '${taskId}:${idempotencyKey}'`,
      );
    }

    try {
      return await fn();
    } finally {
      try {
        await this.config.store.releaseLock!(lockResource, lockId);
      } catch {
        // best-effort cleanup; ignore
      }
    }
  }

  /**
   * Recovery path: `setExecutionIdByIdempotencyKey` returned false (another
   * writer won the race), so we re-read the mapping to get their executionId.
   */
  private async resolveRacedIdempotencyKey(
    taskId: string,
    idempotencyKey: string,
  ): Promise<string> {
    const racedId = await this.config.store.getExecutionIdByIdempotencyKey!({
      taskId,
      idempotencyKey,
    });
    if (racedId) return racedId;

    throw new Error(
      "Failed to set idempotency mapping but no existing mapping found.",
    );
  }

  // ─── Execution persistence ─────────────────────────────────────────────────

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
    const id = executionId ?? createExecutionId();
    const execution: Execution<unknown, unknown> = {
      id,
      taskId: task.id,
      input,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: this.config.execution?.maxAttempts ?? 3,
      timeout: options?.timeout ?? this.config.execution?.timeout,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.config.store.saveExecution(execution);
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.ExecutionStatusChanged,
      executionId: id,
      taskId: task.id,
      attempt: execution.attempt,
      from: null,
      to: ExecutionStatus.Pending,
      reason: "created",
    });

    return id;
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
    const execution = await this.config.store.getExecution(executionId);
    if (!execution) return;

    if (
      execution.status === ExecutionStatus.Completed ||
      execution.status === ExecutionStatus.Failed ||
      execution.status === ExecutionStatus.CompensationFailed ||
      execution.status === ExecutionStatus.Cancelled
    ) {
      return;
    }

    const now = new Date();
    await this.config.store.updateExecution(executionId, {
      status: ExecutionStatus.Cancelled,
      cancelRequestedAt: execution.cancelRequestedAt ?? now,
      cancelledAt: now,
      completedAt: now,
      error: { message: reason ?? "Execution cancelled" },
    });

    await this.auditLogger.log({
      kind: DurableAuditEntryKind.ExecutionStatusChanged,
      executionId,
      taskId: execution.taskId,
      attempt: execution.attempt,
      from: execution.status,
      to: ExecutionStatus.Cancelled,
      reason: "cancelled",
    });

    await this.config.eventBus!.publish(`execution:${executionId}`, {
      type: "finished",
      payload: { ...execution, status: ExecutionStatus.Cancelled },
      timestamp: new Date(),
    });
  }

  async startAndWait(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<unknown>> {
    const executionId = await this.start(taskRef, input, options);
    const data = await this.waitManager.waitForResult(executionId, {
      timeout: options?.timeout,
      waitPollIntervalMs: options?.waitPollIntervalMs,
    });
    return {
      durable: { executionId },
      data,
    };
  }

  async processExecution(executionId: string): Promise<void> {
    const execution = await this.config.store.getExecution(executionId);
    if (!execution) return;
    if (
      execution.status === ExecutionStatus.Completed ||
      execution.status === ExecutionStatus.Failed ||
      execution.status === ExecutionStatus.CompensationFailed ||
      execution.status === ExecutionStatus.Cancelled
    )
      return;

    const task = this.taskRegistry.find(execution.taskId);
    if (!task) {
      const error = { message: `Task not registered: ${execution.taskId}` };
      const completedAt = new Date();
      await this.config.store.updateExecution(execution.id, {
        status: ExecutionStatus.Failed,
        error,
        completedAt,
      });
      await this.auditLogger.log({
        kind: DurableAuditEntryKind.ExecutionStatusChanged,
        executionId: execution.id,
        taskId: execution.taskId,
        attempt: execution.attempt,
        from: execution.status,
        to: ExecutionStatus.Failed,
        reason: "task_not_registered",
      });
      await this.notifyExecutionFinished({
        ...execution,
        status: ExecutionStatus.Failed,
        error,
        completedAt,
      });
      return;
    }

    const lockResource = `execution:${execution.id}`;
    const lockTtlMs = 30_000;
    const lockId = this.config.store.acquireLock
      ? await this.config.store.acquireLock(lockResource, lockTtlMs)
      : "no-lock";

    if (lockId === null) return;

    try {
      await this.runExecutionAttempt(execution, task);
    } finally {
      if (lockId !== "no-lock" && this.config.store.releaseLock) {
        await this.config.store.releaseLock(lockResource, lockId);
      }
    }
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
    await this.config.eventBus!.publish(`execution:${execution.id}`, {
      type: "finished",
      payload: execution,
      timestamp: new Date(),
    });
  }

  private async runExecutionAttempt(
    execution: Execution<unknown, unknown>,
    task: ITask<unknown, Promise<unknown>, any, any, any, any>,
  ): Promise<void> {
    const isCancelled = async (): Promise<boolean> => {
      const current = await this.config.store.getExecution(execution.id);
      return current?.status === ExecutionStatus.Cancelled;
    };

    if (await isCancelled()) return;

    if (!this.config.taskExecutor) {
      throw new Error(
        "DurableService cannot run executions without `taskExecutor` in config.",
      );
    }

    await this.config.store.updateExecution(execution.id, {
      status: ExecutionStatus.Running,
    });
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.ExecutionStatusChanged,
      executionId: execution.id,
      taskId: execution.taskId,
      attempt: execution.attempt,
      from: execution.status,
      to: ExecutionStatus.Running,
      reason: "start_attempt",
    });

    const context = new DurableContext(
      this.config.store,
      this.config.eventBus!,
      execution.id,
      execution.attempt,
      {
        auditEnabled: this.config.audit?.enabled === true,
        auditEmitter: this.config.audit?.emitter,
        implicitInternalStepIds:
          this.config.determinism?.implicitInternalStepIds,
      },
    );

    try {
      const contextProvider =
        this.config.contextProvider ?? ((_ctx, fn) => fn());
      const promise = Promise.resolve(
        contextProvider(context, () =>
          this.config.taskExecutor!.run(task, execution.input),
        ),
      );

      let result: unknown;
      if (execution.timeout) {
        const now = Date.now();
        const elapsed = now - execution.createdAt.getTime();
        const remainingTimeout = Math.max(0, execution.timeout - elapsed);

        if (remainingTimeout === 0 && execution.timeout > 0) {
          throw new Error(`Execution ${execution.id} timed out`);
        }

        result = await withTimeout(
          promise,
          remainingTimeout,
          `Execution ${execution.id} timed out`,
        );
      } else {
        result = await promise;
      }

      // Cancellation wins over completion.
      if (await isCancelled()) return;

      const finishedExecution: Execution = {
        ...execution,
        status: ExecutionStatus.Completed,
        result,
        completedAt: new Date(),
      };
      await this.config.store.updateExecution(execution.id, finishedExecution);
      await this.auditLogger.log({
        kind: DurableAuditEntryKind.ExecutionStatusChanged,
        executionId: execution.id,
        taskId: execution.taskId,
        attempt: execution.attempt,
        from: ExecutionStatus.Running,
        to: ExecutionStatus.Completed,
        reason: "completed",
      });
      await this.notifyExecutionFinished(finishedExecution);
    } catch (error) {
      if (error instanceof SuspensionSignal) {
        if (await isCancelled()) return;
        await this.config.store.updateExecution(execution.id, {
          status: ExecutionStatus.Sleeping,
        });
        await this.auditLogger.log({
          kind: DurableAuditEntryKind.ExecutionStatusChanged,
          executionId: execution.id,
          taskId: execution.taskId,
          attempt: execution.attempt,
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

      if (execution.attempt >= execution.maxAttempts) {
        const failedExecution: Execution = {
          ...execution,
          status: ExecutionStatus.Failed,
          error: errorInfo,
          completedAt: new Date(),
        };
        await this.config.store.updateExecution(execution.id, failedExecution);
        await this.auditLogger.log({
          kind: DurableAuditEntryKind.ExecutionStatusChanged,
          executionId: execution.id,
          taskId: execution.taskId,
          attempt: execution.attempt,
          from: ExecutionStatus.Running,
          to: ExecutionStatus.Failed,
          reason: "failed",
        });
        await this.notifyExecutionFinished(failedExecution);
        return;
      }

      const delayMs = Math.pow(2, execution.attempt) * 1000;
      const fireAt = new Date(Date.now() + delayMs);

      await this.config.store.createTimer({
        id: `retry:${execution.id}:${execution.attempt}`,
        executionId: execution.id,
        type: TimerType.Retry,
        fireAt,
        status: TimerStatus.Pending,
      });

      await this.config.store.updateExecution(execution.id, {
        status: ExecutionStatus.Retrying,
        attempt: execution.attempt + 1,
        error: errorInfo,
      });
      await this.auditLogger.log({
        kind: DurableAuditEntryKind.ExecutionStatusChanged,
        executionId: execution.id,
        taskId: execution.taskId,
        attempt: execution.attempt,
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
      throw new Error(
        `DurableService.${apiMethod}() could not resolve task id "${taskRef}". Ensure the task is registered in the runtime store.`,
      );
    }
    return resolved;
  }
}
