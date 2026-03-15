import type {
  DependencyMapType,
  EnsureTagsForTarget,
  ResolveValidationSchemaInput,
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  IMiddlewareMeta,
  ResourceMiddlewareTagType,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export interface ResourceMiddlewareFluentBuilderBeforeRun<
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
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D & TNewDeps>;
  /** Replaces previously declared middleware dependencies. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options: { override: true },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, TNewDeps>;
  /** Declares the middleware configuration schema. */
  configSchema<
    TNew = never,
    TSchema extends ValidationSchemaInput<[TNew] extends [never] ? any : TNew> =
      ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
  >(
    schema: TSchema,
  ): ResourceMiddlewareFluentBuilderBeforeRun<
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
  ): ResourceMiddlewareFluentBuilderBeforeRun<
    ResolveValidationSchemaInput<TNew, TSchema>,
    In,
    Out,
    D
  >;

  /** Sets the middleware implementation and advances the builder into its post-run phase. */
  run(
    fn: IResourceMiddlewareDefinition<C, In, Out, D>["run"],
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Adds or replaces middleware tags. */
  tags<TNewTags extends ResourceMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"resourceMiddlewares", TNewTags>,
    options?: { override?: boolean },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(
    list: ThrowsList,
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
}

export interface ResourceMiddlewareFluentBuilderAfterRun<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
> {
  id: string;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(
    list: ThrowsList,
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Materializes the final middleware definition for registration or reuse. */
  build(): IResourceMiddleware<C, In, Out, D>;
}

export type ResourceMiddlewareFluentBuilder<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  THasRun extends boolean = false,
> = THasRun extends true
  ? ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D>
  : ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
