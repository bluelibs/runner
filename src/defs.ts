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

export const symbols = {
  task: symbolTask,
  resource: symbolResource,
  resourceWithConfig: symbolResourceWithConfig,
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
type ExtractEventParams<T> = T extends IEventDefinition<infer P> ? P : never;

// Helper Types for Dependency Value Construction
type TaskDependency<I, O> = (...args: I extends null | void ? [] : [I]) => O;
type ResourceDependency<V> = V;
type EventDependency<P> = (input: P) => Promise<void>;

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

type Optional<T> = {
  [K in keyof T]?: T[K];
};

// Utility type to check if a type is void
type IsVoid<T> = [T] extends [void] ? true : false;

// Utility type to check if a type is optional (can be undefined)
type IsOptional<T> = undefined extends T ? true : false;

// IReso

// Conditional type to allow `void`, optional, or any type
type OptionalOrVoidOrAnything<T> = IsVoid<T> extends true
  ? void
  : IsOptional<T> extends true
  ? Optional<T>
  : T;

type OnlyOptionalFields<T> = {} extends T ? true : false;

type r1 = OnlyOptionalFields<{ ok: boolean }>;
type r2 = OnlyOptionalFields<{ ok?: boolean }>;
type r3 = OnlyOptionalFields<void>;

// RegisterableItems Type with Conditional Inclusion
export type RegisterableItems<T = any> =
  | IResourceWithConfig<any>
  | IResource<void, any, any, any> // For void configs
  | IResource<{ [K in any]?: any }, any, any, any> // For optional config
  | ITaskDefinition<any, any, any, any>
  | IMiddlewareDefinition<any>
  | IEventDefinition<any>;

export type MiddlewareAttachments =
  | IMiddleware<void>
  | IMiddleware<{ [K in any]?: any }>
  | IMiddlewareConfigured<any>;

// Then create a wrapper that validates:
type ValidateRegisterable<T> = T extends IResource<infer Config, any, any, any>
  ? IsVoid<Config> extends true
    ? T
    : OnlyOptionalFields<Config> extends true
    ? T
    : never
  : T;
export interface ITaskDefinition<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> | undefined = undefined // Adding a generic to track 'on' type
> {
  id: string;
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
      : IEvent<TOn extends "*" ? any : ExtractEventParams<TOn>>,
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
  dependencies: TDependencies | (() => TDependencies);
  computedDependencies?: DependencyValuesType<TDependencies>;
  middleware: MiddlewareAttachments[];
  /**
   * These events are automatically populated after the task has been defined.
   */
  events: {
    beforeRun: IEventDefinition<BeforeRunEventPayload<TInput>>;
    afterRun: IEventDefinition<AfterRunEventPayload<TInput, TOutput>>;
    onError: IEventDefinition<OnErrorEventPayload>;
  };
}
// Resource interfaces
// Conditional type to determine the value type based on whether init is present
type ResourceValueType<T> = T extends { init: any }
  ? T["init"] extends (...args: any[]) => Promise<infer R>
    ? R
    : unknown
  : undefined;

export interface IResourceDefinition<
  TConfig = any,
  TValue = unknown,
  TDependencies extends DependencyMapType = {},
  TContext = any,
  THooks = any,
  TRegisterableItems = any
> {
  id: string;
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
}

export interface IResource<
  TConfig = void,
  TValue = any,
  TDependencies extends DependencyMapType = any,
  TContext = any
> extends IResourceDefinition<TConfig, TValue, TDependencies, TContext> {
  with(config: TConfig): IResourceWithConfig<TConfig, TValue, TDependencies>;
  register:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  /**
   * These events are automatically populated after the task has been defined.
   */
  events: {
    beforeInit: IEventDefinition<BeforeInitEventPayload<TConfig>>;
    afterInit: IEventDefinition<AfterInitEventPayload<TConfig, TValue>>;
    onError: IEventDefinition<OnErrorEventPayload>;
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

export interface IEvent<TPayload = any> {
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
}

export type EventHandlerType<T = any> = (
  event: IEvent<T>
) => any | Promise<any>;

// Other necessary interfaces
export interface IEventDefinitionConfig<TPayload = void> {
  id: string;
  meta?: IEventMeta;
}

export interface IEventDefinition<TPayload = void> {
  id: string;
  /**
   * We use this event to discriminate between resources with just 'id' and 'events' as they collide. This is a workaround, should be redone using classes and instanceof.
   */
  [symbolEvent]: true;
  meta?: IEventMeta;
}

export interface IMiddlewareDefinition<
  TConfig = any,
  TDependencies extends DependencyMapType = any
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
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
  dependencies: TDependencies | (() => TDependencies);
  everywhere(): IMiddleware<TConfig, TDependencies>;
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

export interface IHookDefinition<
  D extends DependencyMapType = {},
  T = any,
  B extends boolean = false
> {
  event: "*" | IEventDefinition<T>;
  /**
   * The higher the number, the higher the priority.
   * We recommend using numbers between -1000 and 1000.
   */
  order?: number;
  /**
   * These are hooks that run before any resource instantiation.
   * @param event
   */
  early?: B;
  run: (
    event: IEvent<T>,
    dependencies: T extends true ? void : DependencyValuesType<D>
  ) => Promise<void> | void;
}
