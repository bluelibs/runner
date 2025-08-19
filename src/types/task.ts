import {
  DependencyMapType,
  DependencyValuesType,
  IOptionalDependency,
  ITaskMiddleware,
  IValidationSchema,
  TaskMiddlewareAttachments,
} from "../defs";
import { TagType } from "./tag";
import { ITaskMeta } from "./meta";
import { symbolFilePath, symbolTask } from "./utilities";
import {
  EnsureInputSatisfiesContracts,
  EnsureOutputSatisfiesContracts,
  HasInputContracts,
  HasOutputContracts,
} from "./contracts";

export interface ITaskDefinition<
  TInput = undefined,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachments[] = TaskMiddlewareAttachments[],
> {
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
  inputSchema?: IValidationSchema<TInput>;
  /**
   * Optional validation schema for the task result.
   * When provided, the result will be validated immediately after the task's
   * `run` resolves, without considering middleware.
   */
  resultSchema?: IValidationSchema<
    TOutput extends Promise<infer U> ? U : never
  >;
  run: (
    input: HasInputContracts<[...TTags, ...TMiddleware]> extends true
      ? EnsureInputSatisfiesContracts<[...TTags, ...TMiddleware], TInput>
      : TInput,
    dependencies: DependencyValuesType<TDependencies>,
  ) => HasOutputContracts<[...TTags, ...TMiddleware]> extends true
    ? EnsureOutputSatisfiesContracts<[...TTags, ...TMiddleware], TOutput>
    : TOutput;
  /**
   * Tags applied to the task that might define its behvaiour or impact the systems.
   */
  tags?: TTags;
}

export interface ITask<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachments[] = TaskMiddlewareAttachments[],
> extends ITaskDefinition<
    TInput,
    TOutput,
    TDependencies,
    TMeta,
    TTags,
    TMiddleware
  > {
  [symbolFilePath]: string;
  [symbolTask]: true;
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  middleware: TMiddleware;
  /** Return an optional dependency wrapper for this task. */
  optional: () => IOptionalDependency<
    ITask<TInput, TOutput, TDependencies, TMeta, TTags, TMiddleware>
  >;
  tags: TTags;
}
