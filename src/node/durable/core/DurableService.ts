import { NoopEventBus } from "../bus/NoopEventBus";
import { DurableContext } from "./DurableContext";
import { CronParser } from "./CronParser";
import { SuspensionSignal } from "./interfaces/context";
import type {
  DurableServiceConfig,
  DurableTask,
  ExecuteOptions,
  IDurableService,
  ScheduleOptions,
} from "./interfaces/service";
import type { Execution, Schedule, Timer } from "./types";
import type { IEventDefinition } from "../../../types/event";
import type { BusEvent } from "./interfaces/bus";
import type { DurableSignalId } from "./ids";
import { createDurableAuditEntryId, type DurableAuditEntry } from "./audit";
import {
  sleepMs,
  withTimeout,
  parseSignalState,
  createExecutionId,
  DurableExecutionError,
} from "./utils";
import { clearTimeout, setTimeout } from "node:timers";

export { DurableExecutionError };

// Utilities moved to ./utils.ts

export class DurableService implements IDurableService {
  private isRunning = false;
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingWake: (() => void) | null = null;
  private readonly tasks = new Map<string, DurableTask<any, any>>();

  constructor(private readonly config: DurableServiceConfig) {
    if (config.schedules) {
      for (const schedule of config.schedules) {
        this.registerTask(schedule.task);
      }
    }
    if (config.tasks) {
      for (const task of config.tasks) {
        this.registerTask(task);
      }
    }
  }

  private async appendAuditEntry(
    params: Omit<
      Parameters<NonNullable<DurableServiceConfig["store"]["appendAuditEntry"]>>[0],
      "id" | "at"
    > & { at?: Date },
  ): Promise<void> {
    if (!this.config.audit?.enabled) return;
    if (!this.config.store.appendAuditEntry) return;
    const at = params.at ?? new Date();
    const fullEntry: DurableAuditEntry = {
      ...params,
      id: createDurableAuditEntryId(at.getTime()),
      at,
    };
    try {
      await this.config.store.appendAuditEntry(fullEntry);

      if (this.config.audit?.emitter) {
        try {
          await this.config.audit.emitter.emit(fullEntry);
        } catch {
          // Audit emissions must not affect workflow correctness.
        }
      }
    } catch {
      // Audit trails must not affect workflow correctness.
      // If audit persistence fails, we degrade gracefully.
    }
  }

  registerTask<TInput, TResult>(task: DurableTask<TInput, TResult>): void {
    this.tasks.set(task.id, task);
  }

  findTask(taskId: string): DurableTask<any, any> | undefined {
    return this.tasks.get(taskId) ?? this.config.taskResolver?.(taskId);
  }

