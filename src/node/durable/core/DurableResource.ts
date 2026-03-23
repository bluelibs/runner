import { AsyncLocalStorage } from "node:async_hooks";
import type { Store } from "../../../models/Store";
import type { IEventDefinition } from "../../../types/event";
import type { AnyTask, ITask } from "../../../types/task";
import type {
  DependencyMapType,
  DependencyValuesType,
} from "../../../types/utilities";
import type { IDurableContext } from "./interfaces/context";
import type {
  IDurableExecutionRepository,
  IDurableResource,
} from "./interfaces/resource";
import type {
  DurableStartAndWaitResult,
  EnsureScheduleOptions,
  ExecuteOptions,
  IDurableService,
  RecoverReportType,
  ScheduleOptions,
  StartAndWaitOptions,
} from "./interfaces/service";
import type { Schedule } from "./types";
import type { IDurableStore } from "./interfaces/store";
import { DurableOperator } from "./DurableOperator";
import { DurableExecutionRepository } from "./DurableExecutionRepository";
import { recordFlowShape, type DurableFlowShape } from "./flowShape";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";
import { durableExecutionInvariantError } from "../../../errors";
import {
  resolveRequestedIdFromStore,
  toCanonicalDefinitionFromStore,
} from "../../../models/StoreLookup";

export type {
  DurableExecutionDateFilter,
  DurableExecutionFilters,
  DurableExecutionInputFilter,
  DurableExecutionQueryOptions,
  DurableExecutionRecord,
  DurableExecutionTreeNode,
  IDurableExecutionRepository,
  IDurableResource,
} from "./interfaces/resource";

export interface DurableResourceConfig {
  worker?: boolean;
}

/**
 * A Runner-facing wrapper around `DurableService` that exposes a per-instance
 * context store and the public durable API (`start`, `startAndWait`, `signal`, `wait`, etc.).
 *
 * This enables tasks to depend on a specific durable instance and call
 * `durable.use()` to access the per-execution durable context.
 */
export class DurableResource implements IDurableResource {
  private operatorInstance: DurableOperator | null = null;
  private readonly repositories = new Map<
    string,
    IDurableExecutionRepository<any, any>
  >();

  constructor(
    public readonly service: IDurableService,
    private readonly contextStorage: AsyncLocalStorage<IDurableContext>,
    private readonly store?: IDurableStore,
    private readonly runnerStore?: Store,
  ) {}

  get operator(): DurableOperator {
    if (!this.store) {
      durableExecutionInvariantError.throw({
        message:
          "Durable operator API is not available: store was not provided to DurableResource. Use a Runner durable workflow resource (for example `resources.memoryWorkflow.fork(...)` or `resources.redisWorkflow.fork(...)`) or construct a DurableOperator(store) directly.",
      });
    }
    if (!this.operatorInstance) {
      this.operatorInstance = new DurableOperator(this.store!);
    }
    return this.operatorInstance;
  }

  use(): IDurableContext {
    const durableContext = this.contextStorage.getStore();
    if (!durableContext) {
      return durableExecutionInvariantError.throw({
        message:
          "Durable context is not available. Did you call durable.use() outside a durable task execution?",
      });
    }
    return durableContext;
  }

  async describe<TInput>(
    task: ITask<TInput, any, any, any, any, any>,
    input?: TInput,
  ): Promise<DurableFlowShape> {
    const runnerStore = this.requireRunnerStoreForDescribe();

    const storeTask = runnerStore.tasks.get(task.id);
    this.assertStoreTaskRegistered(task.id, storeTask);

    const effectiveTask = storeTask.task as AnyTask;
    if (!storeTask.computedDependencies) {
      durableExecutionInvariantError.throw({
        message: `Cannot describe task "${task.id}": task dependencies are not available in the runtime store.`,
      });
    }
    const deps = storeTask.computedDependencies as Record<string, unknown>;
    const resolvedInput = this.resolveDescribeInput(effectiveTask, input);

    return await recordFlowShape(async (recordingContext) => {
      const describeDeps = this.createDescribeDependencies(
        effectiveTask.id,
        deps,
        recordingContext,
      );
      await effectiveTask.run(
        resolvedInput as TInput,
        describeDeps as DependencyValuesType<DependencyMapType>,
      );
    });
  }

  getWorkflows(): AnyTask[] {
    const runnerStore = this.requireRunnerStoreForWorkflowDiscovery();
    if (typeof runnerStore.getTagAccessor !== "function") {
      return durableExecutionInvariantError.throw({
        message:
          "Durable workflow discovery requires Store.getTagAccessor(tag).",
      });
    }

    const tasks = runnerStore
      .getTagAccessor(durableWorkflowTag)
      .tasks.map((entry) => entry.definition);

    return tasks.map((task) =>
      toCanonicalDefinitionFromStore(runnerStore, task),
    );
  }

