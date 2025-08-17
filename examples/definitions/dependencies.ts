import {
  IEvent,
  IEventDefinition,
  IResource,
  ITask,
  TaskLocalInterceptor,
} from "../../src/defs";
import { symbolOptionalDependency } from "./symbols";

/**
 * A mapping of dependency keys to Runner definitions. Used in `dependencies`
 * for tasks and resources. Values are later transformed into the actual
 * callable/value shape by `DependencyValuesType`.
 */
export type DependencyMapType = Record<
  string,
  | ITask<any, any, any, any>
  | IResource<any, any, any, any, any>
  | IEventDefinition<any>
  | IOptionalDependency<ITask<any, any, any, any>>
  | IOptionalDependency<IResource<any, any, any, any, any>>
  | IOptionalDependency<IEventDefinition<any>>
>;

/** Wrapper type marking a dependency as optional at wiring time */
export interface IOptionalDependency<T> {
  /** The wrapped dependency definition */
  inner: T;
  /** Brand symbol for optional dependency */
  [symbolOptionalDependency]: true;
}

// Helper Types for Extracting Generics
export type ExtractTaskInput<T> = T extends ITask<infer I, any, infer D>
  ? I
  : never;
export type ExtractTaskOutput<T> = T extends ITask<any, infer O, infer D>
  ? O
  : never;
export type ExtractResourceValue<T> = T extends IResource<any, infer V, infer D>
  ? V extends Promise<infer U>
    ? U
    : V
  : never;

export type ExtractEventParams<T> = T extends IEvent<infer P> ? P : never;

/**
 * Task dependencies transform into callable functions: call with the task input
 * and you receive the task output.
 */
export type TaskDependency<I, O> = (
  ...args: I extends null | void ? [] : [I]
) => O;
/**
 * Resource dependencies resolve to the resource's value directly.
 */
export type ResourceDependency<V> = V;
/**
 * Event dependencies resolve to an emitter function. If the payload type is
 * `void`, the function can be called with zero args (or an empty object).
 */
export type EventDependency<P> = P extends void
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
