import { AsyncLocalStorage } from "node:async_hooks";
import type { Store } from "../../../models/Store";
import type { IEventDefinition } from "../../../types/event";
import type { AnyTask, ITask } from "../../../types/task";
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
import { recordFlowShape, type DurableFlowShape } from "./flowShape";

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
   * Describe a durable workflow task using real runtime dependencies.
   *
   * - Non-durable deps are kept as-is (so pre-step control flow can use them).
   * - Durable deps are shimmed so `durable.use()` returns the recorder context.
   *
   * The task must be registered in the runtime store (ie. part of the app tree).
   *
   * Accepts any Runner `ITask`. Generic `TInput` is inferred from the task,
   * or can be specified explicitly: `describe<MyInput>(task, input)`.
   */
  describe<TInput>(
    task: ITask<TInput, any, any, any, any, any>,
    input?: TInput,
  ): Promise<DurableFlowShape>;

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
    private readonly runnerStore?: Store,
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

  async describe<TInput>(
    task: ITask<TInput, any, any, any, any, any>,
    input?: TInput,
  ): Promise<DurableFlowShape> {
    if (!this.runnerStore) {
      throw new Error(
        "Durable describe API is not available: runner store was not provided to DurableResource. Use a Runner durable resource (durableResource/memoryDurableResource/redisDurableResource) instead of manually constructing DurableResource.",
      );
    }

    const storeTask = this.runnerStore.tasks.get(task.id);
    if (!storeTask) {
      throw new Error(
        `Cannot describe task "${task.id}": task is not registered in the runtime store.`,
      );
    }

    const effectiveTask = storeTask.task as AnyTask;
    if (!storeTask.computedDependencies) {
      throw new Error(
        `Cannot describe task "${task.id}": task dependencies are not available in the runtime store.`,
      );
    }
    const deps = storeTask.computedDependencies as Record<string, unknown>;

    return await recordFlowShape(async (ctx) => {
      const depsWithRecorder = this.injectRecorderIntoDurableDeps(deps, ctx);
      await effectiveTask.run(input as TInput, depsWithRecorder as any);
    });
  }

  private injectRecorderIntoDurableDeps(
    deps: Record<string, unknown>,
    ctx: unknown,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...deps };

    for (const [key, value] of Object.entries(deps)) {
      if (!(value instanceof DurableResource)) {
        continue;
      }

      next[key] = new Proxy(value, {
        get(target, prop, receiver) {
          if (prop === "use") {
            return () => ctx;
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    }

    return next;
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
