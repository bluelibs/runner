import type {
  DependencyMapType,
  EnsureTagsForTarget,
  IResource,
  MiddlewareApplyToScopeType,
  ResourceMiddlewareApplyToWhen,
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  IValidationSchema,
  IMiddlewareMeta,
  ResourceMiddlewareTagType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export interface ResourceMiddlewareFluentBuilder<
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
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D & TNewDeps>;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options: { override: true },
  ): ResourceMiddlewareFluentBuilder<C, In, Out, TNewDeps>;
  configSchema<TNew>(
    schema: IValidationSchema<TNew>,
  ): ResourceMiddlewareFluentBuilder<TNew, In, Out, D>;

  /**
   * Alias for configSchema. Use this to define the middleware configuration validation contract.
   */
  schema<TNew>(
    schema: IValidationSchema<TNew>,
  ): ResourceMiddlewareFluentBuilder<TNew, In, Out, D>;

  run(
    fn: IResourceMiddlewareDefinition<C, In, Out, D>["run"],
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  tags<TNewTags extends ResourceMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"resourceMiddlewares", TNewTags>,
    options?: { override?: boolean },
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(list: ThrowsList): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  applyTo(
    scope: MiddlewareApplyToScopeType,
    when?: ResourceMiddlewareApplyToWhen,
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  /** @deprecated Use applyTo(scope, when?) instead. */
  everywhere(
    flag: boolean | ((resource: IResource<any, any, any, any, any>) => boolean),
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  build(): IResourceMiddleware<C, In, Out, D>;
}
