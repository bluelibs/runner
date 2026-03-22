import type { AnyTask, ITask } from "../../../../types/task";
import type { IDurableContext } from "./context";
import type {
  DurableStartAndWaitResult,
  ExecuteOptions,
  IDurableService,
  StartAndWaitOptions,
} from "./service";
import type { DurableOperator } from "../DurableOperator";
import type { DurableFlowShape } from "../flowShape";
import type { DurableAuditEntry } from "../audit";
import type { Execution, StepResult } from "../types";

export interface DurableExecutionDetail<TInput = unknown, TResult = unknown> {
  execution: Execution<TInput, TResult> | null;
  steps: StepResult[];
  audit: DurableAuditEntry[];
}

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
    options?: StartAndWaitOptions,
  ): Promise<DurableStartAndWaitResult<TResult>>;
  startAndWait<TResult = unknown>(
    task: string,
    input?: unknown,
    options?: StartAndWaitOptions,
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
   * Typed shorthand for execution detail inspection.
   *
   * Uses the supplied task as a type witness and verifies that the stored
   * durable execution belongs to that task's canonical runtime identity.
   */
  getExecutionDetail<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    executionId: string,
  ): Promise<DurableExecutionDetail<TInput, TResult>>;

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
