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
import type { IsolationChannels, IsolationScope } from "../tools/scope";
export type {
  IsolationScope,
  IsolationChannels,
  IsolationChannel,
} from "../tools/scope";
import {
  symbolFilePath,
  symbolForkedFrom,
  symbolResourceIsolateDeclarations,
  symbolResource,
  symbolResourceRegistersChildren,
  symbolResourceSubtreeDeclarations,
  symbolRuntimeId,
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
  ResourceSubtreePolicyDeclaration,
  ResourceSubtreePolicyInput,
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
  ResourceSubtreePolicyDeclaration,
  ResourceSubtreePolicyInput,
  SubtreeElementValidator,
  SubtreeEventValidator,
  SubtreeHookValidator,
  SubtreeValidatableElement,
  SubtreeResourceMiddlewareEntry,
  SubtreeResourceMiddlewarePredicate,
  SubtreeResourceMiddlewareValidator,
  SubtreeResourceValidator,
  SubtreePolicyOptions,
  SubtreeTagValidator,
  SubtreeTaskMiddlewareEntry,
  SubtreeTaskMiddlewarePredicate,
  SubtreeTaskMiddlewareValidator,
  SubtreeTaskValidator,
  SubtreeViolation,
} from "./subtree";

export interface ResourceForkInfo {
  /** The id of the resource that was forked. */
  readonly fromId: string;
}

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
 * This reference binds to the resource object itself. At bootstrap, Runner resolves
 * "all items owned by that resource's registration subtree" — so overridable
 * ids and deeply-nested children are all caught automatically.
 */
export interface IsolationSubtreeFilter {
  readonly _subtreeFilter: true;
  readonly resourceId: string;
  readonly types?: ReadonlyArray<ItemType>;
}

/**
 * Valid targets for `.isolate({ deny: [...], only: [...] })`.
 *
 * - **RegisterableItems** — bare definitions (task, resource, event, tag, etc.).
 *   Treated as `scope(item)` with all channels = `true`.
 * - **IsolationSubtreeFilter** — created by `subtreeOf(resource, { types? })`.
 *   Treated as `scope(subtreeOf(x))` with all channels = `true`.
 * - **IsolationScope** — created by `scope(target, { channels })` for
 *   fine‑grained per-channel control.
 *
 * Raw strings are **not** valid here.
 */
export type IsolationTarget =
  | RegisterableItems
  | IsolationSubtreeFilter
  | IsolationScope;
export type IsolationExportsTarget =
  | RegisterableItems
  | IResource<any, any, any, any, any, any, any>;

export type IsolationExportsConfig =
  | ReadonlyArray<IsolationExportsTarget>
  | "none";

export interface IsolationPolicy {
  /**
   * Denied targets for this resource boundary.
   * Denials are additive across nested resources.
   */
  deny?: ReadonlyArray<IsolationTarget>;
  /**
   * Allowed targets for this resource boundary.
   * When provided, only these targets (and internal items) can be referenced.
   */
  only?: ReadonlyArray<IsolationTarget>;
  /**
   * Additional per-boundary grants for specific consumers.
   *
   * `whitelist` can relax this boundary's own `deny` / `only` checks for the
   * matching consumer-target relation, but it does not override visibility
   * rules or restrictions imposed by ancestor resources.
   */
  whitelist?: ReadonlyArray<IsolationWhitelistEntry>;
  /**
   * Declares which registered items are visible outside this resource's
   * registration subtree.
   *
   * - Omit `exports` => everything is public (default)
   * - `exports: []` or `exports: "none"` => nothing is public
   * - Array entries must be explicit Runner definition/resource references
   */
  exports?: IsolationExportsConfig;
}

export interface IsolationWhitelistEntry {
  /**
   * Consumers that receive the grant. Supports definitions, tags,
   * `subtreeOf(...)`, wildcard `scope("*")`, and `scope(...)` targets.
   */
  for: ReadonlyArray<IsolationTarget>;
  /**
   * Targets that become accessible to the matching consumers for the selected
   * channels on this boundary only.
   */
  targets: ReadonlyArray<IsolationTarget>;
  /**
   * Channels controlled by this grant. Defaults to all channels when omitted.
   */
  channels?: IsolationChannels;
}

export type IsolationPolicyResolver<TConfig = unknown> = (
  config: TConfig,
) => IsolationPolicy;

export type IsolationPolicyInput<TConfig = unknown> =
  | IsolationPolicy
  | IsolationPolicyResolver<TConfig>;

export type IsolationPolicyDeclaration<TConfig = unknown> = {
  policy: IsolationPolicyInput<TConfig>;
  options?: {
    override?: boolean;
  };
};

