import type {
  DependencyMapType,
  ITask,
  ITaskDefinition,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import type { ResolveInput } from "./types";

/**
 * Fluent builder interface for constructing tasks.
 */
export interface TaskFluentBuilder<
  TInput = undefined,
  TOutput extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = ITaskMeta,
  TTags extends TagType[] = TagType[],
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
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
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
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
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
  ): TaskFluentBuilder<
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

  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TNewMeta, TTags, TMiddleware>;

  build(): ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
}
