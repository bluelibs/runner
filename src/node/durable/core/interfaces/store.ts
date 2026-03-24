import type {
  Execution,
  ExecutionStatus,
  DurableSignalRecord,
  DurableQueuedSignalRecord,
  DurableSignalState,
  DurableSignalWaiter,
  DurableExecutionWaiter,
  StepResult,
  Timer,
  Schedule,
} from "../types";
import type { DurableAuditEntry } from "../audit";

export interface ListExecutionsOptions {
  status?: ExecutionStatus[];
  workflowKey?: string;
  limit?: number;
  offset?: number;
}

/**
 * Non-empty list of allowed source statuses for compare-and-set execution updates.
 */
export type ExpectedExecutionStatuses = readonly [
  ExecutionStatus,
  ...ExecutionStatus[],
];

export interface IDurableStore {
  saveExecution(execution: Execution): Promise<void>;
  /**
   * Atomically replaces an execution when its current status still matches one
   * of the expected statuses.
   */
  saveExecutionIfStatus(
    execution: Execution,
    expectedStatuses: ExpectedExecutionStatuses,
  ): Promise<boolean>;
  getExecution(id: string): Promise<Execution | null>;
  updateExecution(id: string, updates: Partial<Execution>): Promise<void>;
  listIncompleteExecutions(): Promise<Execution[]>;

