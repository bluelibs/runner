/**
 * Core public TypeScript types for BlueLibs Runner.
 *
 * This file contains the strongly-typed contract for tasks, resources, events
 * and middleware. It mirrors the mental model described in the README:
 * - Tasks are functions
 * - Resources are singletons (with init/dispose hooks)
 * - Events are simple, strongly-typed emissions
 * - Middleware can target both tasks and resources
 *
 * DX goals:
 * - Crystal‑clear generics and helper types that infer dependency shapes
 * - Friendly JSDoc you can hover in editors to understand usage instantly
 * - Safe overrides and strong typing around config and register mechanics
 */

import { MiddlewareEverywhereOptions } from "./define";
import {
  EnsureResponseSatisfiesContracts,
  HasContracts,
} from "./definitions/tag-contracts";

// Re-export public cache type so consumers don’t import from internals.
export { ICacheInstance } from "./globals/middleware/cache.middleware";
export * from "./definitions/store";
export * from "./definitions/symbols";
export * from "./definitions/tags";
export * from "./definitions/meta";
export * from "./definitions/dependencies";

import {
  symbolFilePath,
  symbolOptionalDependency,
  symbolTask,
  symbolHook,
  symbolIndexResource,
  symbolResource,
  symbolEvent,
  symbolMiddleware,
  symbolMiddlewareConfigured,
  symbolMiddlewareEverywhereTasks,
  symbolMiddlewareEverywhereResources,
} from "./definitions/symbols";
import { IValidationSchema } from "./definitions/validation";
import {
  IEventMeta,
  IMiddlewareMeta,
  IResourceMeta,
  ITaskMeta,
} from "./definitions/meta";
import {
  DependencyMapType,
  DependencyValuesType,
  ExtractEventParams,
  IOptionalDependency,
  ResourceDependencyValuesType,
} from "./definitions/dependencies";

// Per-task local interceptor for resource dependency context
export type TaskLocalInterceptor<TInput, TOutput> = (
  next: (input: TInput) => TOutput,
  input: TInput
) => TOutput;

/**
 * Anything you can put inside a resource's `register: []`.
 * - Resources (with or without `.with()`)
 * - Tasks
 * - Middleware
 * - Events
 */
export type RegisterableItems<T = any> =
  | IResourceWithConfig<any>
  | IResource<void, any, any, any> // For void configs
  | IResource<{ [K in any]?: any }, any, any, any> // For optional config
  | ITask<any, any, any, any>
  | IHook<any, any>
  | IMiddleware<any>
  | IEvent<any>;

export type MiddlewareAttachments =
  | IMiddleware<void>
  | IMiddleware<{ [K in any]?: any }>
  | IMiddlewareConfigured<any>;

export interface ITaskDefinition<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any
> {
  /** Stable identifier. Anonymous IDs are not permitted. */
  id: string;
  /**
   * Access other tasks/resources/events. Can be an object or a function when
   * you need late or config‑dependent resolution.
   */
  dependencies?: TDependencies | (() => TDependencies);
  /** Middleware applied around task execution. */
  middleware?: MiddlewareAttachments[];
  /** Optional metadata used for docs, filtering and tooling. */
  meta?: TMeta;
  /**
   * Optional validation schema for runtime input validation.
   * When provided, task input will be validated before execution.
   */
  inputSchema?: IValidationSchema<TInput>;
  /**
   * Optional validation schema for the task result.
   * When provided, the result will be validated immediately after the task's
   * `run` resolves, without considering middleware.
   */
  resultSchema?: IValidationSchema<
    TOutput extends Promise<infer U> ? U : never
  >;
  /**
   * The task body. If `on` is set, the input is an `IEventEmission`. Otherwise,
   * it's the declared input type.
   */
  run: (
    input: TInput,
    dependencies: DependencyValuesType<TDependencies>
  ) => HasContracts<TMeta> extends true
    ? EnsureResponseSatisfiesContracts<TMeta, TOutput>
    : TOutput;
}

// Lifecycle event payload types removed

/**
 * This is the response after the definition has been prepared. TODO: better naming?
 */
