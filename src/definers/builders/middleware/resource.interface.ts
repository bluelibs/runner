import type {
  DependencyMapType,
  EnsureTagsForTarget,
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  IMiddlewareMeta,
  ResolvedResourceMiddlewareConfig,
  ResolveValidationSchemaInput,
  ResourceMiddlewareTagType,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export interface ResourceMiddlewareFluentBuilderBeforeRun<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
> {
  id: string;
  /** Adds middleware dependencies, merging by default unless `override: true` is used. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps:
      | TNewDeps
      | ((config: ResolvedResourceMiddlewareConfig<C, TTags>) => TNewDeps),
    options?: { override?: false },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D & TNewDeps, TTags>;
  /** Replaces previously declared middleware dependencies. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps:
      | TNewDeps
      | ((config: ResolvedResourceMiddlewareConfig<C, TTags>) => TNewDeps),
    options: { override: true },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, TNewDeps, TTags>;
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
    D,
    TTags
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
    D,
    TTags
  >;

  /** Sets the middleware implementation and advances the builder into its post-run phase. */
  run(
    fn: IResourceMiddlewareDefinition<C, In, Out, D, TTags>["run"],
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags>;
  /** Adds middleware tags, merging by default unless `override: true` is used. */
  tags<const TNewTags extends ResourceMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"resourceMiddlewares", TNewTags>,
    options?: { override?: false },
  ): ResourceMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D,
    [...TTags, ...TNewTags]
  >;
  /** Replaces previously declared middleware tags. */
  tags<const TNewTags extends ResourceMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"resourceMiddlewares", TNewTags>,
    options: { override: true },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TNewTags>;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TTags>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(
    list: ThrowsList,
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TTags>;
}

export interface ResourceMiddlewareFluentBuilderAfterRun<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
> {
  id: string;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(
    list: ThrowsList,
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags>;
  /** Materializes the final middleware definition for registration or reuse. */
  build(): IResourceMiddleware<C, In, Out, D, TTags>;
}

export type ResourceMiddlewareFluentBuilder<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
  THasRun extends boolean = false,
> = THasRun extends true
  ? ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags>
  : ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TTags>;
