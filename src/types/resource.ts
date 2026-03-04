import {
  DependencyMapType,
  IOptionalDependency,
  IValidationSchema,
  ValidationSchemaInput,
  OverridableElements,
  RegisterableItems,
  ResourceDependencyValuesType,
} from "./utilities";
import {
  IResourceMiddleware,
  ResourceMiddlewareAttachmentType,
} from "./resourceMiddleware";
import { ResourceTagType } from "./tag";
import { IResourceMeta } from "./meta";
import type { ThrowsList } from "./error";
import {
  symbolFilePath,
  symbolForkedFrom,
  symbolResource,
  symbolResourceWithConfig,
} from "./symbols";
import {
  EnsureInputSatisfiesContracts,
  EnsureOutputSatisfiesContracts,
  HasInputContracts,
  HasOutputContracts,
  InferInputOrViolationFromContracts,
} from "./contracts";
import type {
  NormalizedResourceSubtreePolicy,
  ResourceSubtreePolicy,
} from "./subtree";

export type {
  DependencyMapType,
  IOptionalDependency,
  IValidationSchema,
  ValidationSchemaInput,
  OverridableElements,
  RegisterableItems,
  ResourceDependencyValuesType,
} from "./utilities";
export type { ResourceMiddlewareAttachmentType } from "./resourceMiddleware";
export type { ResourceTagType, TagType } from "./tag";
export type { IResourceMeta } from "./meta";
export type {
  ResourceSubtreePolicy,
  SubtreeResourceMiddlewareEntry,
  SubtreeResourceMiddlewarePredicate,
  SubtreeEventValidator,
  SubtreeHookValidator,
  SubtreePolicyOptions,
  SubtreeResourceMiddlewareValidator,
  SubtreeResourceValidator,
  SubtreeTagValidator,
  SubtreeTaskMiddlewareEntry,
  SubtreeTaskMiddlewarePredicate,
  SubtreeTaskMiddlewareValidator,
  SubtreeTaskValidator,
  SubtreeViolation,
} from "./subtree";

export type ResourceForkRegisterMode = "keep" | "drop" | "deep";

export interface ResourceForkOptions {
  /**
   * Control whether the fork keeps the base `register` list.
   * - "keep" (default) keeps registration items
   * - "drop" clears registration items
   * - "deep" deep-forks registered resources with new ids (resource tree)
   */
  register?: ResourceForkRegisterMode;
  /**
   * Used with `register: "deep"` to derive ids for deep-forked resources.
   * Defaults to `(id) => \`\${newId}.\${id}\``.
   */
  reId?: (id: string) => string;
}

export interface ResourceForkInfo {
  /** The id of the resource that was forked. */
  readonly fromId: string;
}

export type IsolationSelector = string;

/**
 * The definition types recognised by Runner's isolation engine.
 * Used by `subtreeOf()` to narrow which items inside a resource subtree
 * are matched by a deny/only filter.
 */
export type ItemType =
  | "task"
  | "hook"
  | "event"
  | "tag"
  | "resource"
  | "taskMiddleware"
  | "resourceMiddleware";

/**
 * A structural subtree filter created by `subtreeOf(resource, { types })`.
 *
 * Unlike string selectors (which match against literal ids) this reference
 * binds to the resource object itself.  At bootstrap, Runner resolves
 * "all items owned by that resource's registration subtree" — so overridable
 * ids and deeply-nested children are all caught automatically.
 */
export interface IsolationSubtreeFilter {
  readonly _subtreeFilter: true;
  readonly resourceId: string;
  readonly types?: ReadonlyArray<ItemType>;
}

export type IsolationTarget =
  | RegisterableItems
  | IsolationSelector
  | IsolationSubtreeFilter;
export type IsolationExportsTarget = RegisterableItems | IsolationSelector;

export type IsolationExportsConfig =
  | ReadonlyArray<IsolationExportsTarget>
  | "none";

