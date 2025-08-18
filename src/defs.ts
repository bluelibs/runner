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
} from "./defs.returnTag";

export interface ITaggable {
  tags?: TagType[];
}
/**
 * Generic validation schema interface that can be implemented by any validation library.
 * Compatible with Zod, Yup, Joi, and other validation libraries.
 */
export interface IValidationSchema<T = any> {
  /**
   * Parse and validate the input data.
   * Should throw an error if validation fails.
   * Can transform the data if the schema supports transformations.
   */
  parse(input: unknown): T;
}

// Re-export public cache type so consumers don’t import from internals.
export { ICacheInstance } from "./globals/middleware/cache.middleware";
export * from "./models/StoreTypes";
/**
 * Internal brand symbols used to tag created objects at runtime and help with
 * type‑narrowing. Prefer the `isTask`/`isResource`/`isEvent`/`isMiddleware`
 * helpers instead of touching these directly.
 * @internal
 */
export const symbolTask: unique symbol = Symbol("runner.task");
export const symbolResource: unique symbol = Symbol("runner.resource");
export const symbolResourceWithConfig: unique symbol = Symbol(
  "runner.resourceWithConfig",
);
export const symbolEvent: unique symbol = Symbol("runner.event");
export const symbolMiddleware: unique symbol = Symbol("runner.middleware");
export const symbolMiddlewareConfigured: unique symbol = Symbol(
  "runner.middlewareConfigured",
);
/** @internal Marks hook definitions (event listeners without middleware) */
export const symbolHook: unique symbol = Symbol("runner.hook");
export const symbolMiddlewareGlobal: unique symbol = Symbol(
  "runner.middlewareGlobal",
);
export const symbolMiddlewareEverywhereTasks: unique symbol = Symbol(
  "runner.middlewareGlobalTasks",
);
export const symbolMiddlewareEverywhereResources: unique symbol = Symbol(
  "runner.middlewareGlobalResources",
);
/** @internal Marks a tag definition */
export const symbolTag: unique symbol = Symbol("runner.tag");

/** @internal Marks an optional dependency wrapper */
export const symbolOptionalDependency: unique symbol = Symbol(
  "runner.optionalDependency",
);

/** @internal Path to aid anonymous id generation and error messages */
export const symbolFilePath: unique symbol = Symbol("runner.filePath");
/** @internal Marks disposable instances */
export const symbolDispose: unique symbol = Symbol("runner.dispose");
/** @internal Link to internal Store */
export const symbolStore: unique symbol = Symbol("runner.store");

/** @internal Brand used by index() resources */
export const symbolIndexResource: unique symbol = Symbol(
  "runner.indexResource",
);

export interface ITagDefinition<TConfig = void, TEnforceContract = void> {
  id: string;
  meta?: ITagMeta;
  configSchema?: IValidationSchema<TConfig>;
}

/**
 * A configured instance of a tag as produced by `ITag.with()`.
 */
export interface ITagWithConfig<TConfig = void, TEnforceContract = void> {
  id: string;
  /** The tag definition used to produce this configured instance. */
  tag: ITag<TConfig, TEnforceContract>;
  /** The configuration captured for this tag instance. */
  config: TConfig;
}

/**
 * A tag definition (builder). Use `.with(config)` to obtain configured instances,
 * and `.extract(tags)` to find either a configured instance or the bare tag in a list.
 */
export interface ITag<TConfig = void, TEnforceContract = void>
  extends ITagDefinition<TConfig, TEnforceContract> {
  /**
   * Creates a configured instance of the tag.
   */
  with(config: TConfig): ITagWithConfig<TConfig, TEnforceContract>;
  /**
   * Extracts either a configured instance or the bare tag from a list of tags.
   */
  extract(
    target: ITaggable | TagType[],
  ): ExtractedTagResult<TConfig, TEnforceContract> | null;
  [symbolFilePath]: string;
  [symbolTag]: true;
}

/**
 * Restrict bare tags to those whose config can be omitted (void or optional object),
 * mirroring the same principle used for resources in `RegisterableItems`.
 * Required-config tags must appear as configured instances.
 */
export type TagType =
  | ITag<void, any>
  | ITag<{ [K in any]?: any }, any>
  | ITagWithConfig<any, any>;

/**
 * Conditional result type for `ITag.extract`:
 * - For void config → just the identifier
 * - For optional object config → identifier with optional config
 * - For required config → identifier with required config
 */
