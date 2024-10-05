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

export type DependencyValueType<T> = T extends ITask<
  infer I,
  infer O,
  /** The infer D, while not used is crucial for making this work correctly, otherwise it forces input: unknown to a dependency that has a dependency. */
  infer D
>
  ? (...args: I extends unknown ? [] : [I]) => O
  : T extends IResource<any, infer V>
  ? V
  : T extends IEventDefinition<infer P>
  ? (input: P) => Promise<void> | never
  : never;

export type DependencyValuesType<T extends DependencyMapType> = {
  [K in keyof T]: DependencyValueType<T[K]>;
};

// RegisterableItems Type with Conditional Inclusion
export type RegisterableItems =
  | IResource<void> // Always include IResource<void>
  | IResourceWithConfig<any>
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
  on?: IEventDefinition<TEventDefinitionInput>;
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
  TConfig = void,
  TValue = unknown,
  TDependencies extends DependencyMapType = {},
  THooks = any
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
  data: TPayload;
  timestamp: Date;
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

export interface IHookDefinition<D extends DependencyMapType = {}, T = any> {
  event: "*" | IEventDefinition<T>;
  run: (
    event: IEvent<T>,
    dependencies: DependencyValuesType<D>
  ) => Promise<void> | void;
}