export interface IsolationPolicy {
  /**
   * Denied targets for this resource boundary.
   * Denials are additive across nested resources.
   * String targets may be exact ids or wildcard selectors (`*` per dot-segment).
   */
  deny?: ReadonlyArray<IsolationTarget>;
  /**
   * Allowed targets for this resource boundary.
   * When provided, only these targets (and internal items) can be referenced.
   * String targets may be exact ids or wildcard selectors (`*` per dot-segment).
   */
  only?: ReadonlyArray<IsolationTarget>;
  /**
   * Declares which registered items are visible outside this resource's
   * registration subtree.
   *
   * String targets may be exact ids or wildcard selectors (`*` per dot-segment).
   * - Omit `exports` => everything is public (default)
   * - `exports: []` or `exports: "none"` => nothing is public
   */
  exports?: IsolationExportsConfig;
}

// Helper to detect `any` so we can treat it as "unspecified"
export type IsAny<T> = 0 extends 1 & T ? true : false;
export type IsUnspecified<T> = [T] extends [undefined]
  ? true
  : [T] extends [void]
    ? true
    : IsAny<T> extends true
      ? true
      : false;

export interface IResourceDefinition<
  TConfig = any,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = {},
  TContext = any,
  _THooks = any,
  _TRegisterableItems = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
> {
  /** Stable identifier. */
  id: string;
  /** Static or lazy dependency map. Receives `config` when provided. */
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  /**
   * Register other registerables (resources/tasks/middleware/events). Accepts a
   * static array or a function of `config` to support dynamic wiring.
   */
  register?:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  /**
   * Initialize and return the resource value. Called once during boot.
   */
  init?: (
    config: HasInputContracts<[...TTags, ...TMiddleware]> extends true
      ? IsUnspecified<TConfig> extends true
        ? InferInputOrViolationFromContracts<[...TTags, ...TMiddleware]>
        : EnsureInputSatisfiesContracts<[...TTags, ...TMiddleware], TConfig>
      : TConfig,
    dependencies: ResourceDependencyValuesType<TDependencies>,
    context: TContext,
  ) => HasOutputContracts<[...TTags, ...TMiddleware]> extends true
    ? EnsureOutputSatisfiesContracts<[...TTags, ...TMiddleware], TValue>
    : TValue;
  /**
   * Optional validation schema for the resource's resolved value.
   * When provided, the value will be validated immediately after `init` resolves,
   * without considering middleware.
   */
  resultSchema?: ValidationSchemaInput<
    TValue extends Promise<infer U> ? U : TValue
  >;
  /**
   * Clean-up function for the resource. This is called when the resource is no longer needed.
   *
   * @param value The value of the resource (undefined if no init method)
   * @param config The configuration it received
   * @param dependencies The dependencies it needed
   * @returns Promise<void>
   */
  dispose?: (
    this: unknown,
    value: TValue extends Promise<infer U> ? U : TValue,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDependencies>,
    context: TContext,
  ) => Promise<void>;
  /**
   * Cooldown hook for the resource. This runs during shutdown to stop intake
   * quickly before runtime drains in-flight business work.
   *
   * Keep this fast and non-blocking in intent: trigger ingress stop, capture
   * handles/promises in context, and return promptly.
   */
  cooldown?: (
    this: unknown,
    value: TValue extends Promise<infer U> ? U : TValue,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDependencies>,
    context: TContext,
  ) => Promise<void>;
  meta?: TMeta;
  /**
   * Declares which typed errors are part of this resource's contract.
   *
   * This is a declarative contract only:
   * - It does not imply dependency injection
   * - It does not enforce that only these errors can be thrown
   *
   * Use string ids or Error helpers.
   */
  throws?: ThrowsList;
  /**
   * Optional validation schema for runtime config validation.
   * When provided, resource config will be validated when .with() is called.
   */
  configSchema?: ValidationSchemaInput<TConfig>;
  /**
   * Safe overrides to swap behavior while preserving identities. See
   * README: Overrides.
   */
  overrides?: Array<OverridableElements>;

  /** Middleware applied around init/cooldown/dispose. */
  middleware?: TMiddleware;
  /**
   * Create a private, mutable context shared between `init`, `cooldown`, and
   * `dispose`.
   */
  context?: () => TContext;
  /**
   * Declares which registered items are visible outside this resource's
   * registration subtree. When present, only listed items (and items registered
   * by child resources that also export them) are accessible from outside.
   * Omitting `exports` means everything is public (default).
   *
   * @deprecated Use `isolate: { exports: [...] }` instead.
   */
  exports?: Array<IsolationExportsTarget>;
  /**
   * Isolates this resource boundary, restricting which external definitions can
   * be referenced by this resource and its subtree.
   *
   * Why: this provides a fail-fast dependency boundary that prevents accidental
   * cross-module wiring, even when visibility rules would otherwise allow it.
   */
  isolate?: IsolationPolicy;
  /**
   * This is optional and used from an index resource to get the correct caller.
   * This is the reason we allow it here as well.
   */
  [symbolFilePath]?: string;
  /**
   * Declares subtree policies for tasks/resources registered under this resource.
   */
  subtree?: ResourceSubtreePolicy;
  tags?: TTags;
}

