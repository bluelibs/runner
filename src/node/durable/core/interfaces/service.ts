import type { IEventDefinition } from "../../../../types/event";
import type { ITask } from "../../../../types/task";
import type { IDurableStore } from "./store";
import type { IDurableQueue } from "./queue";
import type { IEventBus } from "./bus";
import type { IDurableContext } from "./context";
import type { ExecutionStatus, Schedule } from "../types";
import type { DurableAuditEmitter } from "../audit";
import type { Logger } from "../../../../models/Logger";

export interface ITaskExecutor {
  run<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
  ): Promise<TResult>;
}

export interface CronScheduleOptions {
  id?: string;
  cron: string;
  timezone?: string;
  at?: never;
  delay?: never;
  interval?: never;
}

export interface IntervalScheduleOptions {
  id?: string;
  interval: number;
  at?: never;
  delay?: never;
  cron?: never;
  timezone?: never;
}

export interface OneTimeScheduleOptions {
  id?: string;
  at?: Date;
  delay?: number;
  cron?: never;
  interval?: never;
  timezone?: never;
}

export type RecurringScheduleConfig<TInput = unknown> =
  | {
      id: string;
      task: ITask<TInput, Promise<any>, any, any, any, any> | string;
      cron: string;
      timezone?: string;
      interval?: never;
      input: TInput;
    }
  | {
      id: string;
      task: ITask<TInput, Promise<any>, any, any, any, any> | string;
      interval: number;
      cron?: never;
      input: TInput;
    };

export type ScheduleConfig<TInput = unknown> = RecurringScheduleConfig<TInput>;

export type ScheduleOptions =
  | OneTimeScheduleOptions
  | CronScheduleOptions
  | IntervalScheduleOptions;

export type EnsureScheduleOptions =
  | CronScheduleOptions
  | IntervalScheduleOptions;

export type UpdateScheduleOptions =
  | {
      input?: unknown;
      cron?: never;
      interval?: never;
      timezone?: never;
    }
  | {
      cron: string;
      timezone?: string;
      interval?: never;
      input?: unknown;
    }
  | {
      interval: number;
      cron?: never;
      timezone?: never;
      input?: unknown;
    };

export interface DurableServiceConfig {
  store: IDurableStore;
  queue?: IDurableQueue;
  eventBus?: IEventBus;
  logger?: Logger;
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
    workflowKey: string,
  ) => ITask<any, Promise<any>, any, any, any, any> | undefined;
  /**
   * Resolves the durable persisted workflow key for a task definition.
   * In Runner environments this prefers tags.durableWorkflow.with({ key })
   * and falls back to the canonical runtime task id.
   */
  workflowKeyResolver?: (
    task: ITask<any, Promise<any>, any, any, any, any>,
  ) => string | undefined;
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
  recovery?: {
    /** Automatically starts background orphan recovery when the runtime boots. */
    onStartup?: boolean;
    /** Maximum number of concurrent recovery attempts per drain. Default: 10. */
    concurrency?: number;
    /** Time-to-live for per-execution recovery claims in milliseconds. Default: 30000. */
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
  /**
   * Optional parent execution linkage for nested durable workflow starts.
   * Useful for operator tooling and execution tree visualizations.
   */
  parentExecutionId?: string;
  /**
   * Optional workflow-level idempotency key.
   * When supported by the store, repeated callers using the same key receive the
   * same executionId and keep the originally stored input.
   *
   * Existing executions are only re-admitted automatically when they are still
   * pending kickoff or already retrying. Running or sleeping workflows are not
   * implicitly resumed by repeating the same idempotent start.
   */
  idempotencyKey?: string;
}

export interface WaitOptions {
  timeout?: number;
  waitPollIntervalMs?: number;
}

export interface StartAndWaitOptions extends ExecuteOptions {
  /**
   * Optional caller wait timeout for `startAndWait()`.
   * Separate from `ExecuteOptions.timeout`, which bounds workflow runtime.
   * Use this when the caller should stop waiting even if the workflow keeps running.
   */
  waitTimeout?: number;
  waitPollIntervalMs?: number;
}

export interface DurableStartAndWaitResult<TResult = unknown> {
  durable: {
    executionId: string;
  };
  data: TResult;
}

export interface RecoverRecoveredReportType {
  executionId: string;
  status: ExecutionStatus;
}

export type RecoverSkippedReasonType =
  | "pending_timer"
  | "claimed_elsewhere"
  | "not_recoverable";

export interface RecoverSkippedReportType {
  executionId: string;
  status: ExecutionStatus;
  reason: RecoverSkippedReasonType;
}

export interface RecoverFailureReportType {
  executionId: string;
  status: ExecutionStatus;
  errorMessage: string;
}

/**
 * Summary returned by `recover()` so callers can decide whether startup should
 * continue, warn, or fail based on partial recovery outcomes.
 */
export interface RecoverReportType {
  scannedCount: number;
  recoveredCount: number;
  skippedCount: number;
  failedCount: number;
  recovered: RecoverRecoveredReportType[];
  skipped: RecoverSkippedReportType[];
  failures: RecoverFailureReportType[];
}

export interface IDurableService {
  /**
   * Stops worker, polling, recovery, and other background durable ownership for
   * this runtime instance while still allowing task-level durable interactions
   * needed by already-admitted Runner work to settle during drain.
   */
  cooldown(): Promise<void>;

  /**
   * Starts a workflow execution.
   * Task-level admission stays owned by Runner; durable only rejects starts once
   * this durable runtime has been fully disposed.
   */
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
   * Cancellation is cooperative and cannot preempt arbitrary in-process async work.
   * Running executions first move into a non-terminal cancellation-requested state
   * so the active step can observe its AbortSignal; waiters unblock once the attempt
   * exits and the execution becomes terminal `cancelled`.
   */
  cancelExecution(executionId: string, reason?: string): Promise<void>;

  wait<TResult>(executionId: string, options?: WaitOptions): Promise<TResult>;

  /**
   * Starts a workflow and waits for completion.
   * Task-level admission stays owned by Runner; durable only rejects starts once
   * this durable runtime has been fully disposed.
   * Returns the started execution id together with the workflow result payload.
   */
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
    options: EnsureScheduleOptions & { id: string },
  ): Promise<string>;
  ensureSchedule(
    task: string,
    input: unknown,
    options: EnsureScheduleOptions & { id: string },
  ): Promise<string>;

  /**
   * Recover incomplete executions and report which ones were resumed, skipped,
   * or failed during recovery.
   */
  recover(): Promise<RecoverReportType>;

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
    updates: UpdateScheduleOptions,
  ): Promise<void>;
  removeSchedule(scheduleId: string): Promise<void>;

  /**
   * Deliver a signal payload to a workflow execution.
   * Remains available during shutdown drain so draining workflows blocked in
   * `waitForSignal()` can still be resumed before the durable service is disposed.
   * Missing or terminal executions ignore new signals.
   * Live executions retain signal history at the execution level and queue
   * unawaited signals per `signalId` for `waitForSignal()` to consume in FIFO
   * order before suspending again.
   */
  signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void>;
}

export interface IDurableExecutionProcessor {
  processExecution(executionId: string): Promise<void>;

  /**
   * Marks an execution as terminally failed when queue delivery attempts are
   * exhausted and the message is being dropped.
   */
  failExecutionDeliveryExhausted(
    executionId: string,
    details: {
      messageId: string;
      attempts: number;
      maxAttempts: number;
      errorMessage: string;
    },
  ): Promise<void>;
}
