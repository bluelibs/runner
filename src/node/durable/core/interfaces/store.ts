import type {
  Execution,
  ExecutionStatus,
  StepResult,
  Timer,
  Schedule,
} from "../types";
import type { DurableAuditEntry } from "../audit";

export interface ListExecutionsOptions {
  status?: ExecutionStatus[];
  taskId?: string;
  limit?: number;
  offset?: number;
}

export interface IDurableStore {
  saveExecution(execution: Execution): Promise<void>;
  getExecution(id: string): Promise<Execution | null>;
  updateExecution(id: string, updates: Partial<Execution>): Promise<void>;
  listIncompleteExecutions(): Promise<Execution[]>;

  // Enhanced querying for dashboard
  listExecutions?(options?: ListExecutionsOptions): Promise<Execution[]>;
  listStepResults?(executionId: string): Promise<StepResult[]>;
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

  createTimer(timer: Timer): Promise<void>;
  getReadyTimers(now?: Date): Promise<Timer[]>;
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
  deleteTimer(timerId: string): Promise<void>;

  createSchedule(schedule: Schedule): Promise<void>;
  getSchedule(id: string): Promise<Schedule | null>;
  updateSchedule(id: string, updates: Partial<Schedule>): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  listSchedules(): Promise<Schedule[]>;
  listActiveSchedules(): Promise<Schedule[]>;

  // Operator / dashboard helpers
  listStuckExecutions?(): Promise<Execution[]>;

  init?(): Promise<void>;
  dispose?(): Promise<void>;

  acquireLock?(resource: string, ttlMs: number): Promise<string | null>;
  releaseLock?(resource: string, lockId: string): Promise<void>;
}
