import type {
  DependencyMapType,
  EnsureTagsForTarget,
  IResource,
  IResourceDefinition,
  IResourceMeta,
  IsolationExportsTarget,
  IsolationPolicy,
  OverridableElements,
  RegisterableItems,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  ResourceSubtreePolicy,
  ResourceTagType,
  SubtreePolicyOptions,
  TagType,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import type { ResolveConfig } from "./types";

/**
 * Fluent resource builder before `.init(...)`.
 */
export interface ResourceFluentBuilderBeforeInit<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TContext = any,
  TMeta extends IResourceMeta = IResourceMeta,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
> {
  id: string;

  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig) => TNewDeps),
    options?: { override?: false },
  ): ResourceFluentBuilderBeforeInit<
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
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TNewDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  middleware<TNewMw extends ResourceMiddlewareAttachmentType[]>(
    mw: TNewMw,
    options?: { override?: boolean },
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TNewMw
  >;

  // Append signature (default)
  tags<const TNewTags extends TagType[]>(
    tags: EnsureTagsForTarget<"resources", TNewTags>,
    options?: { override?: false },
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    [...TTags, ...TNewTags],
    TMiddleware
  >;

  // Override signature (replace)
  tags<const TNewTags extends TagType[]>(
    tags: EnsureTagsForTarget<"resources", TNewTags>,
    options: { override: true },
  ): ResourceFluentBuilderBeforeInit<
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
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TNewCtx,
    TMeta,
    TTags,
    TMiddleware
  >;

  configSchema<TNewConfig>(
    schema: ValidationSchemaInput<TNewConfig>,
  ): ResourceFluentBuilderBeforeInit<
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
    schema: ValidationSchemaInput<TNewConfig>,
  ): ResourceFluentBuilderBeforeInit<
    TNewConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  resultSchema<TResolved>(
    schema: ValidationSchemaInput<TResolved>,
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    Promise<TResolved>,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  meta<TNewMeta extends IResourceMeta>(
    m: TNewMeta,
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TNewMeta,
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
  ): ResourceFluentBuilderAfterInit<
    ResolveConfig<TConfig, TNewConfig>,
    TNewValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  // Kept available pre-init for compatibility and ergonomic ordering.
  register(
    items:
      | RegisterableItems
      | Array<RegisterableItems>
      | ((config: TConfig) => RegisterableItems | Array<RegisterableItems>),
    options?: { override?: boolean },
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
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
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  ready(
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
      >["ready"]
    >,
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  cooldown(
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
      >["cooldown"]
    >,
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  throws(
    list: ThrowsList,
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  /**
   * Declares which registered items are visible outside this resource's
   * registration subtree.
   *
   * @deprecated Use `.isolate({ exports: [...] })` instead (or `exports: "none"`).
   */
  exports(
    items: Array<IsolationExportsTarget>,
    options?: { override?: boolean },
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  /**
   * Restricts wiring access for this resource boundary.
   * Multiple calls are additive.
   */
  isolate(
    policy: IsolationPolicy,
    options?: { override?: boolean },
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  subtree(
    policy: ResourceSubtreePolicy,
    options?: SubtreePolicyOptions,
  ): ResourceFluentBuilderBeforeInit<
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
  ): ResourceFluentBuilderBeforeInit<
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

/**
 * Fluent resource builder after `.init(...)`.
 * Shape/wiring-affecting methods are intentionally unavailable.
 */
export interface ResourceFluentBuilderAfterInit<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TContext = any,
  TMeta extends IResourceMeta = IResourceMeta,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
> {
  id: string;
  register(
    items:
      | RegisterableItems
      | Array<RegisterableItems>
      | ((config: TConfig) => RegisterableItems | Array<RegisterableItems>),
    options?: { override?: boolean },
  ): ResourceFluentBuilderAfterInit<
    TConfig,
    TValue,
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
  ): ResourceFluentBuilderAfterInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  ready(
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
      >["ready"]
    >,
  ): ResourceFluentBuilderAfterInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  cooldown(
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
      >["cooldown"]
    >,
  ): ResourceFluentBuilderAfterInit<
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
  ): ResourceFluentBuilderAfterInit<
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
  ): ResourceFluentBuilderAfterInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  /**
   * @deprecated Use `.isolate({ exports: [...] })` instead (or `exports: "none"`).
   */
  exports(
    items: Array<IsolationExportsTarget>,
    options?: { override?: boolean },
  ): ResourceFluentBuilderAfterInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  isolate(
    policy: IsolationPolicy,
    options?: { override?: boolean },
  ): ResourceFluentBuilderAfterInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  subtree(
    policy: ResourceSubtreePolicy,
    options?: SubtreePolicyOptions,
  ): ResourceFluentBuilderAfterInit<
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
  ): ResourceFluentBuilderAfterInit<
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

export type ResourceFluentBuilder<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TContext = any,
  TMeta extends IResourceMeta = IResourceMeta,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
  THasInit extends boolean = false,
> = THasInit extends true
  ? ResourceFluentBuilderAfterInit<
      TConfig,
      TValue,
      TDeps,
      TContext,
      TMeta,
      TTags,
      TMiddleware
    >
  : ResourceFluentBuilderBeforeInit<
      TConfig,
      TValue,
      TDeps,
      TContext,
      TMeta,
      TTags,
      TMiddleware
    >;
