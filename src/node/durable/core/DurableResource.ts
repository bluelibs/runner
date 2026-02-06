import { AsyncLocalStorage } from "node:async_hooks";
import type { IEventDefinition } from "../../../types/event";
import type { IDurableContext } from "./interfaces/context";
import type {
  DurableTask,
  ExecuteOptions,
  IDurableService,
  ScheduleOptions,
} from "./interfaces/service";
import type { Schedule } from "./types";
import type { IDurableStore } from "./interfaces/store";
import { DurableOperator } from "./DurableOperator";

export interface DurableResourceConfig {
  worker?: boolean;
}

export interface IDurableResource extends Pick<
  IDurableService,
  | "startExecution"
  | "cancelExecution"
  | "wait"
  | "execute"
  | "executeStrict"
  | "schedule"
  | "ensureSchedule"
  | "pauseSchedule"
  | "resumeSchedule"
  | "getSchedule"
  | "listSchedules"
  | "updateSchedule"
  | "removeSchedule"
  | "recover"
  | "signal"
> {
  /**
   * Reads the durable context for the currently running workflow execution.
   * Throws if called outside of a durable execution.
   */
  use(): IDurableContext;

  /**
   * Store-backed operator API to inspect and administrate executions
   * (steps/audit/history and operator actions where supported by the store).
   */
  readonly operator: DurableOperator;
}

/**
 * A Runner-facing wrapper around `DurableService` that exposes a per-instance
 * context store and the public durable API (`execute`, `signal`, `wait`, etc.).
 *
 * This enables tasks to depend on a specific durable instance and call
 * `durable.use()` to access the per-execution durable context.
 */
export class DurableResource implements IDurableResource {
  private operatorInstance: DurableOperator | null = null;

  constructor(
    public readonly service: IDurableService,
    private readonly contextStorage: AsyncLocalStorage<IDurableContext>,
    private readonly store?: IDurableStore,
  ) {}

  get operator(): DurableOperator {
    if (!this.store) {
      throw new Error(
        "Durable operator API is not available: store was not provided to DurableResource. Use a Runner durable resource (durableResource/memoryDurableResource/redisDurableResource) or construct a DurableOperator(store) directly.",
      );
    }
    if (!this.operatorInstance) {
      this.operatorInstance = new DurableOperator(this.store);
    }
    return this.operatorInstance;
  }

  use(): IDurableContext {
    const ctx = this.contextStorage.getStore();
    if (!ctx) {
      throw new Error(
        "Durable context is not available. Did you call durable.use() outside a durable task execution?",
      );
    }
    return ctx;
  }

  startExecution<TInput>(
    task: DurableTask<TInput, unknown>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<string> {
    return this.service.startExecution(task, input, options);
  }

  cancelExecution(executionId: string, reason?: string): Promise<void> {
    return this.service.cancelExecution(executionId, reason);
  }

  wait<TResult>(
    executionId: string,
    options?: { timeout?: number; waitPollIntervalMs?: number },
  ): Promise<TResult> {
    return this.service.wait<TResult>(executionId, options);
  }

  execute<TInput, TResult>(
    task: DurableTask<TInput, TResult>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<TResult> {
    return this.service.execute(task, input, options);
  }

  executeStrict<TInput, TResult>(
    task: undefined extends TResult ? never : DurableTask<TInput, TResult>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<TResult> {
    return this.service.executeStrict(task, input, options);
  }

  schedule<TInput>(
    task: DurableTask<TInput, unknown>,
    input: TInput | undefined,
    options: ScheduleOptions,
  ): Promise<string> {
    return this.service.schedule(task, input, options);
  }

  ensureSchedule<TInput>(
    task: DurableTask<TInput, unknown>,
    input: TInput | undefined,
    options: ScheduleOptions & { id: string },
  ): Promise<string> {
    return this.service.ensureSchedule(task, input, options);
  }

  pauseSchedule(scheduleId: string): Promise<void> {
    return this.service.pauseSchedule(scheduleId);
  }

  resumeSchedule(scheduleId: string): Promise<void> {
    return this.service.resumeSchedule(scheduleId);
  }

  getSchedule(scheduleId: string): Promise<Schedule | null> {
    return this.service.getSchedule(scheduleId);
  }

  listSchedules(): Promise<Schedule[]> {
    return this.service.listSchedules();
  }

  updateSchedule(
    scheduleId: string,
    updates: { cron?: string; interval?: number; input?: unknown },
  ): Promise<void> {
    return this.service.updateSchedule(scheduleId, updates);
  }

  removeSchedule(scheduleId: string): Promise<void> {
    return this.service.removeSchedule(scheduleId);
  }

  recover(): Promise<void> {
    return this.service.recover();
  }

  signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    return this.service.signal(executionId, signal, payload);
  }
}
