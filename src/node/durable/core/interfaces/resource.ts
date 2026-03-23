import type { AnyTask, ITask } from "../../../../types/task";
import type { IDurableContext } from "./context";
import type {
  DurableStartAndWaitResult,
  ExecuteOptions,
  IDurableService,
  StartAndWaitOptions,
} from "./service";
import type { DurableOperator } from "../DurableOperator";
import type { DurableAuditEntry } from "../audit";
import type { Execution, ExecutionStatus, StepResult } from "../types";

/**
 * Recursively optional input shape used for repository input matching.
 */
export type DurableExecutionInputFilter<TInput> = TInput extends Date
  ? Date
  : TInput extends Array<infer TItem>
    ? Array<DurableExecutionInputFilter<TItem>>
    : TInput extends object
      ? {
          [K in keyof TInput]?: DurableExecutionInputFilter<TInput[K]>;
        }
      : TInput;

/**
 * Date comparison operators supported by durable repository filters.
 */
export interface DurableExecutionDateFilter {
  $gt?: Date;
  $gte?: Date;
  $lt?: Date;
  $lte?: Date;
}

/**
 * Filter-only durable execution query for one workflow task repository.
 *
 * The bound repository already scopes results to one durable workflow key, so
 * `workflowKey` is intentionally omitted here.
 */
export interface DurableExecutionFilters<TInput = unknown> {
  id?: string;
  parentExecutionId?: string;
  status?: ExecutionStatus;
  attempt?: number;
  maxAttempts?: number;
  createdAt?: Date | DurableExecutionDateFilter;
  updatedAt?: Date | DurableExecutionDateFilter;
  completedAt?: Date | DurableExecutionDateFilter;
  input?: DurableExecutionInputFilter<TInput>;
}

/**
 * Collection-style query controls for durable repositories.
 */
export interface DurableExecutionQueryOptions {
  sort?: {
    createdAt?: 1 | -1;
    updatedAt?: 1 | -1;
    completedAt?: 1 | -1;
  };
  limit?: number;
  skip?: number;
}

/**
 * Fully hydrated execution detail returned by a task-scoped durable repository.
 */
export interface DurableExecutionRecord<TInput = unknown, TResult = unknown> {
  execution: Execution<TInput, TResult>;
  steps: StepResult[];
  audit: DurableAuditEntry[];
}

/**
 * Hydrated execution detail plus recursively attached child workflow executions.
 */
export interface DurableExecutionTreeNode<
  TInput = unknown,
  TResult = unknown,
> extends DurableExecutionRecord<TInput, TResult> {
  children: DurableExecutionTreeNode[];
}

/**
 * Typed read API scoped to one durable workflow task.
 */
export interface IDurableExecutionRepository<
  TInput = unknown,
  TResult = unknown,
> {
  /**
   * Lists executions matching the filters and applies optional collection controls.
   */
  find(
    filters?: DurableExecutionFilters<TInput>,
    options?: DurableExecutionQueryOptions,
  ): Promise<Array<DurableExecutionRecord<TInput, TResult>>>;

  /**
   * Lists matching executions, applies collection controls to the root selection,
   * and recursively attaches child workflow trees.
   */
  findTree(
    filters?: DurableExecutionFilters<TInput>,
    options?: DurableExecutionQueryOptions,
  ): Promise<Array<DurableExecutionTreeNode<TInput, TResult>>>;

  /**
   * Returns the first execution matching the filters, or `null`.
   */
  findOne(
    filters?: DurableExecutionFilters<TInput>,
  ): Promise<DurableExecutionRecord<TInput, TResult> | null>;

  /**
   * Returns the first execution matching the filters, or throws.
   */
  findOneOrFail(
    filters?: DurableExecutionFilters<TInput>,
  ): Promise<DurableExecutionRecord<TInput, TResult>>;
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
   * Returns a cached task-scoped repository for durable execution inspection.
   */
  getRepository<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
  ): IDurableExecutionRepository<TInput, TResult>;

  /**
   * Store-backed operator API to inspect and administrate executions
   * listings/history and operator actions where supported by the store.
   */
  readonly operator: DurableOperator;

  /**
   * Returns all tasks tagged as durable workflows in the current runtime.
   */
  getWorkflows(): AnyTask[];
}