  getRepository<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
  ): IDurableExecutionRepository<TInput, TResult> {
    const runnerStore = this.requireRunnerStoreForRepository();
    const taskId = resolveRequestedIdFromStore(runnerStore, task);

    if (!taskId) {
      return durableExecutionInvariantError.throw({
        message:
          `Durable repository API is not available for task "${task.id}": ` +
          "the task is not registered in the runtime store.",
      });
    }

    const cached = this.repositories.get(taskId);
    if (cached) {
      return cached as IDurableExecutionRepository<TInput, TResult>;
    }

    const repository = new DurableExecutionRepository({
      task,
      store: this.requireStoreForRepository(),
      operator: this.operator,
      runnerStore,
    });
    this.repositories.set(taskId, repository);

    return repository;
  }

  private requireRunnerStoreForDescribe(): Store {
    const runnerStore = this.runnerStore;
    this.assertRunnerStore(
      runnerStore,
      "Durable describe API is not available: runner store was not provided to DurableResource. Use a Runner durable workflow resource (for example `resources.memoryWorkflow.fork(...)` or `resources.redisWorkflow.fork(...)`) instead of manually constructing DurableResource.",
    );
    return runnerStore;
  }

  private requireRunnerStoreForRepository(): Store {
    const runnerStore = this.runnerStore;
    this.assertRunnerStore(
      runnerStore,
      "Durable repository API is not available: runner store was not provided to DurableResource. Use a Runner durable workflow resource (for example `resources.memoryWorkflow.fork(...)` or `resources.redisWorkflow.fork(...)`) instead of manually constructing DurableResource.",
    );
    return runnerStore;
  }

  private requireStoreForRepository(): IDurableStore {
    if (!this.store) {
      return durableExecutionInvariantError.throw({
        message:
          "Durable repository API is not available: store was not provided to DurableResource. Use a Runner durable workflow resource (for example `resources.memoryWorkflow.fork(...)` or `resources.redisWorkflow.fork(...)`) instead of manually constructing DurableResource.",
      });
    }

    return this.store;
  }

  private requireRunnerStoreForWorkflowDiscovery(): Store {
    const runnerStore = this.runnerStore;
    this.assertRunnerStore(
      runnerStore,
      "Durable workflow discovery is not available: runner store was not provided to DurableResource. Use a Runner durable workflow resource (for example `resources.memoryWorkflow.fork(...)` or `resources.redisWorkflow.fork(...)`) instead of manually constructing DurableResource.",
    );
    return runnerStore;
  }

  private assertRunnerStore(
    runnerStore: Store | undefined,
    message: string,
  ): asserts runnerStore is Store {
    if (!runnerStore) {
      durableExecutionInvariantError.throw({
        message,
      });
    }
  }

  private assertStoreTaskRegistered(
    taskId: string,
    storeTask: ReturnType<Store["tasks"]["get"]>,
  ): asserts storeTask is NonNullable<ReturnType<Store["tasks"]["get"]>> {
    if (!storeTask) {
      durableExecutionInvariantError.throw({
        message: `Cannot describe task "${taskId}": task is not registered in the runtime store.`,
      });
    }
  }

  private createDescribeDependencies(
    taskId: string,
    deps: Record<string, unknown>,
    recordingContext: unknown,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(deps)) {
      if (value instanceof DurableResource) {
        next[key] = new Proxy(value, {
          get(target, prop, receiver) {
            if (prop === "use") {
              return () => recordingContext;
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        continue;
      }

      try {
        next[key] = structuredClone(value);
      } catch (error) {
        durableExecutionInvariantError.throw({
          message:
            `Cannot describe task "${taskId}": dependency "${key}" is not structured-cloneable. ` +
            `Describe runs with dependency snapshots to avoid side effects. Original error: ${this.getCloneErrorMessage(error)}`,
        });
      }
    }

    return next;
  }

  private resolveDescribeInput<TInput>(
    task: AnyTask,
    input: TInput | undefined,
  ): TInput | undefined {
    if (input !== undefined) {
      return input;
    }

    const tagConfig = durableWorkflowTag.extract(task.tags);
    if (!tagConfig?.defaults) {
      return undefined;
    }

    try {
      return structuredClone(tagConfig.defaults) as TInput;
    } catch (error) {
      durableExecutionInvariantError.throw({
        message:
          `Cannot describe task "${task.id}": durableWorkflowTag.defaults could not be cloned. ` +
          `Ensure defaults contain only structured-cloneable values. Original error: ${this.getCloneErrorMessage(error)}`,
      });
    }
  }

  private getCloneErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

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
  start(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<string> {
    if (typeof task === "string") {
      return this.service.start(task, input, options);
    }
    return this.service.start(task, input, options);
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
  startAndWait(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input?: unknown,
    options?: StartAndWaitOptions,
  ): Promise<DurableStartAndWaitResult<unknown>> {
    if (typeof task === "string") {
      return this.service.startAndWait(task, input, options);
    }
    return this.service.startAndWait(task, input, options);
  }

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
  schedule(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options: ScheduleOptions,
  ): Promise<string> {
    if (typeof task === "string") {
      return this.service.schedule(task, input, options);
    }
    return this.service.schedule(task, input, options);
  }

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
  ensureSchedule(
    task: string | ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options: EnsureScheduleOptions & { id: string },
  ): Promise<string> {
    if (typeof task === "string") {
      return this.service.ensureSchedule(task, input, options);
    }
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

  recover(): Promise<RecoverReportType> {
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
