import {
  DependencyMapType,
  DependencyValuesType,
  ResourceDependencyValuesType,
} from "./utilities";
import { IResource } from "./resource";
import { ITask } from "./task";
import { IHook } from "./hook";
import { ITaskMiddleware } from "./taskMiddleware";
import { IResourceMiddleware } from "./resourceMiddleware";
import { IEvent } from "./event";
import { IEventDefinition } from "./event";
import { TaskLocalInterceptor } from "./utilities";

export enum HookDependencyState {
  Pending = "pending",
  Computing = "computing",
  Ready = "ready",
  Error = "error",
}

export type StoreDefinition<TDefinition extends { id: string }> =
  TDefinition & {
    id: string;
  };

export type StoreResourceDefinition<
  C = any,
  V extends Promise<any> = any,
  D extends DependencyMapType = {},
  TContext = any,
> = StoreDefinition<IResource<C, V, D, TContext>>;

export type StoreTaskDefinition<
  Input = any,
  Output extends Promise<any> = any,
  D extends DependencyMapType = any,
> = StoreDefinition<ITask<Input, Output, D>>;

export type StoreHookDefinition<
  D extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition = any,
> = StoreDefinition<IHook<D, TOn>>;

export type StoreTaskMiddlewareDefinition<
  TDeps extends DependencyMapType = any,
> = StoreDefinition<ITaskMiddleware<any, any, any, TDeps>>;

export type StoreResourceMiddlewareDefinition<
  TDeps extends DependencyMapType = any,
> = StoreDefinition<IResourceMiddleware<any, any, any, TDeps>>;

export type StoreEventDefinition = StoreDefinition<IEvent<any>>;

export type ResourceStoreElementType<
  C = any,
  V extends Promise<any> = any,
  D extends DependencyMapType = {},
  TContext = any,
> = {
  resource: StoreResourceDefinition<C, V, D, TContext>;
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
  task: StoreTaskDefinition<Input, Output, D>;
  computedDependencies: DependencyValuesType<D>;
  isInitialized: boolean;
  interceptors?: Array<TaskLocalInterceptorRecord<any, any>>;
};

export type TaskLocalInterceptorRecord<TInput = any, TOutput = any> = {
  interceptor: TaskLocalInterceptor<TInput, TOutput>;
  ownerResourceId?: string;
};

export type HookStoreElementType<
  D extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition = any,
> = {
  hook: StoreHookDefinition<D, TOn>;
  computedDependencies: DependencyValuesType<D>;
  dependencyState: HookDependencyState;
};

export type TaskMiddlewareStoreElementType<
  TDeps extends DependencyMapType = any,
> = {
  middleware: StoreTaskMiddlewareDefinition<TDeps>;
  computedDependencies: DependencyValuesType<TDeps>;
  isInitialized: boolean;
};

export type ResourceMiddlewareStoreElementType<
  TDeps extends DependencyMapType = any,
> = {
  middleware: StoreResourceMiddlewareDefinition<TDeps>;
  computedDependencies: DependencyValuesType<TDeps>;
  isInitialized: boolean;
};

export type EventStoreElementType = {
  event: StoreEventDefinition;
};

export type InitWave = {
  resourceIds: string[];
  parallel: boolean;
};

export type DisposeWave = {
  resources: ResourceStoreElementType[];
  parallel: boolean;
};
