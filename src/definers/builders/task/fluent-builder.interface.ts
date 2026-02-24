import type {
  DependencyMapType,
  EnsureTagsForTarget,
  ITask,
  ITaskDefinition,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskTagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import type { ResolveInput } from "./types";

/**
 * Fluent builder interface for constructing tasks before `.run(...)`.
 */
export interface TaskFluentBuilder<
  TInput = undefined,
  TOutput extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = ITaskMeta,
  TTags extends TaskTagType[] = TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
> {
  id: string;

  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): TaskFluentBuilder<
    TInput,
    TOutput,
    TDeps & TNewDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): TaskFluentBuilder<TInput, TOutput, TNewDeps, TMeta, TTags, TMiddleware>;

  middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
    mw: TNewMw,
    options?: { override?: boolean },
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TNewMw>;

  // Append signature (default)
  tags<const TNewTags extends TagType[]>(
    t: EnsureTagsForTarget<"tasks", TNewTags>,
    options?: { override?: false },
  ): TaskFluentBuilder<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    [...TTags, ...TNewTags],
    TMiddleware
  >;

  // Override signature (replace)
  tags<const TNewTags extends TagType[]>(
    t: EnsureTagsForTarget<"tasks", TNewTags>,
    options: { override: true },
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TNewTags, TMiddleware>;

  inputSchema<TNewInput>(
    schema: IValidationSchema<TNewInput>,
  ): TaskFluentBuilder<TNewInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;

  /**
   * Alias for inputSchema. Use this to define the task input validation contract.
   */
  schema<TNewInput>(
    schema: IValidationSchema<TNewInput>,
  ): TaskFluentBuilder<TNewInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;

  resultSchema<TResolved>(
    schema: IValidationSchema<TResolved>,
  ): TaskFluentBuilder<
    TInput,
    Promise<TResolved>,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TNewMeta, TTags, TMiddleware>;

  run<TNewInput = TInput, TNewOutput extends Promise<any> = TOutput>(
    fn: NonNullable<
      ITaskDefinition<
        ResolveInput<TInput, TNewInput>,
        TNewOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >["run"]
    >,
  ): TaskFluentBuilderAfterRun<
    ResolveInput<TInput, TNewInput>,
    TNewOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  throws(
    list: ThrowsList,
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
}

/**
 * Fluent builder interface for tasks after `.run(...)`.
 * Shape-changing methods are intentionally unavailable.
 */
export interface TaskFluentBuilderAfterRun<
  TInput = undefined,
  TOutput extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = ITaskMeta,
  TTags extends TaskTagType[] = TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
> {
  id: string;
  throws(
    list: ThrowsList,
  ): TaskFluentBuilderAfterRun<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): TaskFluentBuilderAfterRun<
    TInput,
    TOutput,
    TDeps,
    TNewMeta,
    TTags,
    TMiddleware
  >;
  build(): ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
}

export type TaskFluentBuilderPhase<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
  THasRun extends boolean,
> = THasRun extends true
  ? TaskFluentBuilderAfterRun<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>
  : TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
