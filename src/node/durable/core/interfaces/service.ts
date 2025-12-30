import type { ITask } from "../../../../types/task";
import type { IEventDefinition } from "../../../../types/event";
import type { IDurableStore } from "./store";
import type { IDurableQueue } from "./queue";
import type { IEventBus } from "./bus";
import type { Schedule } from "../types";

export type DurableTask<TInput = unknown, TResult = unknown> = ITask<
  TInput,
  Promise<TResult>,
  any
>;

export interface ITaskExecutor {
  run<TInput, TResult>(
    task: DurableTask<TInput, TResult>,
    input?: TInput,
  ): Promise<unknown>;
}

export interface ScheduleConfig<TInput = unknown> {
  id: string;
  task: DurableTask<any, unknown>;
  cron?: string;
  interval?: number;
  input: TInput;
}

export interface DurableServiceConfig {
  store: IDurableStore;
  queue?: IDurableQueue;
  eventBus?: IEventBus;
  taskExecutor?: ITaskExecutor;
  polling?: {
    interval?: number;
  };
  execution?: {
    maxAttempts?: number;
    timeout?: number;
  };
  schedules?: ScheduleConfig[];
  tasks?: Array<DurableTask<any, any>>;
}

export interface ExecuteOptions {
  timeout?: number;
  priority?: number;
  waitPollIntervalMs?: number;
}

export interface ScheduleOptions {
  id?: string;
  at?: Date;
  delay?: number;
  cron?: string;
  interval?: number;
}

export interface IDurableService {
  startExecution<TInput>(
    task: DurableTask<TInput, unknown>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<string>;

  wait<TResult>(
    executionId: string,
    options?: { timeout?: number; waitPollIntervalMs?: number },
  ): Promise<TResult>;

  execute<TInput, TResult>(
    task: DurableTask<TInput, TResult>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<TResult>;

  schedule<TInput>(
    task: DurableTask<TInput, unknown>,
    input: TInput | undefined,
    options: ScheduleOptions,
  ): Promise<string>;

  recover(): Promise<void>;

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
    signal: string | IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void>;
}

export interface IDurableExecutionProcessor {
  processExecution(executionId: string): Promise<void>;
}
