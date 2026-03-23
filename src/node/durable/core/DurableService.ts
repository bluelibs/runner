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
  private lifecycleState: "running" | "cooldown" | "disposing" | "disposed" =
    "running";
  private readonly taskRegistry: TaskRegistry;
  private readonly auditLogger: AuditLogger;
  private readonly waitManager: WaitManager;
  private readonly scheduleManager: ScheduleManager;
  private readonly signalHandler: SignalHandler;
  private readonly executionManager: ExecutionManager;
  private readonly pollingManager: PollingManager;
  private readonly recoveryManager: RecoveryManager;
  private readonly logger: Logger;
  private readonly cooldownHandlers: Array<() => Promise<void> | void> = [];
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
      config.workflowKeyResolver,
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
      this.logger,
      config.queue,
      config.execution?.maxAttempts ?? 3,
      {
        processExecution: (id) => this.executionManager.processExecution(id),
        resolveTask: (workflowKey) => this.taskRegistry.find(workflowKey),
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
    workflowKey: string,
  ): ITask<any, Promise<any>, any, any, any, any> | undefined {
    return this.taskRegistry.find(workflowKey);
  }

  async cooldown(): Promise<void> {
    if (
      this.lifecycleState === "cooldown" ||
      this.lifecycleState === "disposing" ||
      this.lifecycleState === "disposed"
    ) {
      return;
    }

    this.lifecycleState = "cooldown";
    let firstError: unknown = null;

    while (this.cooldownHandlers.length > 0) {
      const cooldown = this.cooldownHandlers.pop()!;
      try {
        await cooldown();
      } catch (error) {
        firstError ??= error;
        try {
          await this.logger.error("Durable cooldown handler failed.", {
            error,
          });
        } catch {
          // Logging must not mask shutdown.
        }
      }
    }

    try {
      await this.pollingManager.cooldown();
    } catch (error) {
      firstError ??= error;
      try {
        await this.logger.error("Durable polling cooldown failed.", { error });
      } catch {
        // Logging must not mask shutdown.
      }
    }

    if (firstError) {
      throw firstError;
    }
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
      this.assertCanStartBackgroundProcessing("DurableService.start()");
      this.pollingManager.start();
      return;
    }

    this.assertCanStartDurableExecution("DurableService.start(task)");
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
    this.assertCanStartDurableExecution("DurableService.startAndWait()");
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
    this.assertCanStartBackgroundProcessing("DurableService.schedule()");
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
    this.assertCanStartBackgroundProcessing("DurableService.ensureSchedule()");
    return this.scheduleManager.ensureSchedule(task, input, options);
  }

  async recover(): Promise<RecoverReportType> {
    this.assertCanStartBackgroundProcessing("DurableService.recover()");
    return this.recoveryManager.recover();
  }

  async stop(): Promise<void> {
    if (this.lifecycleState === "disposed") {
      return;
    }

    let firstError: unknown = null;

    try {
      await this.cooldown();
    } catch (error) {
      firstError ??= error;
    }

    this.lifecycleState = "disposing";

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

    this.lifecycleState = "disposed";
    if (firstError) {
      throw firstError;
    }
  }

  /** @internal - used by Runner runtime wiring to stop embedded workers */
  registerWorker(worker: DurableWorker): void {
    this.cooldownHandlers.push(async () => {
      await worker.cooldown();
    });
    this.stopHandlers.push(async () => {
      await worker.stop();
    });
  }

  /** @internal - used by service/runtime init to auto-start background recovery */
  startRecoveryOnInit(): void {
    this.recoveryManager.startBackgroundRecovery();
    if (this.recoveryStopRegistered) return;
    this.recoveryStopRegistered = true;
    this.cooldownHandlers.push(() => {
      this.recoveryManager.cooldownBackgroundRecovery();
    });
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
    this.assertCanDeliverSignal("DurableService.signal()");
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

  private assertCanStartBackgroundProcessing(methodName: string): void {
    if (this.lifecycleState === "running") {
      return;
    }

    durableExecutionInvariantError.throw({
      message:
        `${methodName} cannot admit new durable work because this durable runtime is shutting down. ` +
        "Wait for shutdown to complete or create a fresh runtime instance.",
    });
  }

  private assertCanStartDurableExecution(methodName: string): void {
    if (
      this.lifecycleState === "running" ||
      this.lifecycleState === "cooldown" ||
      this.lifecycleState === "disposing"
    ) {
      return;
    }

    durableExecutionInvariantError.throw({
      message:
        `${methodName} cannot admit new durable work because this durable runtime is shutting down. ` +
        "Wait for shutdown to complete or create a fresh runtime instance.",
    });
  }

  private assertCanDeliverSignal(methodName: string): void {
    if (
      this.lifecycleState === "running" ||
      this.lifecycleState === "cooldown" ||
      this.lifecycleState === "disposing"
    ) {
      return;
    }

    durableExecutionInvariantError.throw({
      message:
        `${methodName} cannot interact with this durable runtime because shutdown is already disposing resources. ` +
        "Wait for shutdown to complete or create a fresh runtime instance.",
    });
  }
}

export async function initDurableService(
  config: DurableServiceConfig,
): Promise<DurableService> {
  const service = new DurableService(config);
  let storeInitialized = false;
  let queueInitialized = false;
  let eventBusInitialized = false;

  try {
    if (config.store.init) {
      await config.store.init();
      storeInitialized = true;
    }
    if (config.queue?.init) {
      await config.queue.init();
      queueInitialized = true;
    }
    if (config.eventBus?.init) {
      await config.eventBus.init();
      eventBusInitialized = true;
    }
    if (config.recovery?.onStartup === true) {
      service.startRecoveryOnInit();
    }
    if (config.polling?.enabled !== false) {
      service.start();
    }
    return service;
  } catch (error) {
    await service.stop().catch(() => undefined);

    if (eventBusInitialized && config.eventBus?.dispose) {
      await config.eventBus.dispose().catch(() => undefined);
    }
    if (queueInitialized && config.queue?.dispose) {
      await config.queue.dispose().catch(() => undefined);
    }
    if (storeInitialized && config.store.dispose) {
      await config.store.dispose().catch(() => undefined);
    }

    throw error;
  }
}

export async function disposeDurableService(
  service: IDurableService,
  config: DurableServiceConfig,
): Promise<void> {
  await service.stop();

  let firstError: unknown = null;

  try {
    if (config.store.dispose) await config.store.dispose();
  } catch (error) {
    firstError ??= error;
  }

  try {
    if (config.queue?.dispose) await config.queue.dispose();
  } catch (error) {
    firstError ??= error;
  }

  try {
    if (config.eventBus?.dispose) await config.eventBus.dispose();
  } catch (error) {
    firstError ??= error;
  }

  if (firstError) {
    throw firstError;
  }
}
