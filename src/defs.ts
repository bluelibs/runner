/**
 * Core public TypeScript types for BlueLibs Runner.
 *
 * This file contains the strongly-typed contract for tasks, resources, events
 * and middleware. It mirrors the mental model described in the README:
 * - Tasks are functions (with lifecycle events)
 * - Resources are singletons (with init/dispose hooks and lifecycle events)
 * - Events are simple, strongly-typed emissions
 * - Middleware can target both tasks and resources
 *
 * DX goals:
 * - Crystal‑clear generics and helper types that infer dependency shapes
 * - Friendly JSDoc you can hover in editors to understand usage instantly
 * - Safe overrides and strong typing around config and register mechanics
 */

import { MiddlewareEverywhereOptions } from "./define";

// Re-export public cache type so consumers don’t import from internals.
export { ICacheInstance } from "./globals/middleware/cache.middleware";

/**
 * Internal brand symbols used to tag created objects at runtime and help with
 * type‑narrowing. Prefer the `isTask`/`isResource`/`isEvent`/`isMiddleware`
 * helpers instead of touching these directly.
 * @internal
 */
export const symbolTask: unique symbol = Symbol("runner.task");
export const symbolResource: unique symbol = Symbol("runner.resource");
export const symbolResourceWithConfig: unique symbol = Symbol(
  "runner.resourceWithConfig"
);
export const symbolEvent: unique symbol = Symbol("runner.event");
export const symbolMiddleware: unique symbol = Symbol("runner.middleware");
export const symbolMiddlewareConfigured: unique symbol = Symbol(
  "runner.middlewareConfigured"
);
export const symbolMiddlewareGlobal: unique symbol = Symbol(
  "runner.middlewareGlobal"
);
export const symbolMiddlewareEverywhereTasks: unique symbol = Symbol(
  "runner.middlewareGlobalTasks"
);
export const symbolMiddlewareEverywhereResources: unique symbol = Symbol(
  "runner.middlewareGlobalResources"
);

/** @internal Path to aid anonymous id generation and error messages */
export const symbolFilePath: unique symbol = Symbol("runner.filePath");
/** @internal Marks disposable instances */
export const symbolDispose: unique symbol = Symbol("runner.dispose");
/** @internal Link to internal Store */
export const symbolStore: unique symbol = Symbol("runner.store");

/** @internal Brand used by index() resources */
export const symbolIndexResource: unique symbol = Symbol(
  "runner.indexResource"
);

/**
 * Convenience bag of internal symbols. Intended for framework internals;
 * consumers should not rely on this shape.
 * @internal
 */
export const symbols = {
  task: symbolTask,
  resource: symbolResource,
  resourceWithConfig: symbolResourceWithConfig,
  indexResource: symbolIndexResource,
  event: symbolEvent,
  middleware: symbolMiddleware,
  middlewareEverywhereTasks: symbolMiddlewareEverywhereTasks,
  middlewareEverywhereResources: symbolMiddlewareEverywhereResources,
  filePath: symbolFilePath,
  dispose: symbolDispose,
  store: symbolStore,
};
export interface ITagDefinition<TConfig = void> {
  id: string | symbol;
}

/**
 * A configured instance of a tag as produced by `ITag.with()`.
 */
export interface ITagWithConfig<TConfig = void> {
  id: string | symbol;
  /** The tag definition used to produce this configured instance. */
  tag: ITag<TConfig>;
  /** The configuration captured for this tag instance. */
  config: TConfig;
}

/**
 * A tag definition (builder). Use `.with(config)` to obtain configured instances,
 * and `.extract(tags)` to find either a configured instance or the bare tag in a list.
 */
export interface ITag<TConfig = void> extends ITagDefinition<TConfig> {
  /**
   * Creates a configured instance of the tag.
   */
  with(config: TConfig): ITagWithConfig<TConfig>;
  /**
   * Extracts either a configured instance or the bare tag from a list of tags
   * or from a taggable object (`{ meta: { tags?: [] } }`).
   */
  extract(
    target: TagType[] | ITaggable
  ): { id: string | symbol; config?: TConfig } | null;
}

