import type {
  DependencyMapType,
  IResource,
  IResourceDefinition,
  IResourceMeta,
  IValidationSchema,
  OverridableElements,
  RegisterableItems,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  TagType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import type { ResolveConfig } from "./types";

/**
 * Fluent builder interface for constructing resources.
 * Each method returns a new builder with updated type parameters.
 */
export interface ResourceFluentBuilder<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TContext = any,
  TMeta extends IResourceMeta = IResourceMeta,
  TTags extends TagType[] = TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
> {
  id: string;

  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig) => TNewDeps),
    options?: { override?: false },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps & TNewDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig) => TNewDeps),
    options: { override: true },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TNewDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  register(
    items:
      | RegisterableItems
      | Array<RegisterableItems>
      | ((config: TConfig) => RegisterableItems | Array<RegisterableItems>),
    options?: { override?: boolean },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  middleware<TNewMw extends ResourceMiddlewareAttachmentType[]>(
    mw: TNewMw,
    options?: { override?: boolean },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TNewMw
  >;

  // Append signature (default)
  tags<TNewTags extends TagType[]>(
    tags: TNewTags,
    options?: { override?: false },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    [...TTags, ...TNewTags],
    TMiddleware
  >;

  // Override signature (replace)
  tags<TNewTags extends TagType[]>(
    tags: TNewTags,
    options: { override: true },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TNewTags,
    TMiddleware
  >;

  context<TNewCtx>(
    factory: () => TNewCtx,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TNewCtx,
    TMeta,
    TTags,
    TMiddleware
  >;

  configSchema<TNewConfig>(
    schema: IValidationSchema<TNewConfig>,
  ): ResourceFluentBuilder<
    TNewConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  /**
   * Alias for configSchema. Use this to define the resource configuration validation contract.
   */
  schema<TNewConfig>(
    schema: IValidationSchema<TNewConfig>,
  ): ResourceFluentBuilder<
    TNewConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  resultSchema<TResolved>(
    schema: IValidationSchema<TResolved>,
  ): ResourceFluentBuilder<
    TConfig,
    Promise<TResolved>,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  init<TNewConfig = TConfig, TNewValue extends Promise<any> = TValue>(
    fn: ResourceInitFn<
      ResolveConfig<TConfig, TNewConfig>,
      TNewValue,
      TDeps,
      TContext,
      TMeta,
      TTags,
      TMiddleware
    >,
  ): ResourceFluentBuilder<
    ResolveConfig<TConfig, TNewConfig>,
    TNewValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  dispose(
    fn: NonNullable<
      IResourceDefinition<
        TConfig,
        TValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      >["dispose"]
    >,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  meta<TNewMeta extends IResourceMeta>(
    m: TNewMeta,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TNewMeta,
    TTags,
    TMiddleware
  >;

  throws(
    list: ThrowsList,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  overrides(
    o: Array<OverridableElements>,
    options?: { override?: boolean },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  build(): IResource<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
}