export interface ITask<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any
> extends ITaskDefinition<TInput, TOutput, TDependencies, TMeta> {
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  middleware: MiddlewareAttachments[];
  [symbolFilePath]: string;
  [symbolTask]: true;
  /** Return an optional dependency wrapper for this task. */
  optional: () => IOptionalDependency<
    ITask<TInput, TOutput, TDependencies, TMeta>
  >;
}

/**
 * Hook definition and instance types (event listeners without middleware)
 */
export interface IHookDefinition<
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> = any,
  TMeta extends ITaskMeta = any
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
  on: TOn;
  /** Listener execution order. Lower numbers run first. */
  order?: number;
  meta?: TMeta;
  run: (
    event: IEventEmission<TOn extends "*" ? any : ExtractEventParams<TOn>>,
    dependencies: DependencyValuesType<TDependencies>
  ) => Promise<any>;
}

export interface IHook<
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> = any,
  TMeta extends ITaskMeta = any
> extends IHookDefinition<TDependencies, TOn, TMeta> {
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  [symbolFilePath]: string;
  [symbolHook]: true;
}

export interface IResourceDefinition<
  TConfig = any,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = {},
  TContext = any,
  THooks = any,
  TRegisterableItems = any,
  TMeta extends IResourceMeta = any
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
    this: any,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDependencies>,
    context: TContext
  ) => HasContracts<TMeta> extends true
    ? EnsureResponseSatisfiesContracts<TMeta, TValue>
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
    context: TContext
  ) => Promise<void>;
  meta?: TMeta;
  /**
   * Optional validation schema for runtime config validation.
   * When provided, resource config will be validated when .with() is called.
   */
  configSchema?: IValidationSchema<TConfig>;
  /**
   * Safe overrides to swap behavior while preserving identities. See
   * README: Overrides.
   */
  overrides?: Array<IResource | ITask | IMiddleware | IResourceWithConfig>;
  /** Middleware applied around init/dispose. */
  middleware?: MiddlewareAttachments[];
  /**
   * Create a private, mutable context shared between `init` and `dispose`.
   */
  context?: () => TContext;
  /**
   * This is optional and used from an index resource to get the correct caller.
   * This is the reason we allow it here as well.
   */
  [symbolFilePath]?: string;
  /**
   * This is used internally when creating index resources.
   */
  [symbolIndexResource]?: boolean;
}

export interface IResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = any,
  TContext = any,
  TMeta extends IResourceMeta = any
> extends IResourceDefinition<
    TConfig,
    TValue,
    TDependencies,
    TContext,
    any,
    any,
    TMeta
  > {
  id: string;
  with(config: TConfig): IResourceWithConfig<TConfig, TValue, TDependencies>;
  register:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  overrides: Array<IResource | ITask | IMiddleware | IResourceWithConfig>;
  middleware: MiddlewareAttachments[];
  [symbolFilePath]: string;
  [symbolIndexResource]: boolean;
  [symbolResource]: true;
  /** Return an optional dependency wrapper for this resource. */
  optional: () => IOptionalDependency<
    IResource<TConfig, TValue, TDependencies, TContext, TMeta>
  >;
}

export interface IResourceWithConfig<
  TConfig = any,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = any
> {
  /** The id of the underlying resource. */
  id: string;
  /** The underlying resource definition. */
  resource: IResource<TConfig, TValue, TDependencies>;
  /** The configuration captured by `.with(config)`. */
  config: TConfig;
}

export type EventHandlerType<T = any> = (
  event: IEventEmission<T>
) => any | Promise<any>;

export interface IEventDefinition<TPayload = void> {
  /** Stable identifier. Anonymous IDs are not permitted. */
  id: string;
  meta?: IEventMeta;
  /**
   * Optional validation schema for runtime payload validation.
   * When provided, event payload will be validated when emitted.
   */
  payloadSchema?: IValidationSchema<TPayload>;
}

/**
 * The definioten of the event.
 * This is different from the event emission.
 */
