import {
  DependencyMapType,
  DependencyValuesType,
  IOptionalDependency,
  IValidationSchema,
  ValidationSchemaInput,
} from "./utilities";
import { TaskMiddlewareAttachmentType } from "./taskMiddleware";
import { TaskTagType } from "./tag";
import { ITaskMeta } from "./meta";
import type { NormalizedThrowsList, ThrowsList } from "./error";
import type { ExecutionJournal } from "./executionJournal";
import type { RuntimeCallSource } from "./runtimeSource";
import {
  symbolFilePath,
  symbolTask,
  symbolRpcLanePolicy,
  symbolRpcLaneRoutedBy,
} from "./symbols";
import type { IRpcLanePolicy } from "./rpcLane";
import {
  EnsureInputSatisfiesContracts,
  EnsureOutputSatisfiesContracts,
  HasInputContracts,
  HasOutputContracts,
  InferInputOrViolationFromContracts,
} from "./contracts";

export type {
  DependencyMapType,
  DependencyValuesType,
  IOptionalDependency,
} from "./utilities";
export type { TaskMiddlewareAttachmentType } from "./taskMiddleware";
export type { TagType, TaskTagType } from "./tag";
export type { ITaskMeta } from "./meta";

/**
 * Runtime context passed to task implementations.
 */
export type TaskRunContext = {
  /** Per-execution journal shared with middleware and nested calls. */
  journal: ExecutionJournal;
  /** Origin metadata describing how this task invocation was admitted. */
  source: RuntimeCallSource;
  /** Cooperative cancellation signal for the current task execution when one exists. */
  signal?: AbortSignal;
};

/**
 * Declarative task definition contract.
 */
export interface ITaskDefinition<
  TInput = undefined,
  TOutput extends Promise<unknown> = Promise<unknown>,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TaskTagType[] = TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
> {
  /** Stable task identifier within its owner subtree. */
  id: string;
  /**
   * Access other tasks/resources/events. Can be an object or a function when
   * you need late or config‑dependent resolution.
   */
  dependencies?: TDependencies | (() => TDependencies);
  /** Middleware applied around task execution. */
  middleware?: TMiddleware;
  /** Optional metadata used for docs, filtering and tooling. */
  meta?: TMeta;
  /**
   * Optional validation schema for runtime input validation.
   * When provided, task input will be validated before execution.
   */
  inputSchema?: ValidationSchemaInput<TInput>;
  /**
   * Optional validation schema for the task result.
   * When provided, the result will be validated immediately after the task's
   * `run` resolves, without considering middleware.
   */
  resultSchema?: ValidationSchemaInput<
    TOutput extends Promise<infer U> ? U : never
  >;
  /**
   * Declares which typed errors are part of this task's contract.
   *
   * This is a declarative contract only:
   * - It does not imply dependency injection
   * - It does not enforce that only these errors can be thrown
   *
   * Use Runner error helpers only.
   */
  throws?: ThrowsList;
  /**
   * Task implementation body.
   *
   * Runner validates input before this runs and validates the result immediately
   * after it resolves when schemas are configured.
   */
  run: (
    input: HasInputContracts<[...TTags, ...TMiddleware]> extends true
      ? [TInput] extends [undefined]
        ? InferInputOrViolationFromContracts<[...TTags, ...TMiddleware]>
        : EnsureInputSatisfiesContracts<[...TTags, ...TMiddleware], TInput>
      : TInput,
    dependencies: DependencyValuesType<TDependencies>,
    context?: TaskRunContext,
  ) => HasOutputContracts<[...TTags, ...TMiddleware]> extends true
    ? EnsureOutputSatisfiesContracts<[...TTags, ...TMiddleware], TOutput>
    : TOutput;
  /**
   * Tags applied to the task that may affect contracts, routing, or runtime behavior.
   */
  tags?: TTags;
}

/**
 * Normalized runtime task definition.
 */
export interface ITask<
  TInput = any,
  TOutput extends Promise<unknown> = Promise<unknown>,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TaskTagType[] = TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
> extends Omit<
  ITaskDefinition<TInput, TOutput, TDependencies, TMeta, TTags, TMiddleware>,
  "throws"
> {
  /** Source file where the task was defined. */
  [symbolFilePath]: string;
  /** Brand marker used by runtime checks and tooling. */
  [symbolTask]: true;
  path?: string;
  /** Indicates if the task was patched for remote execution through rpc lanes. */
  isRpcRouted?: boolean;
  /** Records which rpc-lanes resource owns the task routing patch (exclusivity). */
  [symbolRpcLaneRoutedBy]?: string;
  /** Stores lane policy used for caller-side middleware filtering. */
  [symbolRpcLanePolicy]?: IRpcLanePolicy;
  id: string;
  /** Normalized dependency declaration. */
  dependencies: TDependencies | (() => TDependencies);
  /** Resolved dependency values cached by the runtime when needed. */
  computedDependencies?: DependencyValuesType<TDependencies>;
  /** Middleware attachments applied around task execution. */
  middleware: TMiddleware;
  /** Normalized input validation schema. */
  inputSchema?: IValidationSchema<TInput>;
  /** Normalized result validation schema. */
  resultSchema?: IValidationSchema<
    TOutput extends Promise<infer U> ? U : never
  >;
  /** Normalized list of error ids declared via `throws`. */
  throws?: NormalizedThrowsList;
  /** Return an optional dependency wrapper for this task. */
  optional: () => IOptionalDependency<
    ITask<TInput, TOutput, TDependencies, TMeta, TTags, TMiddleware>
  >;
  /** Normalized tags attached to the task. */
  tags: TTags;
}

/**
 * Convenience alias for any task regardless of generic parameters.
 */
export type AnyTask = ITask<any, any, any, any, any, any>;
