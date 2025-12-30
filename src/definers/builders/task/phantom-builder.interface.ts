import type {
  DependencyMapType,
  IPhantomTask,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";

/**
 * Fluent builder interface for constructing phantom tasks.
 */
export interface PhantomTaskFluentBuilder<
  TInput = undefined,
  TResolved = any,
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = ITaskMeta,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
> {
  id: string;

  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TDeps & TNewDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TNewDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
    mw: TNewMw,
    options?: { override?: boolean },
  ): PhantomTaskFluentBuilder<TInput, TResolved, TDeps, TMeta, TTags, TNewMw>;

  // Append signature (default)
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: false },
  ): PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TDeps,
    TMeta,
    [...TTags, ...TNewTags],
    TMiddleware
  >;

  // Override signature (replace)
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options: { override: true },
  ): PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TDeps,
    TMeta,
    TNewTags,
    TMiddleware
  >;

  inputSchema<TNewInput>(
    schema: IValidationSchema<TNewInput>,
  ): PhantomTaskFluentBuilder<
    TNewInput,
    TResolved,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  resultSchema<TNewResolved>(
    schema: IValidationSchema<TNewResolved>,
  ): PhantomTaskFluentBuilder<
    TInput,
    TNewResolved,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TDeps,
    TNewMeta,
    TTags,
    TMiddleware
  >;

  build(): IPhantomTask<TInput, TResolved, TDeps, TMeta, TTags, TMiddleware>;
}