/**
 * Helper alias describing the canonical resource init call signature.
 * Shared with fluent builders to keep init typing consistent.
 */
export type ResourceInitFn<
  TConfig,
  TValue extends Promise<any>,
  TDependencies extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
> = NonNullable<
  IResourceDefinition<
    TConfig,
    TValue,
    TDependencies,
    TContext,
    any,
    any,
    TMeta,
    TTags,
    TMiddleware
  >["init"]
>;

export interface IResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = any,
  TContext = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
> extends IResourceDefinition<
  TConfig,
  TValue,
  TDependencies,
  TContext,
  any,
  any,
  TMeta,
  TTags,
  TMiddleware
> {
  configSchema?: IValidationSchema<TConfig>;
  resultSchema?: IValidationSchema<
    TValue extends Promise<infer U> ? U : TValue
  >;
  id: string;
  with(
    config: HasInputContracts<[...TTags, ...TMiddleware]> extends true
      ? IsUnspecified<TConfig> extends true
        ? InferInputOrViolationFromContracts<[...TTags, ...TMiddleware]>
        : TConfig
      : TConfig,
  ): IResourceWithConfig<
    TConfig,
    TValue,
    TDependencies,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  register:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  overrides: Array<OverridableElements>;
  middleware: TMiddleware;
  [symbolFilePath]: string;
  [symbolResource]: true;
  /** Present only on forked resources. */
  [symbolForkedFrom]?: ResourceForkInfo;
  /** Normalized list of error ids declared via `throws`. */
  throws?: readonly string[];
  /**
   * Items visible outside this resource's subtree. When set, only listed items
   * can be referenced from outside.
   *
   * @deprecated Use `isolate: { exports: ... }` instead.
   */
  exports?: Array<IsolationExportsTarget>;
  /**
   * Wiring isolation policy for this resource and its subtree.
   */
  isolate?: IsolationPolicy;
  /**
   * Normalized subtree policy declarations owned by this resource.
   */
  subtree?: NormalizedResourceSubtreePolicy;
  /** Return an optional dependency wrapper for this resource. */
  optional: () => IOptionalDependency<
    IResource<
      TConfig,
      TValue,
      TDependencies,
      TContext,
      TMeta,
      TTags,
      TMiddleware
    >
  >;
  tags: TTags;
  /**
   * Create a new resource with a different id but the same definition.
   * Useful for creating multiple instances of a "template" resource.
   * The forked resource should be exported and used as a dependency.
   */
  fork(
    newId: string,
    options?: ResourceForkOptions,
  ): IResource<
    TConfig,
    TValue,
    TDependencies,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
}

export interface IResourceWithConfig<
  TConfig = any,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = any,
  TContext = any,
  TMeta extends IResourceMeta = any,
  TTags extends ResourceTagType[] = ResourceTagType[],
  TMiddleware extends IResourceMiddleware<any, any, any, any>[] =
    IResourceMiddleware[],
> {
  [symbolResourceWithConfig]: true;
  /** The id of the underlying resource. */
  id: string;
  /** The underlying resource definition. */
  resource: IResource<
    TConfig,
    TValue,
    TDependencies,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  /** The configuration captured by `.with(config)`. */
  config: TConfig;
}
