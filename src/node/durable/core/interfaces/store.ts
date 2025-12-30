import type {
  Execution,
  ExecutionStatus,
  StepResult,
  Timer,
  Schedule,
} from "../types";

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