export interface IEvent<TPayload = any> extends IEventDefinition<TPayload> {
  id: string;
  /**
   * We use this event to discriminate between resources with just 'id' and 'events' as they collide. This is a workaround, should be redone using classes and instanceof.
   */
  [symbolEvent]: true;
  [symbolFilePath]: string;
  /** Return an optional dependency wrapper for this event. */
  optional: () => IOptionalDependency<IEvent<TPayload>>;
}

/**
 * This represents the object that is passed to event handlers
 */
export interface IEventEmission<TPayload = any> {
  /**
   * The ID of the event. This is the same as the event's ID.
   * This is useful for global event listeners.
   */
  id: string;
  /**
   * The data that the event carries. It can be anything.
   */
  data: TPayload;
  /**
   * The timestamp when the event was created.
   */
  timestamp: Date;
  /**
   * The source of the event. This can be useful for debugging.
   */
  source: string;
  /**
   * Metadata associated with the event definition.
   */
  meta: IEventMeta;
  /**
   * Stops propagation to remaining event listeners.
   */
  stopPropagation(): void;
  /**
   * Returns true if propagation has been stopped.
   */
  isPropagationStopped(): boolean;
}

export interface IMiddlewareDefinition<
  TConfig = any,
  TDependencies extends DependencyMapType = any
> {
  /** Stable identifier. Anonymous IDs are not permitted. */
  id: string;
  /** Static or lazy dependency map. */
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  /**
   * Optional validation schema for runtime config validation.
   * When provided, middleware config will be validated when .with() is called.
   */
  configSchema?: IValidationSchema<TConfig>;
  /**
   * The middleware body, called with task/resource execution input.
   * The response of the middleware should be void, but we allow any to be returned for convenience.
   */
  run: (
    input: IMiddlewareExecutionInput,
    dependencies: DependencyValuesType<TDependencies>,
    config: TConfig
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
}

export type MiddlewareInputMaybeTaskOrResource =
  | {
      task: {
        definition: ITask<any, any, any, any>;
        input: any;
      };
      resource?: never;
    }
  | {
      resource: {
        definition: IResource<any, any, any, any, any>;
        config: any;
      };
      task?: never;
    };

export interface IMiddleware<
  TConfig = any,
  TDependencies extends DependencyMapType = any
> extends IMiddlewareDefinition<TConfig, TDependencies> {
  [symbolMiddleware]: true;
  [symbolMiddlewareConfigured]?: boolean;
  [symbolMiddlewareEverywhereTasks]?:
    | boolean
    | ((task: ITask<any, any, any, any>) => boolean);
  [symbolMiddlewareEverywhereResources]?: boolean;

  id: string;
  dependencies: TDependencies | (() => TDependencies);
  /**
   * Attach this middleware globally. Use options to scope to tasks/resources. This only works in `register: []` for resources.
   * You cannot declare a middleware as global in the middleware definition of a `task` or `resource`.
   */
  everywhere(
    config?: MiddlewareEverywhereOptions
  ): IMiddleware<TConfig, TDependencies>;
  /** Current configuration object (empty by default). */
  config: TConfig;
  /** Configure the middleware and return a marked, configured instance. */
  with: (config: TConfig) => IMiddlewareConfigured<TConfig, TDependencies>;
  [symbolFilePath]: string;
  [symbolMiddleware]: true;
}

export interface IMiddlewareConfigured<
  TConfig = any,
  TDependencies extends DependencyMapType = any
> extends IMiddleware<TConfig, TDependencies> {
  [symbolMiddlewareConfigured]: true;
}

export interface IMiddlewareDefinitionConfigured<
  C extends Record<string, any> = {}
> {
  middleware: IMiddleware<C>;
  config?: C;
}

export interface IMiddlewareExecutionInput<
  TTaskInput = any,
  TResourceConfig = any
> {
  /** Task hook: present when wrapping a task run. */
  task?: {
    definition: ITask<TTaskInput, any, any, any>;
    input: TTaskInput;
  };
  /** Resource hook: present when wrapping init/dispose. */
  resource?: {
    definition: IResource<TResourceConfig, any, any, any, any>;
    config: TResourceConfig;
  };
  next: (
    taskInputOrResourceConfig?: TTaskInput | TResourceConfig
  ) => Promise<any>;
}