  /**
   * Transactional execution-level idempotency helper.
   * Durable starts rely on this to atomically create the execution and claim
   * the dedupe mapping in one store operation.
   */
  createExecutionWithIdempotencyKey(params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  }): Promise<
    | { created: true; executionId: string }
    | { created: false; executionId: string }
  >;

  // Enhanced querying for operator tooling
  listExecutions(options?: ListExecutionsOptions): Promise<Execution[]>;
  listStepResults(executionId: string): Promise<StepResult[]>;
  appendAuditEntry?(entry: DurableAuditEntry): Promise<void>;
  listAuditEntries?(
    executionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<DurableAuditEntry[]>;

  // Operator API
  retryRollback?(executionId: string): Promise<void>;
  skipStep?(executionId: string, stepId: string): Promise<void>;
  forceFail?(
    executionId: string,
    error: { message: string; stack?: string },
  ): Promise<void>;
  editStepResult?(
    executionId: string,
    stepId: string,
    newResult: unknown,
  ): Promise<void>;

  getStepResult(
    executionId: string,
    stepId: string,
  ): Promise<StepResult | null>;
  saveStepResult(result: StepResult): Promise<void>;
  /**
   * Signal journaling is part of the core durable contract because live
   * delivery and `waitForSignal()` both rely on it.
   */
  getSignalState(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalState | null>;
  appendSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableSignalRecord,
  ): Promise<void>;
  /**
   * Atomically appends a signal record to both the signal history and the
   * queued FIFO used for replay when no waiter is currently ready to consume it.
   */
  bufferSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void>;
  /**
   * Appends a queued signal record in FIFO order.
   *
   * Queued signal records are append-only because repeated identical signals
   * must remain observable and replayable.
   */
  enqueueQueuedSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void>;
  consumeQueuedSignalRecord(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalRecord | null>;
  /**
   * Atomically consumes the next buffered signal record for the signal implied
   * by `stepResult` and persists the supplied completed step result.
   */
  consumeBufferedSignalForStep(
    stepResult: StepResult,
  ): Promise<DurableSignalRecord | null>;
  /**
   * Signal waiter indexing is part of the core durable contract.
   * `waitForSignal()` and live signal delivery rely on deterministic waiter ordering.
   */
  upsertSignalWaiter(waiter: DurableSignalWaiter): Promise<void>;
  /**
   * Returns the next signal waiter without removing it so callers can validate
   * and durably commit the completion before deleting the waiter.
   */
  peekNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null>;
  /**
   * Atomically completes a live signal waiter by persisting the supplied step
   * result, journaling the delivered signal, deleting the waiter, and cleaning
   * up the optional timeout timer. Returns false when the waiter/step no longer
   * matches an active waiting signal and the caller should re-check state.
   */
  commitSignalDelivery?(params: {
    executionId: string;
    signalId: string;
    stepId: string;
    stepResult: StepResult;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  }): Promise<boolean>;
  takeNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null>;
  deleteSignalWaiter(
    executionId: string,
    signalId: string,
    stepId: string,
  ): Promise<void>;

  upsertExecutionWaiter(waiter: DurableExecutionWaiter): Promise<void>;
  listExecutionWaiters(
    targetExecutionId: string,
  ): Promise<DurableExecutionWaiter[]>;
  commitExecutionWaiterCompletion?(params: {
    targetExecutionId: string;
    executionId: string;
    stepId: string;
    stepResult: StepResult;
    timerId?: string;
  }): Promise<boolean>;
  deleteExecutionWaiter(
    targetExecutionId: string,
    executionId: string,
    stepId: string,
  ): Promise<void>;

  createTimer(timer: Timer): Promise<void>;
  getReadyTimers(now?: Date): Promise<Timer[]>;
  /**
   * Atomically claims up to `limit` ready timers for the given worker and
   * returns their payloads in ready-order.
   *
   * Intended for bounded polling loops so multiple workers do not all fan out
   * over the same full ready set before claims are applied.
   *
   * This is part of the required store contract when durable polling is
   * enabled. `PollingManager` uses it to refill only the worker's available
   * local slots instead of draining the entire ready backlog at once.
   */
  claimReadyTimers(
    now: Date,
    limit: number,
    workerId: string,
    ttlMs: number,
  ): Promise<Timer[]>;
  markTimerFired(timerId: string): Promise<void>;
  /**
   * Atomically claim a timer for processing. Returns true if claimed, false if already claimed.
   * Used for distributed timer coordination to ensure only one worker processes each timer.
   * @param timerId The ID of the timer to claim
   * @param workerId A unique identifier for the worker claiming the timer
   * @param ttlMs Time-to-live in milliseconds for the claim (in case worker dies)
   */
  claimTimer?(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean>;
  /**
   * Renews an active timer claim when the same worker is still handling it.
   * Allows long-running timer handlers to retain ownership until they finish.
   */
  renewTimerClaim?(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean>;
  /**
   * Releases a timer claim without mutating the timer record itself.
   * Used when recurring schedules re-arm the same stable timer id for their
   * next occurrence and the old lease must not block the new fire.
   */
  releaseTimerClaim?(timerId: string, workerId: string): Promise<boolean>;
  /**
   * Atomically finalizes a claimed timer only if `workerId` still owns the
   * timer-claim lease. Returns false when ownership was already lost.
   */
  finalizeClaimedTimer?(timerId: string, workerId: string): Promise<boolean>;
  deleteTimer(timerId: string): Promise<void>;

  createSchedule(schedule: Schedule): Promise<void>;
  getSchedule(id: string): Promise<Schedule | null>;
  updateSchedule(id: string, updates: Partial<Schedule>): Promise<void>;
  /**
   * Atomically persists the active schedule record together with its current
   * pending timer so recurring schedule state cannot diverge mid-update.
   */
  saveScheduleWithTimer(schedule: Schedule, timer: Timer): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  listSchedules(): Promise<Schedule[]>;
  listActiveSchedules(): Promise<Schedule[]>;

  // Operator helpers
  listStuckExecutions?(): Promise<Execution[]>;

  init?(): Promise<void>;
  dispose?(): Promise<void>;

  acquireLock?(resource: string, ttlMs: number): Promise<string | null>;
  /**
   * Renews an existing lock if and only if `lockId` still owns `resource`.
   * Returns true when renewed, false when lock is missing/expired/re-owned.
   */
  renewLock?(resource: string, lockId: string, ttlMs: number): Promise<boolean>;
  releaseLock?(resource: string, lockId: string): Promise<void>;
}