export type ExtractedTagResult<TConfig, TEnforceContract> = {} extends TConfig
  ? { id: string; config?: TConfig }
  : { id: string; config: TConfig };

/**
 * Common metadata you can attach to tasks/resources/events/middleware.
 * Useful for docs, filtering and middleware decisions.
 */
export interface IMeta {
  title?: string;
  description?: string;
}

export interface ITaskMeta extends IMeta {}
export interface IResourceMeta extends IMeta {}
export interface IEventMeta extends IMeta {}
export interface IMiddlewareMeta extends IMeta {}
export interface ITagMeta extends Omit<IMeta, "tags"> {}

/**
 * A mapping of dependency keys to Runner definitions. Used in `dependencies`
 * for tasks and resources. Values are later transformed into the actual
 * callable/value shape by `DependencyValuesType`.
 */
export type DependencyMapType = Record<
  string,
  | ITask<any, any, any, any>
  | IResource<any, any, any, any, any>
  | IEventDefinition<any>
  | IOptionalDependency<ITask<any, any, any, any>>
  | IOptionalDependency<IResource<any, any, any, any, any>>
  | IOptionalDependency<IEventDefinition<any>>
>;

/** Wrapper type marking a dependency as optional at wiring time */
export interface IOptionalDependency<T> {
  /** The wrapped dependency definition */
  inner: T;
  /** Brand symbol for optional dependency */
  [symbolOptionalDependency]: true;
}

// Helper Types for Extracting Generics
type ExtractTaskInput<T> = T extends ITask<infer I, any, infer D> ? I : never;
type ExtractTaskOutput<T> = T extends ITask<any, infer O, infer D> ? O : never;
type ExtractResourceValue<T> = T extends IResource<any, infer V, infer D>
  ? V extends Promise<infer U>
    ? U
    : V
  : never;

type ExtractEventParams<T> = T extends IEvent<infer P> ? P : never;

/**
 * Task dependencies transform into callable functions: call with the task input
 * and you receive the task output.
 */
type TaskDependency<I, O> = (...args: I extends null | void ? [] : [I]) => O;
/**
 * Resource dependencies resolve to the resource's value directly.
 */
type ResourceDependency<V> = V;
/**
 * Event dependencies resolve to an emitter function. If the payload type is
 * `void`, the function can be called with zero args (or an empty object).
 */
type EventDependency<P> = P extends void
  ? (() => Promise<void>) & ((input?: Record<string, never>) => Promise<void>)
  : (input: P) => Promise<void>;

/**
 * Transforms a dependency definition into the usable shape inside `run`/`init`:
 * - Task -> callable function
 * - Resource -> resolved value
 * - Event -> emit function
 */
export type DependencyValueType<T> = T extends ITask<any, any, any>
  ? TaskDependency<ExtractTaskInput<T>, ExtractTaskOutput<T>>
  : T extends IResource<any, any>
  ? ResourceDependency<ExtractResourceValue<T>>
  : T extends IEventDefinition<any>
  ? EventDependency<ExtractEventParams<T>>
  : T extends IOptionalDependency<infer U>
  ? DependencyValueType<U> | undefined
  : never;

export type DependencyValuesType<T extends DependencyMapType> = {
  [K in keyof T]: DependencyValueType<T[K]>;
};

// Per-task local interceptor for resource dependency context
export type TaskLocalInterceptor<TInput, TOutput> = (
  next: (input: TInput) => TOutput,
  input: TInput,
) => TOutput;

// When tasks are injected into resources, they expose an intercept() API
export type TaskDependencyWithIntercept<TInput, TOutput> = TaskDependency<
  TInput,
  TOutput
> & {
  intercept: (middleware: TaskLocalInterceptor<TInput, TOutput>) => void;
};

/** Resource-context dependency typing where tasks expose intercept() */
export type ResourceDependencyValueType<T> = T extends ITask<any, any, any>
  ? TaskDependencyWithIntercept<ExtractTaskInput<T>, ExtractTaskOutput<T>>
  : T extends IResource<any, any>
  ? ResourceDependency<ExtractResourceValue<T>>
  : T extends IEventDefinition<any>
  ? EventDependency<ExtractEventParams<T>>
  : T extends IOptionalDependency<infer U>
  ? ResourceDependencyValueType<U> | undefined
  : never;

export type ResourceDependencyValuesType<T extends DependencyMapType> = {
  [K in keyof T]: ResourceDependencyValueType<T[K]>;
};

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
  | IEvent<any>
  | ITag<any, any>;

