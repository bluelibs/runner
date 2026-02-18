import {
  DependencyMapType,
  DependencyValuesType,
  IOptionalDependency,
  IValidationSchema,
} from "./utilities";
import { TaskMiddlewareAttachmentType } from "./taskMiddleware";
import { TagType } from "./tag";
import { ITaskMeta } from "./meta";
import type { ThrowsList } from "./error";
import type { ExecutionJournal } from "./executionJournal";
import {
  symbolFilePath,
  symbolTask,
  symbolPhantomTask,
  symbolTunneledBy,
} from "./symbols";
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
export type { TagType } from "./tag";
export type { ITaskMeta } from "./meta";

export interface ITaskDefinition<
  TInput = undefined,
  TOutput extends Promise<unknown> = Promise<unknown>,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
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
  /**
   * Declares which typed errors are part of this task's contract.
   *
   * This is a declarative contract only:
   * - It does not imply dependency injection
   * - It does not enforce that only these errors can be thrown
   *
   * Use string ids or Error helpers.
   */
  throws?: ThrowsList;
  run: (
    input: HasInputContracts<[...TTags, ...TMiddleware]> extends true
      ? [TInput] extends [undefined]
        ? InferInputOrViolationFromContracts<[...TTags, ...TMiddleware]>
        : EnsureInputSatisfiesContracts<[...TTags, ...TMiddleware], TInput>
      : TInput,
    dependencies: DependencyValuesType<TDependencies>,
    context?: { journal: ExecutionJournal },
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
  TOutput extends Promise<unknown> = Promise<unknown>,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
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
  /** Present only for phantom tasks. */
  [symbolPhantomTask]?: true;
  /** Indicates if the task is tunneled through a tunnel client. */
  isTunneled?: boolean;
  /** Records which tunnel resource owns the task (exclusivity). */
  [symbolTunneledBy]?: string;
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  middleware: TMiddleware;
  /** Normalized list of error ids declared via `throws`. */
  throws?: readonly string[];
  /** Return an optional dependency wrapper for this task. */
  optional: () => IOptionalDependency<
    ITask<TInput, TOutput, TDependencies, TMeta, TTags, TMiddleware>
  >;
  tags: TTags;
}

export type AnyTask = ITask<any, any, any, any, any, any>;

/** Narrowed type for phantom tasks (throws unless routed through a tunnel). */
export type IPhantomTask<
  TInput = any,
  TResolved = any,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
> = ITask<
  TInput,
  Promise<TResolved>,
  TDependencies,
  TMeta,
  TTags,
  TMiddleware
> & { [symbolPhantomTask]: true };