  async startExecution<TInput>(
    task: DurableTask<TInput, unknown>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<string> {
    this.registerTask(task);

    if (!this.config.queue && !this.config.taskExecutor) {
      throw new Error(
        "DurableService requires `taskExecutor` to execute Runner tasks (when no queue is configured). Use `createDurableResource()` in a Runner runtime, or provide a custom executor in config.",
      );
    }

    const executionId = createExecutionId();
    const execution: Execution<TInput, unknown> = {
      id: executionId,
      taskId: task.id,
      input,
      status: "pending",
      attempt: 1,
      maxAttempts: this.config.execution?.maxAttempts ?? 3,
      timeout: options?.timeout ?? this.config.execution?.timeout,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.config.store.saveExecution(execution);
    await this.appendAuditEntry({
      kind: "execution_status_changed",
      executionId,
      taskId: task.id,
      attempt: execution.attempt,
      from: null,
      to: "pending",
      reason: "created",
    });
    await this.kickoffExecution(executionId);

    return executionId;
  }

  async execute<TInput, TResult>(
    task: DurableTask<TInput, TResult>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<TResult> {
    const executionId = await this.startExecution(task, input, options);
    return await this.wait<TResult>(executionId, {
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

  wait<TResult>(
    executionId: string,
    options?: { timeout?: number; waitPollIntervalMs?: number },
  ): Promise<TResult> {
    return this.waitForResult(executionId, options);
  }

  async schedule<TInput>(
    task: DurableTask<TInput, unknown>,
    input: TInput | undefined,
    options: ScheduleOptions,
  ): Promise<string> {
    this.registerTask(task);

    const id = options.id ?? createExecutionId();

    if (options.cron || options.interval !== undefined) {
      const schedule: Schedule<TInput> = {
        id,
        taskId: task.id,
        input,
        pattern: options.cron ?? String(options.interval),
        type: options.cron ? "cron" : "interval",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.config.store.createSchedule(schedule);
      await this.reschedule(schedule);
      return id;
    }

    const delay = options.delay ?? 0;
    const fireAt = options.at ?? new Date(Date.now() + delay);

    await this.config.store.createTimer({
      id: `once:${id}`,
      taskId: task.id,
      input,
      type: "scheduled",
      fireAt,
      status: "pending",
    });

    return id;
  }

  async recover(): Promise<void> {
    const incomplete = await this.config.store.listIncompleteExecutions();

    for (const exec of incomplete) {
      if (
        exec.status === "pending" ||
        exec.status === "running" ||
        exec.status === "sleeping" ||
        exec.status === "retrying"
      ) {
        await this.kickoffExecution(exec.id);
      }
    }
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    void this.poll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.pollingWake) {
      const wake = this.pollingWake;
      this.pollingWake = null;
      wake();
    }
  }

  async pauseSchedule(id: string): Promise<void> {
    await this.config.store.updateSchedule(id, { status: "paused" });
  }

  async resumeSchedule(id: string): Promise<void> {
    const schedule = await this.config.store.getSchedule(id);
    if (!schedule) return;

    await this.config.store.updateSchedule(id, {
      status: "active",
      updatedAt: new Date(),
    });

    await this.reschedule(schedule);
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    return this.config.store.getSchedule(id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return this.config.store.listSchedules();
  }

  async updateSchedule(
    id: string,
    updates: { cron?: string; interval?: number; input?: unknown },
  ): Promise<void> {
    const pattern =
      updates.cron ??
      (updates.interval !== undefined ? String(updates.interval) : undefined);

    await this.config.store.updateSchedule(id, {
      pattern,
      input: updates.input,
      updatedAt: new Date(),
    });
  }

  async removeSchedule(id: string): Promise<void> {
    await this.config.store.deleteSchedule(id);
  }

  async processExecution(executionId: string): Promise<void> {
    const execution = await this.config.store.getExecution(executionId);
    if (!execution) return;
    if (execution.status === "completed" || execution.status === "failed")
      return;

    const task = this.findTask(execution.taskId);
    if (!task) {
      await this.config.store.updateExecution(execution.id, {
        status: "failed",
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

  private getEventBus() {
    return this.config.eventBus ?? new NoopEventBus();
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

    await this.config.store.updateExecution(execution.id, { status: "running" });
    await this.appendAuditEntry({
      kind: "execution_status_changed",
      executionId: execution.id,
      taskId: execution.taskId,
      attempt: execution.attempt,
      from: execution.status,
      to: "running",
      reason: "start_attempt",
    });

    const context = new DurableContext(
      this.config.store,
      this.getEventBus(),
      execution.id,
      execution.attempt,
      {
        auditEnabled: this.config.audit?.enabled === true,
        auditEmitter: this.config.audit?.emitter,
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
        status: "completed",
        result,
        completedAt: new Date(),
      };
      await this.config.store.updateExecution(execution.id, finishedExecution);
      await this.appendAuditEntry({
        kind: "execution_status_changed",
        executionId: execution.id,
        taskId: execution.taskId,
        attempt: execution.attempt,
        from: "running",
        to: "completed",
        reason: "completed",
      });
      await this.notifyExecutionFinished(finishedExecution);
    } catch (error) {
      if (error instanceof SuspensionSignal) {
        await this.config.store.updateExecution(execution.id, {
          status: "sleeping",
        });
        await this.appendAuditEntry({
          kind: "execution_status_changed",
          executionId: execution.id,
          taskId: execution.taskId,
          attempt: execution.attempt,
          from: "running",
          to: "sleeping",
          reason: `suspend:${error.reason}`,
        });
        return;
      }

      // If the error was a compensation failure, the status is already set to 'compensation_failed'.
      // We should not overwrite it with 'retrying' or 'failed'.
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
          status: "failed",
          error: errorInfo,
          completedAt: new Date(),
        };
        await this.config.store.updateExecution(execution.id, failedExecution);
        await this.appendAuditEntry({
          kind: "execution_status_changed",
          executionId: execution.id,
          taskId: execution.taskId,
          attempt: execution.attempt,
          from: "running",
          to: "failed",
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
        type: "retry",
        fireAt,
        status: "pending",
      });

      await this.config.store.updateExecution(execution.id, {
        status: "retrying",
        attempt: execution.attempt + 1,
        error: errorInfo,
      });
      await this.appendAuditEntry({
        kind: "execution_status_changed",
        executionId: execution.id,
        taskId: execution.taskId,
        attempt: execution.attempt,
        from: "running",
        to: "retrying",
        reason: "retry_scheduled",
      });
    }
  }

  private async kickoffExecution(executionId: string): Promise<void> {
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

  private async notifyExecutionFinished(execution: Execution): Promise<void> {
    await this.getEventBus().publish(`execution:${execution.id}`, {
      type: "finished",
      payload: execution,
      timestamp: new Date(),
    });
  }

  private async waitForResult<TInput, TResult>(
    executionId: string,
    options?: { timeout?: number; waitPollIntervalMs?: number },
  ): Promise<TResult> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeout ?? this.config.execution?.timeout;
    const pollEveryMs = options?.waitPollIntervalMs ?? 500;

    const pollingFallback = async (): Promise<TResult> => {
      while (true) {
        const result = await check();
        if (result !== undefined) return result;

        if (timeoutMs !== undefined && Date.now() - startedAt > timeoutMs) {
          const exec = await this.config.store.getExecution(executionId);
          throw new DurableExecutionError(
            `Timeout waiting for execution ${executionId}`,
            executionId,
            exec?.taskId || "unknown",
            exec?.attempt || 0,
          );
        }

        await sleepMs(pollEveryMs);
      }
    };

    const check = async (): Promise<TResult | undefined> => {
      const exec = await this.config.store.getExecution(executionId);
      if (!exec) {
        throw new DurableExecutionError(
          `Execution ${executionId} not found`,
          executionId,
          "unknown",
          0,
        );
      }

      if (exec.status === "completed") {
        if (exec.result === undefined) {
          throw new DurableExecutionError(
            `Execution ${executionId} completed without result`,
            exec.id,
            exec.taskId,
            exec.attempt,
          );
        }
        return exec.result as TResult;
      }

      if (exec.status === "failed") {
        throw new DurableExecutionError(
          exec.error?.message || "Execution failed",
          exec.id,
          exec.taskId,
          exec.attempt,
          exec.error,
        );
      }

      if (exec.status === "compensation_failed") {
        throw new DurableExecutionError(
          exec.error?.message || "Compensation failed",
          exec.id,
          exec.taskId,
          exec.attempt,
          exec.error,
        );
      }

      return undefined;
    };

    // Initial check
    const initialResult = await check();
    if (initialResult !== undefined) return initialResult;

    // Use EventBus if available
    const eventBus = this.config.eventBus;
    if (eventBus) {
      return new Promise<TResult>((resolve, reject) => {
        const channel = `execution:${executionId}`;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const safeUnsubscribe = async (): Promise<void> => {
          try {
            await eventBus.unsubscribe(channel);
          } catch {
            // ignore
          }
        };

        const finalize = async (
          out: { ok: true; value: TResult } | { ok: false; error: unknown },
        ): Promise<void> => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          await safeUnsubscribe();

          if (out.ok) {
            resolve(out.value);
          } else {
            reject(out.error);
          }
        };

        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            void (async () => {
              try {
                const exec = await this.config.store.getExecution(executionId);
                await finalize({
                  ok: false,
                  error: new DurableExecutionError(
                    `Timeout waiting for execution ${executionId}`,
                    executionId,
                    exec?.taskId || "unknown",
                    exec?.attempt || 0,
                  ),
                });
              } catch (err) {
                await finalize({ ok: false, error: err });
              }
            })();
          }, timeoutMs);
          timer.unref();
        }

        const handler = async (_event: BusEvent) => {
          try {
            const result = await check();
            if (result !== undefined) {
              await finalize({ ok: true, value: result });
            }
          } catch (err) {
            await finalize({ ok: false, error: err });
          }
        };

        void (async () => {
          try {
            await eventBus.subscribe(channel, handler);
            await handler({
              type: "subscribed",
              payload: null,
              timestamp: new Date(),
            });
          } catch {
            // Fallback to polling if subscription fails (or subscribe throws)
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            pollingFallback().then(resolve).catch(reject);
          }
        })();
      });
    }

    return pollingFallback();
  }

  private async poll(): Promise<void> {
    const intervalMs = this.config.polling?.interval ?? 1000;

    while (this.isRunning) {
      try {
        const ready = await this.config.store.getReadyTimers();
        for (const timer of ready) {
          await this.handleTimer(timer);
        }
      } catch (error) {
        console.error("DurableService polling error:", error);
      }

      if (!this.isRunning) return;

      await new Promise<void>((resolve) => {
        this.pollingWake = resolve;
        this.pollingTimer = setTimeout(() => {
          this.pollingTimer = null;
          this.pollingWake = null;
          resolve();
        }, intervalMs);
        this.pollingTimer.unref();
      });
    }
  }

  private async handleTimer(timer: Timer): Promise<void> {
    try {
      await this.config.store.markTimerFired(timer.id);

      if (timer.type === "sleep" && timer.executionId && timer.stepId) {
        await this.config.store.saveStepResult({
          executionId: timer.executionId,
          stepId: timer.stepId,
          result: { state: "completed" },
          completedAt: new Date(),
        });
        const execution = await this.config.store.getExecution(timer.executionId);
        await this.appendAuditEntry({
          kind: "sleep_completed",
          executionId: timer.executionId,
          taskId: execution?.taskId,
          attempt: execution?.attempt ?? 0,
          stepId: timer.stepId,
          timerId: timer.id,
        });
      }

      if (timer.type === "signal_timeout" && timer.executionId && timer.stepId) {
        const existing = await this.config.store.getStepResult(
          timer.executionId,
          timer.stepId,
        );
        const state = parseSignalState(existing?.result);
        if (state?.state === "waiting") {
          await this.config.store.saveStepResult({
            executionId: timer.executionId,
            stepId: timer.stepId,
            result: { state: "timed_out" },
            completedAt: new Date(),
          });
          const execution = await this.config.store.getExecution(timer.executionId);
          const stepSuffix = timer.stepId.startsWith("__signal:")
            ? timer.stepId.slice("__signal:".length)
            : timer.stepId;
          const signalId = stepSuffix.split(":")[0];
          await this.appendAuditEntry({
            kind: "signal_timed_out",
            executionId: timer.executionId,
            taskId: execution?.taskId,
            attempt: execution?.attempt ?? 0,
            stepId: timer.stepId,
            signalId,
            timerId: timer.id,
          });
        }
      }

      if (timer.executionId) {
        if (this.config.queue) {
          await this.config.queue.enqueue({
            type: "resume",
            payload: { executionId: timer.executionId },
            maxAttempts: this.config.execution?.maxAttempts ?? 3,
          });
        } else {
          await this.processExecution(timer.executionId);
        }
        return;
      }

      if (!timer.taskId) return;

      const task = this.findTask(timer.taskId);
      if (!task) return;

      const executionId = createExecutionId();
      const execution: Execution<unknown, unknown> = {
        id: executionId,
        taskId: task.id,
        input: timer.input,
        status: "pending",
        attempt: 1,
        maxAttempts: this.config.execution?.maxAttempts ?? 3,
        timeout: this.config.execution?.timeout,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.config.store.saveExecution(execution);
      await this.kickoffExecution(executionId);

      if (timer.scheduleId) {
        const schedule = await this.config.store.getSchedule(timer.scheduleId);
        if (schedule && schedule.status === "active") {
          await this.reschedule(schedule, { lastRunAt: new Date() });
        }
      }
    } finally {
      try {
        await this.config.store.deleteTimer(timer.id);
      } catch {
        // best-effort cleanup; ignore
      }
    }
  }

  private async reschedule(
    schedule: Schedule,
    options?: { lastRunAt?: Date },
  ): Promise<void> {
    const now = new Date();

    let nextRun: Date;
    if (schedule.type === "cron") {
      nextRun = CronParser.getNextRun(schedule.pattern);
    } else {
      const intervalMs = Number(schedule.pattern);
      nextRun = new Date(now.getTime() + intervalMs);
    }

    await this.config.store.createTimer({
      id: `sched:${schedule.id}:${nextRun.getTime()}`,
      scheduleId: schedule.id,
      taskId: schedule.taskId,
      input: schedule.input,
      type: "scheduled",
      fireAt: nextRun,
      status: "pending",
    });

    await this.config.store.updateSchedule(schedule.id, {
      lastRun: options?.lastRunAt,
      nextRun,
      updatedAt: new Date(),
    });
  }

  // Moved to utilities

  async signal<TPayload>(
    executionId: string,
    signal: string | IEventDefinition<TPayload> | DurableSignalId<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    const signalId = typeof signal === "string" ? signal : signal.id;
    const baseStepId = `__signal:${signalId}`;

    const maxSignalSlotsToScan = 1000;
    let completedStepId: string | null = null;
    let shouldResume = false;

    for (let index = 0; index < maxSignalSlotsToScan; index += 1) {
      const stepId = index === 0 ? baseStepId : `${baseStepId}:${index}`;
      const existing = await this.config.store.getStepResult(executionId, stepId);

      if (!existing) {
        completedStepId = stepId;
        break;
      }

      const state = parseSignalState(existing.result);
      if (!state) {
        throw new Error(
          `Invalid signal step state for '${signalId}' at '${stepId}'`,
        );
      }

      if (state.state === "waiting") {
        if (state.timerId) {
          await this.config.store.deleteTimer(state.timerId);
        }
        completedStepId = stepId;
        shouldResume = true;
        break;
      }

      // completed / timed_out -> keep scanning for the next available slot
    }

    if (!completedStepId) {
      throw new Error(
        `Too many signal slots for '${signalId}' (exceeded ${maxSignalSlotsToScan})`,
      );
    }

    await this.config.store.saveStepResult({
      executionId,
      stepId: completedStepId,
      result: { state: "completed", payload },
      completedAt: new Date(),
    });
    const execution = await this.config.store.getExecution(executionId);
    await this.appendAuditEntry({
      kind: "signal_delivered",
      executionId,
      taskId: execution?.taskId,
      attempt: execution?.attempt ?? 0,
      stepId: completedStepId,
      signalId,
    });

    if (!shouldResume) return;

    if (!execution) return;
    if (
      execution.status === "completed" ||
      execution.status === "failed" ||
      execution.status === "compensation_failed"
    )
      return;

    if (this.config.queue) {
      await this.config.queue.enqueue({
        type: "resume",
        payload: { executionId },
        maxAttempts: this.config.execution?.maxAttempts ?? 3,
      });
    } else {
      await this.processExecution(executionId);
    }
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