export type MiddlewareAttachments =
  | IMiddleware<void>
  | IMiddleware<{ [K in any]?: any }>
  | IMiddlewareConfigured<any>;

export interface ITaskDefinition<
  TInput = undefined,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
> {
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
    dependencies: DependencyValuesType<TDependencies>,
  ) => HasContracts<TTags> extends true
    ? EnsureResponseSatisfiesContracts<TTags, TOutput>
    : TOutput;

  tags?: TTags;
}

// Lifecycle event payload types removed

/**
 * This is the response after the definition has been prepared. TODO: better naming?
 */
export interface ITask<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
> extends ITaskDefinition<TInput, TOutput, TDependencies, TMeta, TTags> {
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  middleware: MiddlewareAttachments[];
  [symbolFilePath]: string;
  [symbolTask]: true;
  /** Return an optional dependency wrapper for this task. */
  optional: () => IOptionalDependency<
    ITask<TInput, TOutput, TDependencies, TMeta, TTags>
  >;
  tags: TTags;
}

/**
 * Hook definition and instance types (event listeners without middleware)
 */
export interface IHookDefinition<
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> = any,
  TMeta extends ITaskMeta = any,
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
  on: TOn;
  /** Listener execution order. Lower numbers run first. */
  order?: number;
  meta?: TMeta;
  run: (
    event: IEventEmission<TOn extends "*" ? any : ExtractEventParams<TOn>>,
    dependencies: DependencyValuesType<TDependencies>,
  ) => Promise<any>;
  tags?: TagType[];
}

export interface IHook<
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> = any,
  TMeta extends ITaskMeta = any,
> extends IHookDefinition<TDependencies, TOn, TMeta> {
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  [symbolFilePath]: string;
  [symbolHook]: true;
  tags: TagType[];
}

export interface IResourceDefinition<
  TConfig = any,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = {},
  TContext = any,
  THooks = any,
  TRegisterableItems = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
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
    context: TContext,
  ) => HasContracts<TTags> extends true
    ? EnsureResponseSatisfiesContracts<TTags, TValue>
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
  tags?: TTags;
}

export interface IResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = any,
  TContext = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
> extends IResourceDefinition<
    TConfig,
    TValue,
    TDependencies,
    TContext,
    any,
    any,
    TMeta,
    TTags
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
  tags: TTags;
}

export interface IResourceWithConfig<
  TConfig = any,
  TValue extends Promise<any> = Promise<any>,
  TDependencies extends DependencyMapType = any,
> {
  /** The id of the underlying resource. */
  id: string;
  /** The underlying resource definition. */
  resource: IResource<TConfig, TValue, TDependencies>;
  /** The configuration captured by `.with(config)`. */
  config: TConfig;
}

export type EventHandlerType<T = any> = (
  event: IEventEmission<T>,
) => any | Promise<any>;

export interface IEventDefinition<TPayload = void> {
  id: string;
  meta?: IEventMeta;
  /**
   * Optional validation schema for runtime payload validation.
   * When provided, event payload will be validated when emitted.
   */
  payloadSchema?: IValidationSchema<TPayload>;
  tags?: TagType[];
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
  tags: TagType[];
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
  /**
   * The tags that the event carries.
   */
  tags: TagType[];
}

export interface IMiddlewareDefinition<
  TConfig = any,
  TDependencies extends DependencyMapType = any,
> {
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
    config: TConfig,
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
  tags?: TagType[];
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
  TDependencies extends DependencyMapType = any,
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
    config?: MiddlewareEverywhereOptions,
  ): IMiddleware<TConfig, TDependencies>;
  /** Current configuration object (empty by default). */
  config: TConfig;
  /** Configure the middleware and return a marked, configured instance. */
  with: (config: TConfig) => IMiddlewareConfigured<TConfig, TDependencies>;
  [symbolFilePath]: string;
  [symbolMiddleware]: true;
  tags: TagType[];
}

export interface IMiddlewareConfigured<
  TConfig = any,
  TDependencies extends DependencyMapType = any,
> extends IMiddleware<TConfig, TDependencies> {
  [symbolMiddlewareConfigured]: true;
}

export interface IMiddlewareDefinitionConfigured<
  C extends Record<string, any> = {},
> {
  middleware: IMiddleware<C>;
  config?: C;
}

export interface IMiddlewareExecutionInput<
  TTaskInput = any,
  TResourceConfig = any,
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
    taskInputOrResourceConfig?: TTaskInput | TResourceConfig,
  ) => Promise<any>;
}
