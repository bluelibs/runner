import { NoopEventBus } from "../bus/NoopEventBus";
import type {
  DurableStartAndWaitResult,
  DurableServiceConfig,
  ExecuteOptions,
  IDurableService,
  ScheduleOptions,
} from "./interfaces/service";
import { ExecutionStatus, type Schedule } from "./types";
import type { IEventDefinition } from "../../../types/event";
import type { ITask } from "../../../types/task";
import { createExecutionId } from "./utils";

import {
  TaskRegistry,
  AuditLogger,
  WaitManager,
  ScheduleManager,
  SignalHandler,
  ExecutionManager,
  PollingManager,
} from "./managers";
import { durableExecutionInvariantError } from "../../../errors";
import { Logger } from "../../../models/Logger";

export { DurableExecutionError } from "./utils";

/**
 * High-level facade for the Durable Workflows subsystem.
 *
 * `DurableService` glues together the durable backends (store/queue/event bus) and
 * the specialized managers that implement durable semantics:
 *
 * - `ExecutionManager` runs workflow attempts and injects `DurableContext`
 * - `SignalHandler` delivers external signals to waiting steps
 * - `WaitManager` waits for results (event-bus first, polling fallback)
 * - `ScheduleManager` creates/updates schedules and their timers
 * - `PollingManager` drives timers (sleep, retries, signal timeouts, schedules)
 * - `AuditLogger` emits/persists an audit trail (best-effort)
 *
 * `DurableResource` wraps this service for Runner integration and provides
 * `durable.use()` to read the per-execution `DurableContext`.
 */
export class DurableService implements IDurableService {
  private readonly taskRegistry: TaskRegistry;
  private readonly auditLogger: AuditLogger;
  private readonly waitManager: WaitManager;
  private readonly scheduleManager: ScheduleManager;
  private readonly signalHandler: SignalHandler;
  private readonly executionManager: ExecutionManager;
  private readonly pollingManager: PollingManager;
  private readonly logger: Logger;

  /** Unique worker ID for distributed timer coordination */
  private readonly workerId: string;

  constructor(private readonly config: DurableServiceConfig) {
    const baseLogger =
      config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    this.logger = baseLogger.with({ source: "durable.service" });
    this.workerId = config.workerId ?? createExecutionId();

    // Initialize task registry
    this.taskRegistry = new TaskRegistry(config.taskResolver);

    // Register initial tasks
    if (config.tasks) {
      for (const task of config.tasks) {
        this.taskRegistry.register(task);
      }
    }
    if (config.schedules) {
      for (const schedule of config.schedules) {
        if (typeof schedule.task === "string") {
          const resolved = this.taskRegistry.find(schedule.task);
          if (!resolved) {
            durableExecutionInvariantError.throw({
              message: `Cannot initialize durable schedule "${schedule.id}": task "${schedule.task}" is not registered.`,
            });
          }
          this.taskRegistry.register(resolved!);
          continue;
        }
        this.taskRegistry.register(schedule.task);
      }
    }

    // Initialize audit logger
    this.auditLogger = new AuditLogger(
      { enabled: config.audit?.enabled, emitter: config.audit?.emitter },
      config.store,
    );

    // Initialize wait manager
    this.waitManager = new WaitManager(config.store, config.eventBus, {
      defaultTimeout: config.execution?.timeout,
      defaultPollIntervalMs: 500,
    });

    // Initialize schedule manager
    this.scheduleManager = new ScheduleManager(config.store, this.taskRegistry);

    // Initialize execution manager
    this.executionManager = new ExecutionManager(
      {
        store: config.store,
        queue: config.queue,
        eventBus: config.eventBus ?? new NoopEventBus(),
        taskExecutor: config.taskExecutor,
        contextProvider: config.contextProvider,
        audit: config.audit,
        determinism: config.determinism,
        execution: config.execution,
      },
      this.taskRegistry,
      this.auditLogger,
      this.waitManager,
    );

    // Initialize signal handler
    this.signalHandler = new SignalHandler(
      config.store,
      this.auditLogger,
      config.queue,
      config.execution?.maxAttempts ?? 3,
      {
        processExecution: (id) => this.executionManager.processExecution(id),
      },
    );

    // Initialize polling manager
    this.pollingManager = new PollingManager(
      this.workerId,
      config.polling ?? {},
      config.store,
      config.queue,
      config.execution?.maxAttempts ?? 3,
      config.execution?.timeout,
      this.taskRegistry,
      this.auditLogger,
      this.scheduleManager,
      {
        processExecution: (id) => this.executionManager.processExecution(id),
        kickoffExecution: (id) => this.executionManager.kickoffExecution(id),
      },
      this.logger,
    );
  }

