export const symbols = {
  task: Symbol("task"),
  resource: Symbol("resource"),
  resourceWithConfig: Symbol("resourceWithConfig"),
  event: Symbol("event"),
  middleware: Symbol("middleware"),
  middlewareGlobal: Symbol("middlewareGlobal"),
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
  ITask | IResource | IEventDefinition | IResourceWithConfig<any, any>
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

// RegisterableItems Type with Conditional Inclusion
export type RegisterableItems =
  | IResourceWithConfig<any>
  | IResource<any>
  | ITaskDefinition
  | IMiddlewareDefinition
  | IEventDefinition;

export interface ITaskDefinition<
  TInput = any,
  TOutput extends Promise<any> = any,
  TDependencies extends DependencyMapType = {},
  TEventDefinitionInput = null
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
  middleware?: IMiddlewareDefinition[];
  /**
   * Listen to events in a simple way
   */
  on?: IEventDefinition<TEventDefinitionInput>;
  /**
   * This makes sense only when `on` is specified to provide the order of the execution.
   * The event with the lowest order will be executed first.
   */
  listenerOrder?: number;
  meta?: ITaskMeta;
  run: (
    input: TEventDefinitionInput extends null ? TInput : TEventDefinitionInput,
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
  TEventDefinitionInput = null
> extends ITaskDefinition<
    TInput,
    TOutput,
    TDependencies,
    TEventDefinitionInput
  > {
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
export interface IResourceDefinintion<
  TConfig = any,
  TValue = unknown,
  TDependencies extends DependencyMapType = {},
  THooks = any,
  TRegisterableItems = any
> {
  id: string;
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  hooks?:
    | IHookDefinition<TDependencies, THooks>[]
    | ((config: TConfig) => IHookDefinition<TDependencies, THooks>[]);
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
> extends IResourceDefinintion<TConfig, TValue, TDependencies> {
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
  hooks:
    | IHookDefinition<TDependencies>[]
    | ((config: TConfig) => IHookDefinition<TDependencies>[]);

  overrides: Array<IResource | ITask | IMiddleware | IResourceWithConfig>;
  middleware: IMiddlewareDefinition[];
}

export interface IResourceWithConfig<
  TConfig = any,
  TValue = any,
  TDependencies extends DependencyMapType = any
> {
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
export interface IEventDefinition<TPayload = void> {
  id: string;
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
