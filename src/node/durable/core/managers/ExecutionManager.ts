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
import type { DurableContext } from "../DurableContext";
import { acquireStoreLock } from "../locking";
import { createExecutionId, sleepMs } from "../utils";
import { durableExecutionInvariantError } from "../../../../errors";
import { NoopEventBus } from "../../bus/NoopEventBus";
import {
  type ExecutionLockState,
  createExecutionLockState,
  assertStoreLockOwnership,
  startLockHeartbeat,
} from "./ExecutionManager.locking";
import {
  type ExecutionCancellationState,
  resolveCancellationReason,
  getCancellationState,
  publishExecutionCancellationRequested,
  startExecutionCancellationPollingFallback,
  startLiveExecutionCancellationListener,
  finalizeCancellationIfRequested,
  transitionRunningExecutionToCancelled as transitionRunningToCancelledFn,
} from "./ExecutionManager.cancellation";
import { resolveExecutionWaiters } from "./ExecutionManager.waiters";
import {
  transitionExecutionToRunning as transitionToRunningFn,
  transitionExecutionToFailed as transitionToFailedFn,
  completeExecutionAttempt as completeAttemptFn,
  suspendExecutionAttempt as suspendAttemptFn,
  scheduleExecutionRetry as scheduleRetryFn,
} from "./ExecutionManager.transitions";
import {
  type ExecutionAttemptGuards,
  type TaskAttemptOutcome,
  type ExecutionErrorInfo,
  createExecutionAttemptGuards as createGuardsFn,
  createExecutionContext as createContextFn,
  runTaskAttempt as runTaskAttemptFn,
  handleExecutionAttemptError as handleAttemptErrorFn,
} from "./ExecutionManager.attempt";

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
  private readonly activeAttemptControllers = new Map<
    string,
    AbortController
  >();
  private liveCancellationListenerStop: (() => Promise<void>) | null = null;
  private readonly eventBus: IEventBus;
  private readonly liveCancellationEventBus: IEventBus | null;
  private readonly logger: Logger;

  constructor(
    private readonly config: ExecutionManagerConfig,
    private readonly taskRegistry: TaskRegistry,
    private readonly auditLogger: AuditLogger,
    private readonly waitManager: WaitManager,
  ) {
    this.eventBus = this.config.eventBus ?? new NoopEventBus();
    this.liveCancellationEventBus =
      this.config.eventBus && !(this.config.eventBus instanceof NoopEventBus)
        ? this.config.eventBus
        : null;
    const baseLogger =
      this.config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    this.logger = baseLogger.with({ source: "durable.execution" });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async startLiveCancellationListener(): Promise<void> {
    const eventBus = this.liveCancellationEventBus;
    if (!eventBus || this.liveCancellationListenerStop) {
      return;
    }

    try {
      this.liveCancellationListenerStop =
        await startLiveExecutionCancellationListener({
          eventBus,
          abortActiveAttempt: (executionId, reason) =>
            this.abortActiveAttempt(executionId, reason),
        });
    } catch (error) {
      this.liveCancellationListenerStop = null;
      try {
        await this.logger.warn(
          "Durable live cancellation listener failed to start; falling back to per-attempt polling.",
          { error },
        );
      } catch {
        // Logging must not fail service startup; registration falls back to polling.
      }
    }
  }

  async stopLiveCancellationListener(): Promise<void> {
    const stop = this.liveCancellationListenerStop;
    this.liveCancellationListenerStop = null;
    if (!stop) {
      return;
    }

    await stop();
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
      return await this.startWithIdempotencyKey(
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
    return { durable: { executionId }, data };
  }

  async cancelExecution(executionId: string, reason?: string): Promise<void> {
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const execution = await this.config.store.getExecution(executionId);
      if (!execution) return;
      if (this.isExecutionTerminal(execution.status)) return;
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
      const saved = await this.config.store.saveExecutionIfStatus(
        nextExecution,
        [execution.status],
      );
      if (!saved) {
        if (attempt < maxAttempts) {
          await sleepMs(Math.min(2 ** (attempt - 1), 25));
        }
        continue;
      }

      this.abortActiveAttempt(executionId, cancellationReason);

      if (execution.status === ExecutionStatus.Running) {
        await this.publishLiveCancellationRequested(
          executionId,
          cancellationReason,
        );
        return;
      }

      await this.logExecutionStatusChange({
        execution,
        from: execution.status,
        to: ExecutionStatus.Cancelled,
        reason: "cancelled",
      });
      await this.notifyExecutionFinished(nextExecution);
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

    const lockState = this.createExecutionLockState();
    lockState.lockId = acquiredLock.lockId;
    lockState.lockResource = lockResource;
    lockState.lockTtlMs = lockTtlMs;
    const stopHeartbeat = this.startLockHeartbeat({
      lockResource,
      lockId: acquiredLock.lockId,
      lockTtlMs,
      lockState,
    });

    try {
      const execution = await this.config.store.getExecution(executionId);
      if (!execution) return;
      if (this.isExecutionTerminal(execution.status)) return;

      if (!execution.workflowKey) {
        await this.transitionExecutionToFailed({
          execution,
          from: execution.status,
          reason: "workflow_key_missing",
          error: { message: "Execution is missing its durable workflow key." },
        });
        return;
      }

      const task = this.taskRegistry.find(execution.workflowKey);
      if (!task) {
        await this.transitionExecutionToFailed({
          execution,
          from: execution.status,
          reason: "task_not_registered",
          error: {
            message: `Task not registered for workflow key: ${execution.workflowKey}`,
          },
        });
        return;
      }

      await this.runExecutionAttempt(execution, task, lockState);
    } finally {
      stopHeartbeat();
      await acquiredLock.release();
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

  async recoverExecution(executionId: string): Promise<void> {
    await this.kickoffWithFailsafe(executionId);
  }

  async notifyExecutionFinished(execution: Execution): Promise<void> {
    await resolveExecutionWaiters({
      store: this.config.store,
      execution,
      kickoffExecution: (id) => this.kickoffExecution(id),
      logger: this.logger,
    });

    try {
      await this.eventBus.publish(`execution:${execution.id}`, {
        type: "finished",
        payload: {
          executionId: execution.id,
          status: execution.status,
        },
        timestamp: new Date(),
      });
    } catch (error) {
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
        current: undefined,
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

  // ─── Execution attempt orchestration ───────────────────────────────────────

  async runExecutionAttempt(
    execution: Execution<unknown, unknown>,
    task: ITask<unknown, Promise<unknown>, any, any, any, any>,
    executionLockState: ExecutionLockState,
  ): Promise<void> {
    const guards = this.createExecutionAttemptGuards(
      execution.id,
      executionLockState,
    );
    guards.assertLockOwnership();

    const initialCancellation = await guards.getCancellationState();
    if (initialCancellation) {
      if (
        execution.status === ExecutionStatus.Running ||
        execution.status === ExecutionStatus.Cancelling
      ) {
        await this.transitionRunningExecutionToCancelled({
          execution,
          reason: initialCancellation.reason,
          canPersistOutcome: guards.canPersistOutcome,
        });
      }
      return;
    }

    this.assertTaskExecutorConfigured();

    const runningExecution =
      (await this.transitionExecutionToRunning(execution)) ?? null;
    if (!runningExecution) return;

    const attemptCancellation = await this.registerAttemptCancellation({
      executionId: runningExecution.id,
    });

    const context = this.createExecutionContext(
      runningExecution,
      task,
      guards.assertLockOwnership,
      attemptCancellation.signal,
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
      if (outcome.kind === "already-finalized") return;

      const cancellationState = await guards.getCancellationState();
      if (cancellationState) {
        await this.transitionRunningExecutionToCancelled({
          execution: runningExecution,
          reason: cancellationState.reason,
          canPersistOutcome: guards.canPersistOutcome,
        });
        return;
      }

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
    } finally {
      attemptCancellation.stop();
    }
  }

  // ─── Delegate wrappers (preserve internal method names for testability) ────

  private createExecutionLockState(): ExecutionLockState {
    return createExecutionLockState();
  }

  private async assertStoreLockOwnership(
    lockState: ExecutionLockState,
  ): Promise<void> {
    await assertStoreLockOwnership({
      store: this.config.store,
      lockState,
    });
  }

  private startLockHeartbeat(params: {
    lockResource: string;
    lockId: string | "no-lock";
    lockTtlMs: number;
    lockState: ExecutionLockState;
  }): () => void {
    return startLockHeartbeat({ store: this.config.store, ...params });
  }

  private getCancellationState(
    execution: Execution<unknown, unknown> | null,
  ): ExecutionCancellationState | null {
    return getCancellationState(execution);
  }

  private createExecutionAttemptGuards(
    executionId: string,
    lockState: ExecutionLockState,
  ): ExecutionAttemptGuards {
    return createGuardsFn({
      executionId,
      lockState,
      store: this.config.store,
      assertStoreLockOwnership: (ls) => this.assertStoreLockOwnership(ls),
      getCancellationState: (exec) => this.getCancellationState(exec),
    });
  }

  private createExecutionContext(
    execution: Execution<unknown, unknown>,
    task: ITask<unknown, Promise<unknown>, any, any, any, any>,
    assertLockOwnership: () => void,
    cancellationSignal: AbortSignal,
  ): DurableContext {
    return createContextFn({
      store: this.config.store,
      eventBus: this.eventBus,
      execution,
      task,
      assertLockOwnership,
      cancellationSignal,
      auditConfig: this.config.audit,
      determinismConfig: this.config.determinism,
      startExecution: (childTask, input, options) =>
        this.start(childTask, input, options),
      getTaskWorkflowKey: (t) => this.getTaskWorkflowKey(t),
    });
  }

  private async runTaskAttempt(params: {
    task: ITask<unknown, Promise<unknown>, any, any, any, any>;
    input: unknown;
    context: DurableContext;
    execution: Execution<unknown, unknown>;
    raceWithLockLoss: <T>(promise: Promise<T>) => Promise<T>;
    canPersistOutcome: () => Promise<boolean>;
  }): Promise<TaskAttemptOutcome> {
    this.assertTaskExecutorConfigured();
    return runTaskAttemptFn({
      ...params,
      taskExecutor: this.config.taskExecutor!,
      contextProvider: this.config.contextProvider,
      transitionToFailed: (p) => this.transitionExecutionToFailed(p),
    });
  }

  private async handleExecutionAttemptError(params: {
    error: unknown;
    runningExecution: Execution<unknown, unknown>;
    guards: ExecutionAttemptGuards;
    executionLockState: ExecutionLockState;
  }): Promise<void> {
    await handleAttemptErrorFn({
      ...params,
      transitionToCancelled: (p) =>
        this.transitionRunningExecutionToCancelled(p),
      transitionToFailed: (p) => this.transitionExecutionToFailed(p),
      suspendAttempt: (exec, reason, can) =>
        this.suspendExecutionAttempt(exec, reason, can),
      scheduleRetry: (p) => this.scheduleExecutionRetry(p),
    });
  }

  private async transitionExecutionToRunning(
    execution: Execution<unknown, unknown>,
  ): Promise<Execution<unknown, unknown> | null> {
    return transitionToRunningFn({
      store: this.config.store,
      execution,
      logStatusChange: (p) => this.logExecutionStatusChange(p),
    });
  }

  private async transitionExecutionToFailed(params: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus;
    reason:
      | "failed"
      | "timed_out"
      | "workflow_key_missing"
      | "task_not_registered"
      | "delivery_attempts_exhausted";
    error: { message: string; stack?: string };
  }): Promise<void> {
    await transitionToFailedFn({
      store: this.config.store,
      ...params,
      logStatusChange: (p) => this.logExecutionStatusChange(p),
      notifyFinished: (e) => this.notifyExecutionFinished(e),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  private async transitionRunningExecutionToCancelled(params: {
    execution: Execution<unknown, unknown>;
    reason: string;
    canPersistOutcome?: () => Promise<boolean>;
  }): Promise<void> {
    await transitionRunningToCancelledFn({
      store: this.config.store,
      ...params,
      logStatusChange: (p) => this.logExecutionStatusChange(p),
      notifyFinished: (e) => this.notifyExecutionFinished(e),
    });
  }

  private async completeExecutionAttempt(
    execution: Execution<unknown, unknown>,
    result: unknown,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<void> {
    await completeAttemptFn({
      store: this.config.store,
      execution,
      result,
      canPersistOutcome,
      logStatusChange: (p) => this.logExecutionStatusChange(p),
      notifyFinished: (e) => this.notifyExecutionFinished(e),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  private async suspendExecutionAttempt(
    execution: Execution<unknown, unknown>,
    reason: string,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<void> {
    await suspendAttemptFn({
      store: this.config.store,
      execution,
      reason,
      canPersistOutcome,
      logStatusChange: (p) => this.logExecutionStatusChange(p),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  private async scheduleExecutionRetry(params: {
    runningExecution: Execution<unknown, unknown>;
    error: ExecutionErrorInfo;
    canPersistOutcome?: () => Promise<boolean>;
  }): Promise<void> {
    await scheduleRetryFn({
      store: this.config.store,
      ...params,
      logStatusChange: (p) => this.logExecutionStatusChange(p),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  private async finalizeCancellationIfRequested(
    execution: Execution<unknown, unknown>,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<boolean> {
    return finalizeCancellationIfRequested({
      store: this.config.store,
      executionId: execution.id,
      canPersistOutcome,
      transitionToCancelled: (p) =>
        this.transitionRunningExecutionToCancelled(p),
    });
  }

  // ─── Internal utilities ────────────────────────────────────────────────────

  private startExecutionCancellationPollingFallback(params: {
    executionId: string;
    controller: AbortController;
  }): () => void {
    return startExecutionCancellationPollingFallback({
      ...params,
      store: this.config.store,
      abortActiveAttempt: (id, r) => this.abortActiveAttempt(id, r),
    });
  }

  private abortActiveAttempt(executionId: string, reason: string): void {
    const controller = this.activeAttemptControllers.get(executionId);
    if (!controller || controller.signal.aborted) return;
    controller.abort(reason);
  }

  private async registerAttemptCancellation(params: {
    executionId: string;
  }): Promise<{
    signal: AbortSignal;
    stop: () => void;
  }> {
    const controller = new AbortController();
    this.activeAttemptControllers.set(params.executionId, controller);
    let stopWatcher: (() => void) | undefined;

    if (this.liveCancellationListenerStop) {
      try {
        const execution = await this.config.store.getExecution(
          params.executionId,
        );
        const cancellationState = this.getCancellationState(execution);
        if (cancellationState) {
          this.abortActiveAttempt(params.executionId, cancellationState.reason);
        }
      } catch (error) {
        try {
          await this.logger.warn(
            "Durable live cancellation recheck failed; falling back to per-attempt polling.",
            {
              executionId: params.executionId,
              error,
            },
          );
        } catch {
          // Logging must not affect cancellation propagation fallback.
        }

        if (!controller.signal.aborted) {
          stopWatcher = this.startExecutionCancellationPollingFallback({
            executionId: params.executionId,
            controller,
          });
        }
      }
    } else {
      stopWatcher = this.startExecutionCancellationPollingFallback({
        executionId: params.executionId,
        controller,
      });
    }

    return {
      signal: controller.signal,
      stop: () => {
        stopWatcher?.();
        if (
          this.activeAttemptControllers.get(params.executionId) === controller
        ) {
          this.activeAttemptControllers.delete(params.executionId);
        }
      },
    };
  }

  private assertCanExecute(): void {
    if (!this.config.queue && !this.config.taskExecutor) {
      durableExecutionInvariantError.throw({
        message:
          "DurableService requires `taskExecutor` to execute Runner tasks (when no queue is configured). Use a Runner durable workflow resource such as `resources.memoryWorkflow.fork(...).with(...)` or provide a custom executor in config.",
      });
    }
  }

  private assertTaskExecutorConfigured(): void {
    if (!this.config.taskExecutor) {
      durableExecutionInvariantError.throw({
        message:
          "DurableService cannot run executions without `taskExecutor` in config.",
      });
    }
  }

  private getTaskWorkflowKey(
    task: ITask<any, Promise<any>, any, any, any, any>,
  ): string {
    return this.taskRegistry.getWorkflowKey(task);
  }

  private async publishLiveCancellationRequested(
    executionId: string,
    reason: string,
  ): Promise<void> {
    const eventBus = this.liveCancellationEventBus;
    if (!eventBus) {
      return;
    }

    try {
      await publishExecutionCancellationRequested({
        eventBus,
        executionId,
        reason,
      });
    } catch (error) {
      try {
        await this.logger.warn(
          "Durable live cancellation publish failed; relying on local abort or polling fallback.",
          {
            executionId,
            error,
          },
        );
      } catch {
        // Logging must not affect durable cancellation semantics.
      }
    }
  }

  private resolveTaskReference(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    apiMethod: string,
  ): ITask<any, Promise<any>, any, any, any, any> {
    if (typeof taskRef !== "string") return taskRef;

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

  private shouldKickoffExistingIdempotentExecution(
    status: ExecutionStatus,
  ): boolean {
    return (
      status === ExecutionStatus.Pending || status === ExecutionStatus.Retrying
    );
  }

  // ─── Execution persistence ─────────────────────────────────────────────────

  private createPendingExecution(
    task: ITask<any, Promise<any>, any, any, any, any>,
    input: unknown | undefined,
    options: ExecuteOptions | undefined,
    executionId?: string,
  ): Execution<unknown, unknown> {
    return {
      id: executionId ?? createExecutionId(),
      workflowKey: this.getTaskWorkflowKey(task),
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
      workflowKey: execution.workflowKey,
      attempt: execution.attempt,
      from: null,
      to: ExecutionStatus.Pending,
      reason: "created",
    });
  }

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

  private async logExecutionStatusChange(params: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus | null;
    to: ExecutionStatus;
    reason: string;
  }): Promise<void> {
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.ExecutionStatusChanged,
      executionId: params.execution.id,
      workflowKey: params.execution.workflowKey,
      attempt: params.execution.attempt,
      from: params.from,
      to: params.to,
      reason: params.reason,
    });
  }

  // ─── Kickoff & idempotency ─────────────────────────────────────────────────

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

  private async startWithIdempotencyKey(
    task: ITask<any, Promise<any>, any, any, any, any>,
    input: unknown | undefined,
    idempotencyKey: string,
    options: ExecuteOptions | undefined,
  ): Promise<string> {
    const execution = this.createPendingExecution(task, input, options);
    const created = await this.config.store.createExecutionWithIdempotencyKey({
      execution,
      workflowKey: this.getTaskWorkflowKey(task),
      idempotencyKey,
    });

    if (!created.created) {
      const existing = await this.config.store.getExecution(
        created.executionId,
      );
      if (
        existing &&
        this.shouldKickoffExistingIdempotentExecution(existing.status)
      ) {
        await this.kickoffWithFailsafe(created.executionId);
      }
      return created.executionId;
    }

    await this.logCreatedExecution(execution);
    await this.kickoffWithFailsafe(execution.id);
    return execution.id;
  }
}