// Helper to detect `any` so we can treat it as "unspecified"
export type IsAny<T> = 0 extends 1 & T ? true : false;
export type IsUnspecified<T> = [T] extends [undefined]
  ? true
  : [T] extends [void]
    ? true
    : IsAny<T> extends true
      ? true
      : false;

export type ResourceHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface IResourceHealthResult {
  status: ResourceHealthStatus;
  message?: string;
  details?: unknown;
}

export interface IResourceHealthReportEntry extends IResourceHealthResult {
  id: string;
  initialized: boolean;
}

export interface IResourceHealthReport {
  totals: {
    resources: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
  report: IResourceHealthReportEntry[];
  find(
    resource: string | IResource<any, any, any, any, any>,
  ): IResourceHealthReportEntry;
}

export type ResourceCooldownAdmissionTargets = ReadonlyArray<
  IResource<any, any, any, any, any, any, any>
>;

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
   * Ready hook for the resource. This runs after initialization completes and
   * right before Runner emits the global system ready event.
   *
   * Use this for startup ingress actions that should begin only after runtime
   * internals are locked and all startup-initialized dependencies are ready.
   */
  ready?: (
    this: unknown,
    value: TValue extends Promise<infer U> ? U : TValue,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDependencies>,
    context: TContext,
  ) => Promise<void>;
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
   * handles/promises in context, and return promptly. The cooling resource is
   * always allowed as a resource-origin source during the later drain window.
   * Returning additional resource definitions extends that shutdown allowlist.
   */
  cooldown?: (
    this: unknown,
    value: TValue extends Promise<infer U> ? U : TValue,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDependencies>,
    context: TContext,
  ) => Promise<void | ResourceCooldownAdmissionTargets>;
  /**
   * Optional async health probe for this resource.
   *
   * Resources without `health` are excluded from runtime health reports.
   */
  health?: (
    this: unknown,
    value: (TValue extends Promise<infer U> ? U : TValue) | undefined,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDependencies>,
    context: TContext,
  ) => Promise<IResourceHealthResult>;
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
   * Create a private, mutable context shared between `init`, `ready`,
   * `cooldown`, and `dispose`.
   */
  context?: () => TContext;
  /**
   * Isolates this resource boundary, restricting which external definitions can
   * be referenced by this resource and its subtree.
   *
   * Why: this provides a fail-fast dependency boundary that prevents accidental
   * cross-module wiring, even when visibility rules would otherwise allow it.
   */
  isolate?: IsolationPolicyInput<TConfig>;
  /**
   * This is optional and used from an index resource to get the correct caller.
   * This is the reason we allow it here as well.
   */
  [symbolFilePath]?: string;
  /**
   * Declares subtree policies for tasks/resources registered under this resource.
   */
  subtree?: ResourceSubtreePolicyInput<TConfig>;
  /** @internal Ordered subtree declarations preserved across builder composition. */
  [symbolResourceSubtreeDeclarations]?: ReadonlyArray<
    ResourceSubtreePolicyDeclaration<TConfig>
  >;
  /** @internal Ordered isolate declarations preserved across builder composition. */
  [symbolResourceIsolateDeclarations]?: ReadonlyArray<
    IsolationPolicyDeclaration<TConfig>
  >;
  /**
   * When true, this resource acts as a namespace gateway and does not add its
   * own id prefix when compiling ids for items in its register tree.
   */
  gateway?: boolean;
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
  path?: string;
  [symbolRuntimeId]?: string;
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
  /** @internal Tracks whether the resource explicitly declared `.register(...)`. */
  [symbolResourceRegistersChildren]?: true;
  /** Present only on forked resources. */
  [symbolForkedFrom]?: ResourceForkInfo;
  /** Normalized list of error ids declared via `throws`. */
  throws?: readonly string[];
  /**
   * Wiring isolation policy for this resource and its subtree.
   */
  isolate?: IsolationPolicyInput<TConfig>;
  /**
   * Normalized subtree policy declarations owned by this resource.
   */
  subtree?:
    | ResourceSubtreePolicyInput<TConfig>
    | NormalizedResourceSubtreePolicy;
  /** @internal Ordered subtree declarations preserved across builder composition. */
  [symbolResourceSubtreeDeclarations]?: ReadonlyArray<
    ResourceSubtreePolicyDeclaration<TConfig>
  >;
  /** @internal Ordered isolate declarations preserved across builder composition. */
  [symbolResourceIsolateDeclarations]?: ReadonlyArray<
    IsolationPolicyDeclaration<TConfig>
  >;
  /**
   * Namespace gateway flag copied from the definition.
   */
  gateway?: boolean;
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
   * Only leaf resources can be forked. Resources that register children
   * must be composed explicitly instead of cloned structurally.
   */
  fork(
    newId: string,
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
  path?: string;
  [symbolRuntimeId]?: string;
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
