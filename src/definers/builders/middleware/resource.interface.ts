import type {
  DependencyMapType,
  EnsureTagsForTarget,
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
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options?: { override?: false },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D & TNewDeps>;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options: { override: true },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, TNewDeps>;
  configSchema<TNew>(
    schema: ValidationSchemaInput<TNew>,
  ): ResourceMiddlewareFluentBuilderBeforeRun<TNew, In, Out, D>;

  /**
   * Alias for configSchema. Use this to define the middleware configuration validation contract.
   */
  schema<TNew>(
    schema: ValidationSchemaInput<TNew>,
  ): ResourceMiddlewareFluentBuilderBeforeRun<TNew, In, Out, D>;

  run(
    fn: IResourceMiddlewareDefinition<C, In, Out, D>["run"],
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  tags<TNewTags extends ResourceMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"resourceMiddlewares", TNewTags>,
    options?: { override?: boolean },
  ): ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D>;
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
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(
    list: ThrowsList,
  ): ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D>;
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