export type TagType = string | ITagDefinition<any> | ITagWithConfig<any>;

/**
 * Any object that can carry tags via metadata. This mirrors how tasks,
 * resources, events, and middleware expose `meta.tags`.
 */
export interface ITaggable {
  meta?: {
    tags?: TagType[];
  };
}

/**
 * Common metadata you can attach to tasks/resources/events/middleware.
 * Useful for docs, filtering and middleware decisions.
 */
export interface IMeta {
  title?: string;
  description?: string;
  tags?: TagType[];
}

export interface ITaskMeta extends IMeta {}
export interface IResourceMeta extends IMeta {}
export interface IEventMeta extends IMeta {}
export interface IMiddlewareMeta extends IMeta {}

/**
 * A mapping of dependency keys to Runner definitions. Used in `dependencies`
 * for tasks and resources. Values are later transformed into the actual
 * callable/value shape by `DependencyValuesType`.
 */
export type DependencyMapType = Record<
  string,
  ITask<any, any, any, any> | IResource<any, any, any> | IEventDefinition<any>
>;

// Helper Types for Extracting Generics
type ExtractTaskInput<T> = T extends ITask<infer I, any, infer D> ? I : never;
type ExtractTaskOutput<T> = T extends ITask<any, infer O, infer D> ? O : never;
type ExtractResourceValue<T> = T extends IResource<any, infer V, infer D>
  ? V
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
  : never;

export type DependencyValuesType<T extends DependencyMapType> = {
  [K in keyof T]: DependencyValueType<T[K]>;
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
  TOn extends "*" | IEventDefinition<any> | undefined = undefined // Adding a generic to track 'on' type
> {
  /**
   * Stable identifier. If omitted, an anonymous id is generated from file path
   * (see README: Anonymous IDs).
   */
  id?: string | symbol;
  /**
   * Access other tasks/resources/events. Can be an object or a function when
   * you need late or config‑dependent resolution.
   */
  dependencies?: TDependencies | (() => TDependencies);
  /** Middleware applied around task execution. */
  middleware?: MiddlewareAttachments[];
  /**
   * Listen to events in a simple way
   */
  on?: TOn;
  /**
   * This makes sense only when `on` is specified to provide the order of the execution.
   * The event with the lowest order will be executed first.
   */
  listenerOrder?: number;
  /** Optional metadata used for docs, filtering and tooling. */
  meta?: ITaskMeta;
  /**
   * The task body. If `on` is set, the input is an `IEventEmission`. Otherwise,
   * it's the declared input type.
   */
  run: (
    input: TOn extends undefined
      ? TInput
      : IEventEmission<TOn extends "*" ? any : ExtractEventParams<TOn>>,
    dependencies: DependencyValuesType<TDependencies>
  ) => TOutput;
}

export type BeforeRunEventPayload<TInput> = {
  input: TInput;
};

export type AfterRunEventPayload<TInput, TOutput> = {
  input: TInput;
  output: TOutput extends Promise<infer U> ? U : TOutput;
  setOutput(newOutput: TOutput extends Promise<infer U> ? U : TOutput): void;
};

export type OnErrorEventPayload = {
  error: any;
  /**
   * This function can be called to suppress the error from being thrown.
   */
  suppress(): void;
};

export type BeforeInitEventPayload<TConfig> = {
  config: TConfig;
};

export type AfterInitEventPayload<TConfig, TValue> = {
  config: TConfig;
  value: TValue;
};

/**
 * This is the response after the definition has been prepared. TODO: better naming?
 */
export interface ITask<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> | undefined = undefined
> extends ITaskDefinition<TInput, TOutput, TDependencies, TOn> {
  id: string | symbol;
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  middleware: MiddlewareAttachments[];
  /**
   * These events are automatically populated after the task has been defined.
   */
  events: {
    beforeRun: IEvent<BeforeRunEventPayload<TInput>>;
    afterRun: IEvent<AfterRunEventPayload<TInput, TOutput>>;
    onError: IEvent<OnErrorEventPayload>;
  };
}

export interface IResourceDefinition<
  TConfig = any,
  TValue = unknown,
  TDependencies extends DependencyMapType = {},
  TContext = any,
  THooks = any,
  TRegisterableItems = any
> {
  /** Stable identifier. Omit to get an anonymous id. */
  id?: string | symbol;
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
    dependencies: DependencyValuesType<TDependencies>,
    context: TContext
  ) => Promise<TValue>;
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
    value: TValue,
    config: TConfig,
    dependencies: DependencyValuesType<TDependencies>,
    context: TContext
  ) => Promise<void>;
  meta?: IResourceMeta;
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
   */
  [symbolFilePath]?: string;
  /**
   * This is used internally when creating index resources.
   */
  [symbolIndexResource]?: boolean;
}

