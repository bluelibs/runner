import type {
  DependencyMapType,
  EnsureTagsForTarget,
  IResource,
  IResourceDefinition,
  IResourceMeta,
  IsolationPolicyInput,
  OverridableElements,
  RegisterableItems,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  ResourceSubtreePolicyInput,
  ResourceTagType,
  SubtreePolicyOptions,
  TagType,
  ResolveValidationSchemaInput,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import type { RunnerMode } from "../../../types/runner";
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

  /** Adds resource dependencies, merging by default unless `override: true` is used. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig, mode: RunnerMode) => TNewDeps),
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

  /** Replaces previously declared resource dependencies. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig, mode: RunnerMode) => TNewDeps),
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

  /** Attaches resource middleware. */
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

  /** Adds resource tags, merging by default unless `override: true` is used. */
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

  /** Replaces previously declared resource tags. */
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

  /** Creates private mutable context shared across the resource lifecycle hooks. */
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

  /** Declares the resource configuration schema. */
  configSchema<
    TNewConfig = never,
    TSchema extends ValidationSchemaInput<
      [TNewConfig] extends [never] ? any : TNewConfig
    > = ValidationSchemaInput<[TNewConfig] extends [never] ? any : TNewConfig>,
  >(
    schema: TSchema,
  ): ResourceFluentBuilderBeforeInit<
    ResolveValidationSchemaInput<TNewConfig, TSchema>,
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
  schema<
    TNewConfig = never,
    TSchema extends ValidationSchemaInput<
      [TNewConfig] extends [never] ? any : TNewConfig
    > = ValidationSchemaInput<[TNewConfig] extends [never] ? any : TNewConfig>,
  >(
    schema: TSchema,
  ): ResourceFluentBuilderBeforeInit<
    ResolveValidationSchemaInput<TNewConfig, TSchema>,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  /** Declares the resolved resource value schema. */
  resultSchema<
    TResolved = never,
    TSchema extends ValidationSchemaInput<
      [TResolved] extends [never] ? any : TResolved
    > = ValidationSchemaInput<[TResolved] extends [never] ? any : TResolved>,
  >(
    schema: TSchema,
  ): ResourceFluentBuilderBeforeInit<
    TConfig,
    Promise<ResolveValidationSchemaInput<TResolved, TSchema>>,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  /** Attaches metadata used by docs and tooling. */
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

  /** Sets the resource initializer and advances the builder into its post-init phase. */
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

  /** Registers child definitions owned by this resource. */
  register(
    items:
      | RegisterableItems
      | Array<RegisterableItems>
      | ((
          config: TConfig,
          mode: RunnerMode,
        ) => RegisterableItems | Array<RegisterableItems>),
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

  /** Declares the resource dispose hook. */
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

  /**
   * Declares the resource `ready()` hook.
   *
   * Use this when the resource should begin admitting external work only after
   * startup wiring is complete. The impact is startup ordering, not value creation.
   */
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

  /**
   * Declares the resource `cooldown()` hook.
   *
   * Use this to stop new intake quickly during shutdown. The impact is on admission
   * control during `coolingDown`, not on final teardown.
   */
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

  /**
   * Declares the resource `health()` probe.
   *
   * Resources without this hook are omitted from runtime health reports, so adding
   * it changes operator visibility rather than lifecycle behavior.
   */
  health(
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
      >["health"]
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
   * Restricts wiring access for this resource boundary.
   * Multiple calls are additive.
   */
  isolate(
    policy: IsolationPolicyInput<TConfig>,
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
    policy: ResourceSubtreePolicyInput<TConfig>,
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
    o:
      | Array<OverridableElements>
      | ((config: TConfig, mode: RunnerMode) => Array<OverridableElements>),
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
      | ((
          config: TConfig,
          mode: RunnerMode,
        ) => RegisterableItems | Array<RegisterableItems>),
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
  health(
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
      >["health"]
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
  isolate(
    policy: IsolationPolicyInput<TConfig>,
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
    policy: ResourceSubtreePolicyInput<TConfig>,
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
    o:
      | Array<OverridableElements>
      | ((config: TConfig, mode: RunnerMode) => Array<OverridableElements>),
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
