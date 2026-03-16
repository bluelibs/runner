import type {
  DependencyMapType,
  EnsureTagsForTarget,
  ITask,
  ITaskDefinition,
  ITaskMeta,
  TagType,
  TaskTagType,
  TaskMiddlewareAttachmentType,
  ResolveValidationSchemaInput,
  ValidationSchemaInput,
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

  /** Adds task dependencies, merging by default unless `override: true` is used. */
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

  /** Replaces previously declared task dependencies. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): TaskFluentBuilder<TInput, TOutput, TNewDeps, TMeta, TTags, TMiddleware>;

  /** Attaches task middleware. */
  middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
    mw: TNewMw,
    options?: { override?: boolean },
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TNewMw>;

  /** Adds task tags, merging by default unless `override: true` is used. */
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

  /** Replaces previously declared task tags. */
  tags<const TNewTags extends TagType[]>(
    t: EnsureTagsForTarget<"tasks", TNewTags>,
    options: { override: true },
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TNewTags, TMiddleware>;

  /** Declares the task input schema. */
  inputSchema<
    TNewInput = never,
    TSchema extends ValidationSchemaInput<
      [TNewInput] extends [never] ? any : TNewInput
    > = ValidationSchemaInput<[TNewInput] extends [never] ? any : TNewInput>,
  >(
    schema: TSchema,
  ): TaskFluentBuilder<
    ResolveValidationSchemaInput<TNewInput, TSchema>,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  /**
   * Alias for inputSchema. Use this to define the task input validation contract.
   */
  schema<
    TNewInput = never,
    TSchema extends ValidationSchemaInput<
      [TNewInput] extends [never] ? any : TNewInput
    > = ValidationSchemaInput<[TNewInput] extends [never] ? any : TNewInput>,
  >(
    schema: TSchema,
  ): TaskFluentBuilder<
    ResolveValidationSchemaInput<TNewInput, TSchema>,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  /** Declares the task result schema. */
  resultSchema<
    TResolved = never,
    TSchema extends ValidationSchemaInput<
      [TResolved] extends [never] ? any : TResolved
    > = ValidationSchemaInput<[TResolved] extends [never] ? any : TResolved>,
  >(
    schema: TSchema,
  ): TaskFluentBuilder<
    TInput,
    Promise<ResolveValidationSchemaInput<TResolved, TSchema>>,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TNewMeta, TTags, TMiddleware>;

  /** Sets the task implementation and advances the builder into its post-run phase. */
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

  /** Declares typed errors associated with the task. */
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
  /** Declares typed errors associated with the task. */
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
  /** Attaches metadata used by docs and tooling. */
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
  /** Materializes the final task definition for registration or reuse. */
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