  // ─── Public API (delegating to managers) ───────────────────────────────────

  registerTask<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
  ): void {
    this.taskRegistry.register(task);
  }

  findTask(
    taskId: string,
  ): ITask<any, Promise<any>, any, any, any, any> | undefined {
    return this.taskRegistry.find(taskId);
  }

  start<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<string>;
  start(
    task: string,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<string>;
  start(): void;
  start(
    task?: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<string> | void {
    if (task === undefined) {
      this.pollingManager.start();
      return;
    }

    return this.executionManager.start(task, input, options);
  }

  async cancelExecution(executionId: string, reason?: string): Promise<void> {
    await this.executionManager.cancelExecution(executionId, reason);
  }

  startAndWait<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;
  startAndWait<TResult = unknown>(
    task: string,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;
  async startAndWait(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<unknown>> {
    return this.executionManager.startAndWait(task, input, options);
  }

  wait<TResult>(
    executionId: string,
    options?: { timeout?: number; waitPollIntervalMs?: number },
  ): Promise<TResult> {
    return this.waitManager.waitForResult(executionId, options);
  }

  schedule<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input: TInput | undefined,
    options: ScheduleOptions,
  ): Promise<string>;
  schedule(
    task: string,
    input: unknown,
    options: ScheduleOptions,
  ): Promise<string>;
  async schedule(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options: ScheduleOptions,
  ): Promise<string> {
    return this.scheduleManager.schedule(task, input, options);
  }

  ensureSchedule<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input: TInput | undefined,
    options: ScheduleOptions & { id: string },
  ): Promise<string>;
  ensureSchedule(
    task: string,
    input: unknown,
    options: ScheduleOptions & { id: string },
  ): Promise<string>;
  async ensureSchedule(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options: ScheduleOptions & { id: string },
  ): Promise<string> {
    return this.scheduleManager.ensureSchedule(task, input, options);
  }

  async recover(): Promise<void> {
    const incomplete = await this.config.store.listIncompleteExecutions();
    for (const exec of incomplete) {
      if (
        exec.status === ExecutionStatus.Pending ||
        exec.status === ExecutionStatus.Running ||
        exec.status === ExecutionStatus.Sleeping ||
        exec.status === ExecutionStatus.Retrying
      ) {
        await this.executionManager.kickoffExecution(exec.id);
      }
    }
  }

  async stop(): Promise<void> {
    await this.pollingManager.stop();
  }

  async pauseSchedule(id: string): Promise<void> {
    await this.scheduleManager.pause(id);
  }

  async resumeSchedule(id: string): Promise<void> {
    await this.scheduleManager.resume(id);
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    return this.scheduleManager.get(id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return this.scheduleManager.list();
  }

  async updateSchedule(
    id: string,
    updates: { cron?: string; interval?: number; input?: unknown },
  ): Promise<void> {
    await this.scheduleManager.update(id, updates);
  }

  async removeSchedule(id: string): Promise<void> {
    await this.scheduleManager.remove(id);
  }

  async signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    await this.signalHandler.signal(executionId, signal, payload);
  }

  // ─── Internal access for DurableWorker ─────────────────────────────────────

  async processExecution(executionId: string): Promise<void> {
    return this.executionManager.processExecution(executionId);
  }

  getEventBus() {
    return this.config.eventBus ?? new NoopEventBus();
  }

  // ─── Test access (internal methods exposed for unit testing) ───────────────

  /** @internal - exposed for unit testing */
  get _pollingManager() {
    return this.pollingManager;
  }

  /** @internal - exposed for unit testing */
  get _executionManager() {
    return this.executionManager;
  }

  /** @internal - exposed for unit testing (delegates to pollingManager) */
  async handleTimer(timer: import("./types").Timer): Promise<void> {
    return this.pollingManager.handleTimer(timer);
  }
}

export async function initDurableService(
  config: DurableServiceConfig,
): Promise<DurableService> {
  const service = new DurableService(config);
  if (config.store.init) await config.store.init();
  if (config.queue?.init) await config.queue.init();
  if (config.eventBus?.init) await config.eventBus.init();
  if (config.polling?.enabled !== false) {
    service.start();
  }
  return service;
}

export async function disposeDurableService(
  service: IDurableService,
  config: DurableServiceConfig,
): Promise<void> {
  await service.stop();
  if (config.store.dispose) await config.store.dispose();
  if (config.queue?.dispose) await config.queue.dispose();
  if (config.eventBus?.dispose) await config.eventBus.dispose();
}
