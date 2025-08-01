import { index } from ".";
import { MiddlewareEverywhereOptions } from "./define";

export { ICacheInstance } from "./globals/middleware/cache.middleware";

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

export const symbolFilePath: unique symbol = Symbol("runner.filePath");
export const symbolDispose: unique symbol = Symbol("runner.dispose");
export const symbolStore: unique symbol = Symbol("runner.store");

export const symbolIndexResource: unique symbol = Symbol(
  "runner.indexResource"
);

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

export interface IMeta {
  title?: string;
  description?: string;
  tags?: string[];
}

export interface ITaskMeta extends IMeta {}
export interface IResourceMeta extends IMeta {}
export interface IEventMeta extends IMeta {}
export interface IMiddlewareMeta extends IMeta {}

// DependencyMap types
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
 * This represents a task dependency function that can be called with or without parameters.
 */
type TaskDependency<I, O> = (...args: I extends null | void ? [] : [I]) => O;
/**
 * This represents the resource's value type.
 */
type ResourceDependency<V> = V;
/**
 * This represents an event emission function that can be called with or without parameters.
 */
type EventDependency<P> = P extends void
  ? (() => Promise<void>) & ((input?: Record<string, never>) => Promise<void>)
  : (input: P) => Promise<void>;

// Main DependencyValueType Definition
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

// RegisterableItems Type with Conditional Inclusion
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
  id?: string | symbol;
  dependencies?: TDependencies | (() => TDependencies);
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
  meta?: ITaskMeta;
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
  id?: string | symbol;
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  register?:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
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
  overrides?: Array<IResource | ITask | IMiddleware | IResourceWithConfig>;
  middleware?: MiddlewareAttachments[];
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
  id: string;
  resource: IResource<TConfig, TValue, TDependencies>;
  config: TConfig;
}

export type EventHandlerType<T = any> = (
  event: IEventEmission<T>
) => any | Promise<any>;

export interface IEventDefinition<TPayload = void> {
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
}

export interface IMiddlewareDefinition<
  TConfig = any,
  TDependencies extends DependencyMapType = any
> {
  id?: string | symbol;
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
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
  everywhere(
    config?: MiddlewareEverywhereOptions
  ): IMiddleware<TConfig, TDependencies>;
  config: TConfig;
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
  task?: {
    definition: ITask<TTaskInput>;
    input: TTaskInput;
  };
  resource?: {
    definition: IResource<TResourceConfig>;
    config: TResourceConfig;
  };
  next: (
    taskInputOrResourceConfig?: TTaskInput | TResourceConfig
  ) => Promise<any>;
}
