import type { IEventDefinition } from "../../../../types/event";
import type { ITask } from "../../../../types/task";
import type { IDurableStore } from "./store";
import type { IDurableQueue } from "./queue";
import type { IEventBus } from "./bus";
import type { IDurableContext } from "./context";
import type { Schedule } from "../types";
import type { DurableAuditEmitter } from "../audit";

export interface ITaskExecutor {
  run<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
  ): Promise<TResult>;
}

export interface ScheduleConfig<TInput = unknown> {
  id: string;
  task: ITask<TInput, Promise<any>, any, any, any, any> | string;
  cron?: string;
  interval?: number;
  input: TInput;
}

export interface DurableServiceConfig {
  store: IDurableStore;
  queue?: IDurableQueue;
  eventBus?: IEventBus;
  taskExecutor?: ITaskExecutor;
  determinism?: {
    /**
     * Internal step IDs for `sleep()`/`emit()`/`waitForSignal()` default to call-order based IDs.
     * In production this can be a replay/versioning footgun when refactors change call order.
     *
     * - "allow" (default): do nothing
     * - "warn": emit a warning on first implicit internal step per kind
     * - "error": throw when an implicit internal step id would be used
     */
    implicitInternalStepIds?: "allow" | "warn" | "error";
  };
  /**
   * Unique identifier for this worker instance.
   * Used for distributed timer coordination to ensure only one worker processes each timer.
   * If not provided, a random UUID is generated.
   */
  workerId?: string;
  /**
   * Runs a callback with the given durable context available.
   * In Runner environments this is typically implemented via AsyncLocalStorage
   * so tasks can call `durable.use()`.
   */
  contextProvider?: <R>(
    context: IDurableContext,
    fn: () => Promise<R> | R,
  ) => Promise<R> | R;
  /**
   * Resolves tasks by id for resuming/recovering executions.
   * Useful in Runner environments where tasks are registered in the Store registry.
   */
  taskResolver?: (
    taskId: string,
  ) => ITask<any, Promise<any>, any, any, any, any> | undefined;
  audit?: {
    enabled?: boolean;
    emitter?: DurableAuditEmitter;
  };
  polling?: {
    enabled?: boolean;
    interval?: number;
    /** Time-to-live for timer claims in milliseconds. Default: 30000. */
    claimTtlMs?: number;
  };
  execution?: {
    maxAttempts?: number;
    timeout?: number;
    /**
     * When a queue is configured, `start()` persists the execution and then enqueues it.
     * If enqueue fails (eg. broker outage), the execution would otherwise remain "pending" forever.
     *
     * This delay arms a small store-backed timer as a failsafe so workers can retry resuming it
     * via the poller. Default: 10000 (10s). Set to 0 to disable.
     */
    kickoffFailsafeDelayMs?: number;
  };
  schedules?: ScheduleConfig[];
  tasks?: Array<ITask<any, Promise<any>, any, any, any, any>>;
}

export interface ExecuteOptions {
  timeout?: number;
  priority?: number;
  waitPollIntervalMs?: number;
  /**
   * Optional workflow-level idempotency key.
   * When supported by the store, multiple concurrent callers using the same key will receive the same executionId.
   */
  idempotencyKey?: string;
}

export interface ScheduleOptions {
  id?: string;
  at?: Date;
  delay?: number;
  cron?: string;
  interval?: number;
}

export interface DurableStartAndWaitResult<TResult = unknown> {
  durable: {
    executionId: string;
  };
  data: TResult;
}

export interface IDurableService {
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

  /**
   * Request cancellation for an execution.
   * Cancellation is cooperative: it marks the execution as cancelled and unblocks waiters,
   * but cannot preempt arbitrary in-process async work.
   */
  cancelExecution(executionId: string, reason?: string): Promise<void>;

  wait<TResult>(
    executionId: string,
    options?: { timeout?: number; waitPollIntervalMs?: number },
  ): Promise<TResult>;

  /**
   * Starts a workflow and waits for completion.
   * Returns the started execution id together with the workflow result payload.
   */
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

  /**
   * Idempotently create (or update) a recurring schedule (cron/interval) with a stable id.
   * Safe to call concurrently from multiple processes.
   */
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

  recover(): Promise<void>;

  /**
   * Starts the durable polling loop (timers/schedules processing).
   */
  start(): void;

  stop(): Promise<void>;

  pauseSchedule(scheduleId: string): Promise<void>;
  resumeSchedule(scheduleId: string): Promise<void>;
  getSchedule(scheduleId: string): Promise<Schedule | null>;
  listSchedules(): Promise<Schedule[]>;
  updateSchedule(
    scheduleId: string,
    updates: { cron?: string; interval?: number; input?: unknown },
  ): Promise<void>;
  removeSchedule(scheduleId: string): Promise<void>;

  /**
   * Deliver a signal payload to a waiting workflow execution and resume it.
   */
  signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void>;
}

export interface IDurableExecutionProcessor {
  processExecution(executionId: string): Promise<void>;
}
