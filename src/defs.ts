export const symbolTask: unique symbol = Symbol("runner.task");
export const symbolResource: unique symbol = Symbol("runner.resource");
export const symbolResourceWithConfig: unique symbol = Symbol(
  "runner.resourceWithConfig"
);
export const symbolEvent: unique symbol = Symbol("runner.event");
export const symbolMiddleware: unique symbol = Symbol("runner.middleware");
export const symbolMiddlewareGlobal: unique symbol = Symbol(
  "runner.middlewareGlobal"
);

export const symbols = {
  task: symbolTask,
  resource: symbolResource,
  resourceWithConfig: symbolResourceWithConfig,
  event: symbolEvent,
  middleware: symbolMiddleware,
  middlewareGlobal: symbolMiddlewareGlobal,
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

// RegisterableItems Type with Conditional Inclusion
export type RegisterableItems<T = any> =
  | IResourceWithConfig<any>
  | IResource<void, any, any>
  | IResource<OptionalOrVoidOrAnything<T>, any, any>
  | ITaskDefinition<any, any, any, any>
  | IMiddlewareDefinition<any>
  | IEventDefinition<any>;

export interface ITaskDefinition<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> | undefined = undefined // Adding a generic to track 'on' type
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
  middleware?: IMiddlewareDefinition[];
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
    input: TOn extends undefined ? TInput : IEvent<ExtractEventParams<TOn>>,
    // input: TOn extends "*"
    //   ? IEvent<any>
    //   : TEventDefinitionInput extends null | void
    //   ? TInput
    // : IEvent<TEventDefinitionInput>,
    dependencies: DependencyValuesType<TDependencies>
  ) => TOutput;
}

export type BeforeRunEventPayload<TInput> = {
  input: TInput;
};

export type AfterRunEventPayload<TInput, TOutput> = {
  input: TInput;
  output: TOutput;
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
  middleware: IMiddlewareDefinition[];
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
export interface IResourceDefinition<
  TConfig = any,
  TValue = unknown,
  TDependencies extends DependencyMapType = {},
  THooks = any,
  TRegisterableItems = any
> {
  id: string;
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  register?:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  init?: (
    config: TConfig,
    dependencies: DependencyValuesType<TDependencies>
  ) => Promise<TValue>;
  /**
   * Clean-up function for the resource. This is called when the resource is no longer needed.
   *
   * @param value The value of the resource
   * @param config The configuration it received
   * @param dependencies The dependencies it needed
   * @returns
   */
  dispose?: (
    value: TValue,
    config: TConfig,
    dependencies: DependencyValuesType<TDependencies>
  ) => Promise<TValue>;
  meta?: IResourceMeta;
  overrides?: Array<IResource | ITask | IMiddleware | IResourceWithConfig>;
  middleware?: IMiddlewareDefinition[];
}

export interface IResource<
  TConfig = void,
  TValue = any,
  TDependencies extends DependencyMapType = any
> extends IResourceDefinition<TConfig, TValue, TDependencies> {
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
  middleware: IMiddlewareDefinition[];
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
  TDependencies extends DependencyMapType = any
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
  run: (
    input: IMiddlewareExecutionInput,
    dependencies: DependencyValuesType<TDependencies>
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
}

export interface IMiddleware<TDependencies extends DependencyMapType = any>
  extends IMiddlewareDefinition<TDependencies> {
  dependencies: TDependencies | (() => TDependencies);
  global(): IMiddleware<TDependencies>;
}

export interface IMiddlewareDefinitionConfigured<
  C extends Record<string, any> = {}
> {
  middleware: IMiddleware<C>;
  config?: C;
}

export interface IMiddlewareExecutionInput {
  taskDefinition?: ITask;
  resourceDefinition?: IResource;
  config?: any;
  input?: any;
  next: (taskInputOrResourceConfig?: any) => Promise<any>;
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
