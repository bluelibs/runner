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
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options?: { override?: false },
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D & TNewDeps>;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options: { override: true },
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, TNewDeps>;
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

  run(
    fn: ITaskMiddlewareDefinition<C, In, Out, D>["run"],
  ): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  tags<TNewTags extends TaskMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"taskMiddlewares", TNewTags>,
    options?: { override?: boolean },
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
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
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(list: ThrowsList): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
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
