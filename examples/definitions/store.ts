import {
  DependencyMapType,
  DependencyValuesType,
  IMiddlewareDefinition,
  IEventDefinition,
  IResource,
  ITask,
  IHook,
  IResourceWithConfig,
  RegisterableItems,
  IMiddleware,
  IEvent,
  TaskLocalInterceptor,
  ResourceDependencyValuesType,
} from "../../src/defs";

export type ResourceStoreElementType<
  C = any,
  V extends Promise<any> = any,
  D extends DependencyMapType = {},
  TContext = any
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
  D extends DependencyMapType = any
> = {
  task: ITask<Input, Output, D>;
  computedDependencies: DependencyValuesType<D>;
  isInitialized: boolean;
  interceptors?: Array<TaskLocalInterceptor<any, any>>;
};

export type HookStoreElementType<
  D extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition = any
> = {
  hook: IHook<D, TOn>;
  computedDependencies: DependencyValuesType<D>;
  isInitialized: boolean;
};

export type MiddlewareStoreElementType<TDeps extends DependencyMapType = any> =
  {
    middleware: IMiddleware<TDeps>;
    computedDependencies: DependencyValuesType<TDeps>;
  };

export type EventStoreElementType = {
  event: IEvent<any>;
};
