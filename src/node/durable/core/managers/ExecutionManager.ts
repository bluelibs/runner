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
import type { Execution } from "../types";
import type { TaskRegistry } from "./TaskRegistry";
import type { AuditLogger } from "./AuditLogger";
import type { WaitManager } from "./WaitManager";
import { Logger } from "../../../../models/Logger";
import { durableExecutionInvariantError } from "../../../../errors";
import { NoopEventBus } from "../../bus/NoopEventBus";
import { resolveExecutionWaiters } from "./ExecutionManager.waiters";
import { AttemptCancellationController } from "./AttemptCancellationController";
import { ExecutionAttemptRunner } from "./ExecutionAttemptRunner";
import {
  type ExecutionPersistenceDeps,
  persistNewExecution,
  startWithIdempotencyKey,
  kickoffWithFailsafe,
} from "./ExecutionManager.persistence";
import {
  type ExecutionTerminalDeps,
  cancelExecution as cancelExecutionFlow,
  failExecutionDeliveryExhausted as failExecutionDeliveryExhaustedFlow,
} from "./ExecutionManager.terminal";

type AnyTask = ITask<any, Promise<any>, any, any, any, any>;

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
 * Coordinates durable executions: exposes the service-facing API (start, wait,
 * cancel, recover, kickoff) and wires the collaborators that do the work.
 *
 * Responsibilities are split across:
 * - {@link ExecutionAttemptRunner} — runs a single attempt under a store lock.
 * - {@link AttemptCancellationController} — live abort controllers + shutdown latch.
 * - `ExecutionManager.persistence` — create/persist/idempotency/kickoff helpers.
 * - `ExecutionManager.terminal` — cancellation and delivery-exhaustion flows.
 */
export class ExecutionManager {
  private readonly eventBus: IEventBus;
  private readonly logger: Logger;
  /** Exposed for unit tests that drive cancellation bookkeeping directly. */
  readonly cancellation: AttemptCancellationController;
  /** Exposed for unit tests that drive attempt orchestration directly. */
  readonly attemptRunner: ExecutionAttemptRunner;
  private readonly persistenceDeps: ExecutionPersistenceDeps;
  private readonly terminalDeps: ExecutionTerminalDeps;

  constructor(
    private readonly config: ExecutionManagerConfig,
    private readonly taskRegistry: TaskRegistry,
    private readonly auditLogger: AuditLogger,
    private readonly waitManager: WaitManager,
  ) {
    this.eventBus = this.config.eventBus ?? new NoopEventBus();
    const liveCancellationEventBus =
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

    this.cancellation = new AttemptCancellationController({
      store: this.config.store,
      logger: this.logger,
      liveCancellationEventBus,
    });

    this.attemptRunner = new ExecutionAttemptRunner({
      store: this.config.store,
      eventBus: this.eventBus,
      taskRegistry: this.taskRegistry,
      auditLogger: this.auditLogger,
      cancellation: this.cancellation,
      taskExecutor: this.config.taskExecutor,
      contextProvider: this.config.contextProvider,
      audit: this.config.audit,
      determinism: this.config.determinism,
      notifyFinished: (execution) => this.notifyExecutionFinished(execution),
      startExecution: (task, input, options) =>
        this.start(task, input, options),
      getTaskWorkflowKey: (task) => this.getTaskWorkflowKey(task),
      assertTaskExecutorConfigured: () => this.assertTaskExecutorConfigured(),
    });

    this.persistenceDeps = {
      store: this.config.store,
      queue: this.config.queue,
      auditLogger: this.auditLogger,
      getTaskWorkflowKey: (task) => this.getTaskWorkflowKey(task),
      maxAttempts: this.config.execution?.maxAttempts ?? 3,
      defaultTimeout: this.config.execution?.timeout,
      kickoffFailsafeDelayMs:
        this.config.execution?.kickoffFailsafeDelayMs ?? 10_000,
      kickoffExecution: (executionId) => this.kickoffExecution(executionId),
    };

    this.terminalDeps = {
      store: this.config.store,
      auditLogger: this.auditLogger,
      abortActiveAttempt: (executionId, reason) =>
        this.cancellation.abortActiveAttempt(executionId, reason),
      publishLiveCancellationRequested: (executionId, reason) =>
        this.cancellation.publishLiveCancellationRequested(executionId, reason),
      notifyFinished: (execution) => this.notifyExecutionFinished(execution),
    };
  }

  // ─── Lifecycle / cancellation control (delegated) ──────────────────────────

  async startLiveCancellationListener(): Promise<void> {
    await this.cancellation.startListener();
  }

  async stopLiveCancellationListener(): Promise<void> {
    await this.cancellation.stopListener();
  }

  interruptActiveAttempts(reason?: string): void {
    this.cancellation.interruptActiveAttempts(reason);
  }

  // ─── Public execution API ──────────────────────────────────────────────────

  async start(
    taskRef: string | AnyTask,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<string> {
    const task = this.resolveTaskReference(taskRef, "start");
    this.taskRegistry.register(task);
    this.assertCanExecute();

    if (options?.idempotencyKey) {
      return await startWithIdempotencyKey(
        this.persistenceDeps,
        task,
        input,
        options.idempotencyKey,
        options,
      );
    }

    const executionId = await persistNewExecution(
      this.persistenceDeps,
      task,
      input,
      options,
    );
    await kickoffWithFailsafe(this.persistenceDeps, executionId);
    return executionId;
  }

  async startAndWait(
    taskRef: string | AnyTask,
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
    await cancelExecutionFlow(this.terminalDeps, executionId, reason);
  }

  async processExecution(executionId: string): Promise<void> {
    await this.attemptRunner.processExecution(executionId);
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
    await kickoffWithFailsafe(this.persistenceDeps, executionId);
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
    await failExecutionDeliveryExhaustedFlow(
      this.terminalDeps,
      executionId,
      details,
    );
  }

  // ─── Internal utilities ────────────────────────────────────────────────────

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

  private getTaskWorkflowKey(task: AnyTask): string {
    return this.taskRegistry.getWorkflowKey(task);
  }

  private resolveTaskReference(
    taskRef: string | AnyTask,
    apiMethod: string,
  ): AnyTask {
    if (typeof taskRef !== "string") return taskRef;

    const resolved = this.taskRegistry.find(taskRef);
    if (!resolved) {
      durableExecutionInvariantError.throw({
        message: `DurableService.${apiMethod}() could not resolve task id "${taskRef}". Ensure the task is registered in the runtime store.`,
      });
    }
    return resolved!;
  }
}
