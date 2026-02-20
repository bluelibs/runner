import type { AnyTask, ITask } from "../../../../types/task";
import type { IDurableContext } from "./context";
import type {
  DurableStartAndWaitResult,
  ExecuteOptions,
  IDurableService,
} from "./service";
import type { DurableOperator } from "../DurableOperator";
import type { DurableFlowShape } from "../flowShape";

export interface IDurableResource extends Pick<
  IDurableService,
  | "cancelExecution"
  | "wait"
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
   * @deprecated Use start(task, input, options).
   */
  startExecution<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<string>;
  /**
   * @deprecated Use start(task, input, options).
   */
  startExecution(
    task: string,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<string>;

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

  startAndWait<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;
  startAndWait<TResult = unknown>(
    task: string,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;

  /**
   * @deprecated Use startAndWait(task, input, options) and read `result.data`.
   */
  execute<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<TResult>;
  /**
   * @deprecated Use startAndWait(task, input, options) and read `result.data`.
   */
  execute<TResult = unknown>(
    task: string,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<TResult>;

  /**
   * @deprecated Use startAndWait(task, input, options).
   */
  executeStrict<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input?: TInput,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;
  /**
   * @deprecated Use startAndWait(task, input, options).
   */
  executeStrict<TResult = unknown>(
    task: string,
    input?: unknown,
    options?: ExecuteOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;

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

  /**
   * Returns all tasks tagged as durable workflows in the current runtime.
   */
  getWorkflows(): AnyTask[];
}
