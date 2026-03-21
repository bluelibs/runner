import { NoopEventBus } from "../bus/NoopEventBus";
import type {
  DurableStartAndWaitResult,
  DurableServiceConfig,
  EnsureScheduleOptions,
  ExecuteOptions,
  IDurableService,
  RecoverReportType,
  ScheduleOptions,
  StartAndWaitOptions,
  WaitOptions,
} from "./interfaces/service";
import type { Schedule } from "./types";
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
  RecoveryManager,
} from "./managers";
import { durableExecutionInvariantError } from "../../../errors";
import { Logger } from "../../../models/Logger";
import type { DurableWorker } from "./DurableWorker";

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
  private readonly recoveryManager: RecoveryManager;
  private readonly logger: Logger;
  private readonly stopHandlers: Array<() => Promise<void>> = [];
  private recoveryStopRegistered = false;

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
    this.taskRegistry = new TaskRegistry(
      config.taskResolver,
      config.taskIdResolver,
    );

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
        logger: this.logger,
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
        resolveTask: (taskId) => this.taskRegistry.find(taskId),
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
        kickoffExecution: (id) => this.executionManager.recoverExecution(id),
      },
      this.logger,
    );

    this.recoveryManager = new RecoveryManager(
      config.store,
      this.executionManager,
      this.logger,
      config.recovery,
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
    options?: StartAndWaitOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;
  startAndWait<TResult = unknown>(
    task: string,
    input?: unknown,
    options?: StartAndWaitOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;
  async startAndWait(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: StartAndWaitOptions,
  ): Promise<DurableStartAndWaitResult<unknown>> {
    return this.executionManager.startAndWait(task, input, options);
  }

  wait<TResult>(executionId: string, options?: WaitOptions): Promise<TResult> {
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
    options: EnsureScheduleOptions & { id: string },
  ): Promise<string>;
  ensureSchedule(
    task: string,
    input: unknown,
    options: EnsureScheduleOptions & { id: string },
  ): Promise<string>;
  async ensureSchedule(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options: EnsureScheduleOptions & { id: string },
  ): Promise<string> {
    return this.scheduleManager.ensureSchedule(task, input, options);
  }

  async recover(): Promise<RecoverReportType> {
    return this.recoveryManager.recover();
  }

  async stop(): Promise<void> {
    let firstError: unknown = null;

    while (this.stopHandlers.length > 0) {
      const stop = this.stopHandlers.pop()!;
      try {
        await stop();
      } catch (error) {
        firstError ??= error;
        try {
          await this.logger.error("Durable stop handler failed.", { error });
        } catch {
          // Logging must not mask shutdown.
        }
      }
    }

    try {
      await this.pollingManager.stop();
    } catch (error) {
      firstError ??= error;
      try {
        await this.logger.error("Durable polling shutdown failed.", { error });
      } catch {
        // Logging must not mask shutdown.
      }
    }

    if (firstError) {
      throw firstError;
    }
  }

  /** @internal - used by Runner runtime wiring to stop embedded workers */
  registerWorker(worker: DurableWorker): void {
    this.stopHandlers.push(async () => {
      await worker.stop();
    });
  }

  /** @internal - used by service/runtime init to auto-start background recovery */
  startRecoveryOnInit(): void {
    this.recoveryManager.startBackgroundRecovery();
    if (this.recoveryStopRegistered) return;
    this.recoveryStopRegistered = true;
    this.stopHandlers.push(async () => {
      await this.recoveryManager.stopBackgroundRecovery();
    });
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

  async failExecutionDeliveryExhausted(
    executionId: string,
    details: {
      messageId: string;
      attempts: number;
      maxAttempts: number;
      errorMessage: string;
    },
  ): Promise<void> {
    return this.executionManager.failExecutionDeliveryExhausted(
      executionId,
      details,
    );
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
  if (config.recovery?.enabledOnInit === true) {
    service.startRecoveryOnInit();
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
