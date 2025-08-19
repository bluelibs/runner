import { IResource, IResourceWithConfig } from "./resource";
import { ITask } from "./task";
import { ITaskMiddleware, ITaskMiddlewareConfigured } from "./taskMiddleware";
import {
  IResourceMiddleware,
  IResourceMiddlewareConfigured,
} from "./resourceMiddleware";
import { IHook } from "./hook";
import { IEvent, IEventDefinition } from "./event";
import { ITag } from "./tag";
import { symbolOptionalDependency } from "./symbols";

export * from "./symbols";

/**
 * Generic validation schema interface that can be implemented by any validation library.
 * Compatible with Zod, Yup, Joi, and other validation libraries.
 */
export interface IValidationSchema<T = any> {
  /**
   * Parse and validate the input data.
   * Should throw an error if validation fails.
   * Can transform the data if the schema supports transformations.
   */
  parse(input: unknown): T;
}

/**
 * Core public TypeScript types for BlueLibs Runner.
 *
 * This file contains the strongly-typed contract for tasks, resources, events
 * and middleware. It mirrors the mental model described in the README:
 * - Tasks are functions
 * - Resources are singletons (with init/dispose hooks)
 * - Events are simple, strongly-typed emissions
 * - Middleware can target both tasks and resources
 *
 * DX goals:
 * - Crystal‑clear generics and helper types that infer dependency shapes
 * - Friendly JSDoc you can hover in editors to understand usage instantly
 * - Safe overrides and strong typing around config and register mechanics
 */

export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

export type OverridableElements =
  | IResource<any, any, any, any, any>
  | ITask<any, any, any, any>
  | ITaskMiddleware<any>
  | IResourceMiddleware<any, any>
  | IResourceWithConfig<any, any, any>
  | IHook<any, any>;

/**
 * A mapping of dependency keys to Runner definitions. Used in `dependencies`
 * for tasks and resources. Values are later transformed into the actual
 * callable/value shape by `DependencyValuesType`.
 */
export type DependencyMapType = Record<
  string,
  | ITask<any, any, any, any, any, any>
  | IResource<any, any, any, any, any, any, any>
  | IEvent<any>
  | IOptionalDependency<ITask<any, any, any, any, any, any>>
  | IOptionalDependency<IResource<any, any, any, any, any, any, any>>
  | IOptionalDependency<IEvent<any>>
>;

/** Wrapper type marking a dependency as optional at wiring time */
export interface IOptionalDependency<T> {
  /** The wrapped dependency definition */
  inner: T;
  /** Brand symbol for optional dependency */
  [symbolOptionalDependency]: true;
}

// Helper Types for Extracting Generics
type ExtractTaskInput<T> = T extends ITask<infer I, any, infer D> ? I : never;
type ExtractTaskOutput<T> = T extends ITask<any, infer O, infer D> ? O : never;
type ExtractResourceValue<T> = T extends IResource<any, infer V, infer D>
  ? V extends Promise<infer U>
    ? U
    : V
  : never;

export type ExtractEventParams<T> = T extends IEvent<infer P> ? P : never;

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
  : T extends IOptionalDependency<infer U>
  ? DependencyValueType<U> | undefined
  : never;

export type DependencyValuesType<T extends DependencyMapType> = {
  [K in keyof T]: DependencyValueType<T[K]>;
};

// Per-task local interceptor for resource dependency context
export type TaskLocalInterceptor<TInput, TOutput> = (
  next: (input: TInput) => TOutput,
  input: TInput,
) => TOutput;

// When tasks are injected into resources, they expose an intercept() API
export type TaskDependencyWithIntercept<TInput, TOutput> = TaskDependency<
  TInput,
  TOutput
> & {
  intercept: (middleware: TaskLocalInterceptor<TInput, TOutput>) => void;
};

/** Resource-context dependency typing where tasks expose intercept() */
export type ResourceDependencyValueType<T> = T extends ITask<any, any, any>
  ? TaskDependencyWithIntercept<ExtractTaskInput<T>, ExtractTaskOutput<T>>
  : T extends IResource<any, any>
  ? ResourceDependency<ExtractResourceValue<T>>
  : T extends IEventDefinition<any>
  ? EventDependency<ExtractEventParams<T>>
  : T extends IOptionalDependency<infer U>
  ? ResourceDependencyValueType<U> | undefined
  : never;

export type ResourceDependencyValuesType<T extends DependencyMapType> = {
  [K in keyof T]: ResourceDependencyValueType<T[K]>;
};

/**
 * Anything you can put inside a resource's `register: []`.
 * - Resources (with or without `.with()`)
 * - Tasks
 * - Middleware
 * - Events
 */
export type RegisterableItems<T = any> =
  | IResourceWithConfig<any, any, any, any, any, any, any>
  | IResource<void, any, any, any, any, any, any> // For void configs
  | IResource<{ [K in any]?: any }, any, any, any, any, any, any> // For optional config
  | ITask<any, any, any, any>
  | IHook<any, any>
  | ITaskMiddleware<any>
  | IResourceMiddleware<any>
  | IEvent<any>
  | ITag<any, any>;

export type TaskMiddlewareAttachments =
  | ITaskMiddleware<void, void, void, any>
  | ITaskMiddleware<{ [K in any]?: any }, any, any, any>
  | ITaskMiddlewareConfigured<any, any, any, any>;

export type ResourceMiddlewareAttachments =
  | IResourceMiddleware<void, any, any, any>
  | IResourceMiddleware<{ [K in any]?: any }, any, any, any>
  | IResourceMiddlewareConfigured<any, any, any, any>;
