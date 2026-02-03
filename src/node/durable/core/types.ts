export const ExecutionStatus = {
  Pending: "pending",
  Running: "running",
  Retrying: "retrying",
  Sleeping: "sleeping",
  Completed: "completed",
  CompensationFailed: "compensation_failed",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;

export type ExecutionStatus =
  (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

export interface Execution<TInput = unknown, TResult = unknown> {
  id: string;
  taskId: string;
  input: TInput | undefined;
  status: ExecutionStatus;
  result?: TResult;
  error?: {
    message: string;
    stack?: string;
  };
  /** Optional cancellation metadata (cooperative cancellation). */
  cancelledAt?: Date;
  cancelRequestedAt?: Date;
  attempt: number;
  maxAttempts: number;
  timeout?: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface StepResult<T = unknown> {
  executionId: string;
  stepId: string;
  result: T;
  completedAt: Date;
}

export const TimerType = {
  Sleep: "sleep",
  Timeout: "timeout",
  Scheduled: "scheduled",
  Cron: "cron",
  Retry: "retry",
  SignalTimeout: "signal_timeout",
} as const;

export type TimerType = (typeof TimerType)[keyof typeof TimerType];

export const TimerStatus = {
  Pending: "pending",
  Fired: "fired",
} as const;

export type TimerStatus = (typeof TimerStatus)[keyof typeof TimerStatus];

export interface Timer {
  id: string;
  executionId?: string;
  stepId?: string;
  scheduleId?: string;
  taskId?: string;
  input?: unknown;
  type: TimerType;
  fireAt: Date;
  status: TimerStatus;
}

export const ScheduleType = {
  Cron: "cron",
  Interval: "interval",
} as const;

export type ScheduleType = (typeof ScheduleType)[keyof typeof ScheduleType];

export const ScheduleStatus = {
  Active: "active",
  Paused: "paused",
} as const;

export type ScheduleStatus =
  (typeof ScheduleStatus)[keyof typeof ScheduleStatus];

export interface Schedule<TInput = unknown> {
  id: string;
  taskId: string;
  type: ScheduleType;
  pattern: string;
  input: TInput | undefined;
  status: ScheduleStatus;
  lastRun?: Date;
  nextRun?: Date;
  createdAt: Date;
  updatedAt: Date;
}
