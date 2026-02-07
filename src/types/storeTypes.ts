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
}

export type ResourceStoreElementType<
  C = any,
  V extends Promise<any> = any,
  D extends DependencyMapType = {},
  TContext = any,
> = {
  resource: IResource<C, V, D, TContext>;
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
  dependencyState: HookDependencyState;
};

export type TaskMiddlewareStoreElementType<
  TDeps extends DependencyMapType = any,
> = {
  middleware: ITaskMiddleware<any, any, any, TDeps>;
  computedDependencies: DependencyValuesType<TDeps>;
  isInitialized: boolean;
};

export type ResourceMiddlewareStoreElementType<
  TDeps extends DependencyMapType = any,
> = {
  middleware: IResourceMiddleware<any, any, any, TDeps>;
  computedDependencies: DependencyValuesType<TDeps>;
  isInitialized: boolean;
};

export type EventStoreElementType = {
  event: IEvent<any>;
};
