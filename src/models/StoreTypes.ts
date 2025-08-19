import {
  DependencyMapType,
  DependencyValuesType,
  IEventDefinition,
  IResource,
  ITask,
  IHook,
  ITaskMiddleware,
  IResourceMiddleware,
  IEvent,
  TaskLocalInterceptor,
  ResourceDependencyValuesType,
} from "../defs";

export type ResourceStoreElementType<
  C = any,
  V extends Promise<any> = any,
  D extends DependencyMapType = {},
  TContext = any,
> = {
  resource: IResource<C, V, D>;
  computedDependencies?: ResourceDependencyValuesType<D>;
  config: C;
  value: V;
  context: TContext;
  isInitialized?: boolean;
};

export type TaskStoreElementType<
  Input = any,
  Output extends Promise<any> = any,
  D extends DependencyMapType = any,
> = {
  task: ITask<Input, Output, D>;
  computedDependencies: DependencyValuesType<D>;
  isInitialized: boolean;
  interceptors?: Array<TaskLocalInterceptor<any, any>>;
};

export type HookStoreElementType<
  D extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition = any,
> = {
  hook: IHook<D, TOn>;
  computedDependencies: DependencyValuesType<D>;
};

export type TaskMiddlewareStoreElementType<
  TDeps extends DependencyMapType = any,
> = {
  middleware: ITaskMiddleware<any, TDeps>;
  computedDependencies: DependencyValuesType<TDeps>;
};

export type ResourceMiddlewareStoreElementType<
  TDeps extends DependencyMapType = any,
> = {
  middleware: IResourceMiddleware<any, TDeps>;
  computedDependencies: DependencyValuesType<TDeps>;
};

export type EventStoreElementType = {
  event: IEvent<any>;
};
