import type {
  DependencyMapType,
  EnsureTagsForTarget,
  ResolveValidationSchemaInput,
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  IMiddlewareMeta,
  TaskMiddlewareTagType,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export interface TaskMiddlewareFluentBuilderBeforeRun<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
> {
  id: string;
  /** Adds middleware dependencies, merging by default unless `override: true` is used. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options?: { override?: false },
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D & TNewDeps>;
  /** Replaces previously declared middleware dependencies. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options: { override: true },
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, TNewDeps>;
  /** Declares the middleware configuration schema. */
  configSchema<
    TNew = never,
    TSchema extends ValidationSchemaInput<[TNew] extends [never] ? any : TNew> =
      ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
  >(
    schema: TSchema,
  ): TaskMiddlewareFluentBuilderBeforeRun<
    ResolveValidationSchemaInput<TNew, TSchema>,
    In,
    Out,
    D
  >;

  /**
   * Alias for configSchema. Use this to define the middleware configuration validation contract.
   */
  schema<
    TNew = never,
    TSchema extends ValidationSchemaInput<[TNew] extends [never] ? any : TNew> =
      ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
  >(
    schema: TSchema,
  ): TaskMiddlewareFluentBuilderBeforeRun<
    ResolveValidationSchemaInput<TNew, TSchema>,
    In,
    Out,
    D
  >;

  /** Sets the middleware implementation and advances the builder into its post-run phase. */
  run(
    fn: ITaskMiddlewareDefinition<C, In, Out, D>["run"],
  ): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Adds or replaces middleware tags. */
  tags<TNewTags extends TaskMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"taskMiddlewares", TNewTags>,
    options?: { override?: boolean },
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(list: ThrowsList): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
}

export interface TaskMiddlewareFluentBuilderAfterRun<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
> {
  id: string;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(list: ThrowsList): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Materializes the final middleware definition for registration or reuse. */
  build(): ITaskMiddleware<C, In, Out, D>;
}

export type TaskMiddlewareFluentBuilder<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  THasRun extends boolean = false,
> = THasRun extends true
  ? TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D>
  : TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
