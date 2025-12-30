export type ExecutionStatus =
  | "pending"
  | "running"
  | "retrying"
  | "sleeping"
  | "completed"
  | "compensation_failed"
  | "failed";

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

export type TimerType =
  | "sleep"
  | "timeout"
  | "scheduled"
  | "cron"
  | "retry"
  | "signal_timeout";

export interface Timer {
  id: string;
  executionId?: string;
  stepId?: string;
  scheduleId?: string;
  taskId?: string;
  input?: unknown;
  type: TimerType;
  fireAt: Date;
  status: "pending" | "fired";
}

export type ScheduleType = "cron" | "interval";

export interface Schedule<TInput = unknown> {
  id: string;
  taskId: string;
  type: ScheduleType;
  pattern: string;
  input: TInput | undefined;
  status: "active" | "paused";
  lastRun?: Date;
  nextRun?: Date;
  createdAt: Date;
  updatedAt: Date;
}