export interface IResource<
  TConfig = void,
  TValue = any,
  TDependencies extends DependencyMapType = any,
  TContext = any
> extends IResourceDefinition<TConfig, TValue, TDependencies, TContext> {
  id: string | symbol;
  with(config: TConfig): IResourceWithConfig<TConfig, TValue, TDependencies>;
  register:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  /**
   * These events are automatically populated after the task has been defined.
   */
  events: {
    beforeInit: IEvent<BeforeInitEventPayload<TConfig>>;
    afterInit: IEvent<AfterInitEventPayload<TConfig, TValue>>;
    onError: IEvent<OnErrorEventPayload>;
  };
  overrides: Array<IResource | ITask | IMiddleware | IResourceWithConfig>;
  middleware: MiddlewareAttachments[];
}

export interface IResourceWithConfig<
  TConfig = any,
  TValue = any,
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
  /** Stable identifier. Omit to get an anonymous id. */
  id?: string | symbol;
  meta?: IEventMeta;
}

export interface IEvent<TPayload = any> extends IEventDefinition<TPayload> {
  id: string | symbol;
  /**
   * We use this event to discriminate between resources with just 'id' and 'events' as they collide. This is a workaround, should be redone using classes and instanceof.
   */
  [symbolEvent]: true;
}

/**
 * This represents the object that is passed to event handlers
 */
export interface IEventEmission<TPayload = any> {
  /**
   * The ID of the event. This is the same as the event's ID.
   * This is useful for global event listeners.
   */
  id: string | symbol;
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
  source: string | symbol;
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
  /** Stable identifier. Omit to get an anonymous id. */
  id?: string | symbol;
  /** Static or lazy dependency map. */
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  /**
   * The middleware body, called with task/resource execution input.
   */
  run: (
    input: IMiddlewareExecutionInput,
    dependencies: DependencyValuesType<TDependencies>,
    config: TConfig
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
}

export interface IMiddleware<
  TConfig = any,
  TDependencies extends DependencyMapType = any
> extends IMiddlewareDefinition<TConfig, TDependencies> {
  [symbolMiddleware]: true;
  [symbolMiddlewareConfigured]?: boolean;
  [symbolMiddlewareEverywhereTasks]?: boolean;
  [symbolMiddlewareEverywhereResources]?: boolean;

  id: string | symbol;
  dependencies: TDependencies | (() => TDependencies);
  /**
   * Attach this middleware globally. Use options to scope to tasks/resources.
   */
  everywhere(
    config?: MiddlewareEverywhereOptions
  ): IMiddleware<TConfig, TDependencies>;
  /** Current configuration object (empty by default). */
  config: TConfig;
  /** Configure the middleware and return a marked, configured instance. */
  with: (config: TConfig) => IMiddlewareConfigured<TConfig, TDependencies>;
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
    definition: ITask<TTaskInput>;
    input: TTaskInput;
  };
  /** Resource hook: present when wrapping init/dispose. */
  resource?: {
    definition: IResource<TResourceConfig>;
    config: TResourceConfig;
  };
  next: (
    taskInputOrResourceConfig?: TTaskInput | TResourceConfig
  ) => Promise<any>;
}
