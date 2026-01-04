import {
  DependencyMapType,
  IOptionalDependency,
  IValidationSchema,
  OverridableElements,
  RegisterableItems,
  ResourceDependencyValuesType,
} from "./utilities";
import {
  IResourceMiddleware,
  ResourceMiddlewareAttachmentType,
} from "./resourceMiddleware";
import { TagType } from "./tag";
import { IResourceMeta } from "./meta";
import type { ThrowsList } from "./error";
import {
  symbolFilePath,
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

export type {
  DependencyMapType,
  IOptionalDependency,
  IValidationSchema,
  OverridableElements,
  RegisterableItems,
  ResourceDependencyValuesType,
} from "./utilities";
export type { ResourceMiddlewareAttachmentType } from "./resourceMiddleware";
export type { TagType } from "./tag";
export type { IResourceMeta } from "./meta";

// Helper to detect `any` so we can treat it as "unspecified"
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnspecified<T> = [T] extends [undefined]
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
  THooks = any,
  TRegisterableItems = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
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
  resultSchema?: IValidationSchema<
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
    this: any,
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
  configSchema?: IValidationSchema<TConfig>;
  /**
   * Safe overrides to swap behavior while preserving identities. See
   * README: Overrides.
   */
  overrides?: Array<OverridableElements>;

  /** Middleware applied around init/dispose. */
  middleware?: TMiddleware;
  /**
   * Create a private, mutable context shared between `init` and `dispose`.
   */
  context?: () => TContext;
  /**
   * This is optional and used from an index resource to get the correct caller.
   * This is the reason we allow it here as well.
   */
  [symbolFilePath]?: string;
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
  TTags extends TagType[],
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
  TTags extends TagType[] = TagType[],
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
  /** Normalized list of error ids declared via `throws`. */
  throws?: readonly string[];
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
  ): IResource<TConfig, TValue, TDependencies, TContext, TMeta, TTags, TMiddleware>;
}

export interface IResourceWithConfig<
  TConfig = any,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = any,
  TContext = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
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
