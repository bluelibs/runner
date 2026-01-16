import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventBus } from "../interfaces/bus";
import type {
  DurableServiceConfig,
  DurableTask,
  ExecuteOptions,
  ITaskExecutor,
} from "../interfaces/service";
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
import { createExecutionId, withTimeout } from "../utils";

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
 * Manages durable execution lifecycle: start, process, retry, complete.
 */
export class ExecutionManager {
  constructor(
    private readonly config: ExecutionManagerConfig,
    private readonly taskRegistry: TaskRegistry,
    private readonly auditLogger: AuditLogger,
    private readonly waitManager: WaitManager,
  ) {}

  async startExecution<TInput>(
    task: DurableTask<TInput, unknown>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<string> {
    this.taskRegistry.register(task);

    if (!this.config.queue && !this.config.taskExecutor) {
      throw new Error(
        "DurableService requires `taskExecutor` to execute Runner tasks (when no queue is configured). Use `durableResource.fork(...).with(...)` in a Runner runtime, or provide a custom executor in config.",
      );
    }

    const executionId = createExecutionId();
    const execution: Execution<TInput, unknown> = {
      id: executionId,
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
      executionId,
      taskId: task.id,
      attempt: execution.attempt,
      from: null,
      to: ExecutionStatus.Pending,
      reason: "created",
    });

    const kickoffTimerId = `kickoff:${executionId}`;
    const kickoffFailsafeDelayMs =
      this.config.execution?.kickoffFailsafeDelayMs ?? 10_000;
    const shouldArmKickoffFailsafe =
      Boolean(this.config.queue) && kickoffFailsafeDelayMs > 0;

    if (shouldArmKickoffFailsafe) {
      await this.config.store.createTimer({
        id: kickoffTimerId,
        executionId,
        type: TimerType.Retry,
        fireAt: new Date(Date.now() + kickoffFailsafeDelayMs),
        status: TimerStatus.Pending,
      });
    }

    try {
      await this.kickoffExecution(executionId);
      if (shouldArmKickoffFailsafe) {
        try {
          await this.config.store.deleteTimer(kickoffTimerId);
        } catch {
          // Best-effort cleanup; ignore.
        }
      }
    } catch (error) {
      // If enqueue fails, keep the failsafe timer so the poller can retry.
      throw error;
    }

    return executionId;
  }

  async execute<TInput, TResult>(
    task: DurableTask<TInput, TResult>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<TResult> {
    const executionId = await this.startExecution(task, input, options);
    return await this.waitManager.waitForResult<TResult>(executionId, {
      timeout: options?.timeout,
      waitPollIntervalMs: options?.waitPollIntervalMs,
    });
  }

  async executeStrict<TInput, TResult>(
    task: undefined extends TResult ? never : DurableTask<TInput, TResult>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<TResult> {
    const actualTask: DurableTask<TInput, TResult> = task;
    return await this.execute(actualTask, input, options);
  }

  async processExecution(executionId: string): Promise<void> {
    const execution = await this.config.store.getExecution(executionId);
    if (!execution) return;
    if (
      execution.status === ExecutionStatus.Completed ||
      execution.status === ExecutionStatus.Failed
    )
      return;

    const task = this.taskRegistry.find(execution.taskId);
    if (!task) {
      await this.config.store.updateExecution(execution.id, {
        status: ExecutionStatus.Failed,
        error: { message: `Task not registered: ${execution.taskId}` },
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
    task: DurableTask<unknown, unknown>,
  ): Promise<void> {
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
}
