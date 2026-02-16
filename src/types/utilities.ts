import { IResource, IResourceWithConfig } from "./resource";
import { ITask } from "./task";
import { ITaskMiddleware } from "./taskMiddleware";
import { IResourceMiddleware } from "./resourceMiddleware";
import { IHook } from "./hook";
import {
  IEvent,
  IEventDefinition,
  IEventEmitOptions,
  IEventEmitReport,
} from "./event";
import { ITag } from "./tag";
import { symbolOptionalDependency } from "./symbols";
import { IErrorHelper } from "./error";
import type { IAsyncContext } from "./asyncContext";
import type { ExecutionJournal } from "./executionJournal";

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

/**
 * The reason we accept null and undefined is because we want to be able to offer beautiful DX:
 * overrides: [
 *    process.env.NODE_ENV === 'production' ? prodEmailer : null,
 * ]
 */
export type OverridableElements =
  | IResource<any, any, any, any, any>
  | ITask<any, any, any, any>
  | ITaskMiddleware<any>
  | IResourceMiddleware<any, any>
  | IResourceWithConfig<any, any, any>
  | IHook<any, any>
  | undefined
  | null;

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
  | IErrorHelper<any>
  | IAsyncContext<any>
  | IOptionalDependency<ITask<any, any, any, any, any, any>>
  | IOptionalDependency<IResource<any, any, any, any, any, any, any>>
  | IOptionalDependency<IEvent<any>>
  | IOptionalDependency<IErrorHelper<any>>
  | IOptionalDependency<IAsyncContext<any>>
>;

/** Wrapper type marking a dependency as optional at wiring time */
export interface IOptionalDependency<T> {
  /** The wrapped dependency definition */
  inner: T;
  /** Brand symbol for optional dependency */
  [symbolOptionalDependency]: true;
}

// Helper Types for Extracting Generics
export type ExtractTaskInput<T> =
  T extends ITask<infer I, any, infer _D> ? I : never;
export type ExtractTaskOutput<T> =
  T extends ITask<any, infer O, infer _D> ? O : never;
export type ExtractResourceConfig<T> =
  T extends IResource<infer C, any, any> ? C : never;
export type ExtractResourceValue<T> =
  T extends IResource<any, infer V, infer _D>
    ? V extends Promise<infer U>
      ? U
      : V
    : never;

export type ExtractEventPayload<T> =
  T extends IEventDefinition<infer P>
    ? P
    : T extends IEvent<infer P>
      ? P
      : never;

// Type helpers for unions/intersections and common payload across event arrays
export type UnionToIntersection<U> = (
  U extends any ? (x: U) => any : never
) extends (x: infer I) => any
  ? I
  : never;

export type CommonPayload<
  T extends readonly IEventDefinition<any>[] | IEventDefinition<any>,
> = T extends readonly IEventDefinition<any>[]
  ? {
      [K in keyof ExtractEventPayload<T[number]>]: UnionToIntersection<
        ExtractEventPayload<T[number]> extends any
          ? ExtractEventPayload<T[number]>[K]
          : never
      >;
    }
  : ExtractEventPayload<T>;

/**
 * Options that can be passed when calling a task dependency.
 * Allows forwarding the execution journal to nested task calls.
 */
export interface TaskCallOptions {
  /** Optional journal to forward to the nested task */
  journal?: ExecutionJournal;
}

/**
 * Task dependencies transform into callable functions: call with the task input
 * and you receive the task output. Optionally accepts TaskCallOptions for journal forwarding.
 */
export type TaskDependency<I, O> = I extends null | void
  ? {
      (options?: TaskCallOptions): O;
      (input?: I, options?: TaskCallOptions): O;
    }
  : (input: I, options?: TaskCallOptions) => O;
/**
 * Resource dependencies resolve to the resource's value directly.
 */
export type ResourceDependency<V> = V;
/**
 * Event dependencies resolve to an emitter function. If the payload type is
 * `void`, the function can be called with zero args (or an empty object).
 */
type EventEmitVoidDependency = {
  (): Promise<void>;
  (input?: Record<string, never>): Promise<void>;
  (
    input: Record<string, never> | undefined,
    options: IEventEmitOptions & { report: true },
  ): Promise<IEventEmitReport>;
  (
    input: Record<string, never> | undefined,
    options?: IEventEmitOptions & { report?: false | undefined },
  ): Promise<void>;
  (
    input: Record<string, never> | undefined,
    options?: IEventEmitOptions,
  ): Promise<void | IEventEmitReport>;
};

type EventEmitPayloadDependency<P> = {
  (input: P): Promise<void>;
  (
    input: P,
    options: IEventEmitOptions & { report: true },
  ): Promise<IEventEmitReport>;
  (
    input: P,
    options?: IEventEmitOptions & { report?: false | undefined },
  ): Promise<void>;
  (input: P, options?: IEventEmitOptions): Promise<void | IEventEmitReport>;
};

export type EventDependency<P> = P extends void
  ? EventEmitVoidDependency
  : EventEmitPayloadDependency<P>;

/**
 * Transforms a dependency definition into the usable shape inside `run`/`init`:
 * - Task -> callable function
 * - Resource -> resolved value
 * - Event -> emit function
 */
export type DependencyValueType<T> =
  T extends ITask<any, any, any>
    ? TaskDependency<ExtractTaskInput<T>, ExtractTaskOutput<T>>
    : T extends IResource<any, any>
      ? ResourceDependency<ExtractResourceValue<T>>
      : T extends IErrorHelper<any>
        ? T
        : T extends IAsyncContext<any>
          ? T
          : T extends IEventDefinition<any>
            ? EventDependency<ExtractEventPayload<T>>
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
export type ResourceDependencyValueType<T> =
  T extends ITask<any, any, any>
    ? TaskDependencyWithIntercept<ExtractTaskInput<T>, ExtractTaskOutput<T>>
    : T extends IResource<any, any>
      ? ResourceDependency<ExtractResourceValue<T>>
      : T extends IErrorHelper<any>
        ? T
        : T extends IAsyncContext<any>
          ? T
          : T extends IEventDefinition<any>
            ? EventDependency<ExtractEventPayload<T>>
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
export type RegisterableItems =
  | IResourceWithConfig<any, any, any, any, any, any, any>
  | IResource<void, any, any, any, any, any, any> // For void configs
  | IResource<{ [K in any]?: any }, any, any, any, any, any, any> // For optional config
  // Accept tasks with any tags and middleware generics to avoid variance issues
  // when registering tasks that already have configured middleware.
  | ITask<any, any, any, any, any, any>
  | IHook<any, any>
  | ITaskMiddleware<any, any, any, any>
  | IResourceMiddleware<any, any, any, any>
  | IEvent<any>
  | IAsyncContext<any>
  | IErrorHelper<any>
  | ITag<any, any, any>;
