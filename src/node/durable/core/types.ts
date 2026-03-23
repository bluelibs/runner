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

/**
 * Extra metadata for active durable step tracking.
 *
 * `childWorkflowKey` uses the durable persisted workflow identity so
 * dashboards and operator tooling see the same stable child workflow key that
 * durable uses.
 */
export interface DurableExecutionCurrentWorkflowMeta {
  childWorkflowKey: string;
}

/**
 * Canonical live view of a durable execution suspended in `sleep()`.
 */
export interface DurableExecutionCurrentSleep {
  kind: "sleep";
  stepId: string;
  /** Timestamp when this current state was persisted or last restored. */
  startedAt: Date;
  waitingFor: {
    type: "sleep";
    params: {
      durationMs?: number;
      fireAtMs: number;
      timerId: string;
    };
  };
}

/**
 * Canonical live view of a durable execution suspended in `waitForSignal()`.
 */
export interface DurableExecutionCurrentSignalWait {
  kind: "waitForSignal";
  stepId: string;
  /** Timestamp when this current state was persisted or last restored. */
  startedAt: Date;
  waitingFor: {
    type: "signal";
    params: {
      signalId: string;
      timeoutMs?: number;
      timeoutAtMs?: number;
      timerId?: string;
    };
  };
}

/**
 * Canonical live view of a durable execution suspended in `waitForExecution()`.
 */
export interface DurableExecutionCurrentExecutionWait {
  kind: "waitForExecution";
  stepId: string;
  /** Timestamp when this current state was persisted or last restored. */
  startedAt: Date;
  waitingFor: {
    type: "execution";
    params: {
      targetExecutionId: string;
      targetWorkflowKey: string;
      timeoutMs?: number;
      timeoutAtMs?: number;
      timerId?: string;
    };
  };
}

/**
 * Best-effort live view of a durable execution actively running user code
 * inside a durable step.
 */
export interface DurableExecutionCurrentStep {
  kind: "step";
  stepId: string;
  /** Timestamp when this active position was recorded. */
  startedAt: Date;
  meta?: DurableExecutionCurrentWorkflowMeta;
}

/**
 * Best-effort live view of a durable execution evaluating a durable switch.
 */
export interface DurableExecutionCurrentSwitch {
  kind: "switch";
  stepId: string;
  /** Timestamp when this active position was recorded. */
  startedAt: Date;
}

/**
 * Live execution position for operator tooling and status reads.
 *
 * Waiting states are durable truth because they are derived from persisted wait
 * state. Active states are best-effort because abrupt process loss can leave a
 * stale in-flight position until the next durable transition overwrites it.
 */
export type DurableExecutionCurrent =
  | DurableExecutionCurrentSleep
  | DurableExecutionCurrentSignalWait
  | DurableExecutionCurrentExecutionWait
  | DurableExecutionCurrentStep
  | DurableExecutionCurrentSwitch;

export interface Execution<TInput = unknown, TResult = unknown> {
  id: string;
  workflowKey: string;
  /** Optional parent execution when this workflow was started by another durable workflow. */
  parentExecutionId?: string;
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
  /**
   * Optional live execution position for operator tooling and status pages.
   *
   * Waiting states are canonical durable truth. Active states are best-effort.
   */
  current?: DurableExecutionCurrent;
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

/**
 * Persisted delivery record for a durable signal.
 */
export interface DurableSignalRecord<TPayload = unknown> {
  /**
   * Unique signal-record identifier for dedupe/history purposes.
   */
  id: string;
  payload: TPayload;
  receivedAt: Date;
}

/**
 * Queued durable signal payload stored before a waiter consumes it.
 */
export interface DurableQueuedSignalRecord<
  TPayload = unknown,
> extends DurableSignalRecord<TPayload> {}

/**
 * Persisted signal journal state for one execution + signal id pair.
 */
export interface DurableSignalState<TPayload = unknown> {
  executionId: string;
  signalId: string;
  queued: Array<DurableQueuedSignalRecord<TPayload>>;
  history: Array<DurableSignalRecord<TPayload>>;
}

/**
 * Indexed durable signal waiter metadata used to resume the earliest waiter.
 */
export interface DurableSignalWaiter {
  executionId: string;
  signalId: string;
  stepId: string;
  /**
   * Deterministic ordering key for waiter selection.
   */
  sortKey: string;
  /**
   * Optional timeout timer id associated with this waiter.
   */
  timerId?: string;
}

/**
 * Indexed durable execution waiter metadata used to resume parent workflows
 * once another execution reaches a terminal state.
 */
export interface DurableExecutionWaiter {
  /**
   * Parent execution currently suspended in `waitForExecution()`.
   */
  executionId: string;
  /**
   * Target execution being awaited.
   */
  targetExecutionId: string;
  /**
   * Durable wait step persisted in the parent execution.
   */
  stepId: string;
  /**
   * Optional timeout timer id associated with this waiter.
   */
  timerId?: string;
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
  workflowKey?: string;
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
  workflowKey: string;
  type: ScheduleType;
  pattern: string;
  input: TInput | undefined;
  status: ScheduleStatus;
  lastRun?: Date;
  nextRun?: Date;
  createdAt: Date;
  updatedAt: Date;
}
