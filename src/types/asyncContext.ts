import { symbolAsyncContext } from "./symbols";
import { ITaskMiddlewareConfigured } from "./taskMiddleware";
import type { IValidationSchema, IOptionalDependency } from "./utilities";
import type { IAsyncContextMeta } from "./meta";

export interface IAsyncContextDefinition<T> {
  id: string;
  serialize?(data: T): string;
  parse?(data: string): T;
  /**
   * When provided, context values will be validated when provide() is called.
   */
  configSchema?: IValidationSchema<T>;
  meta?: IAsyncContextMeta;
}

/**
 * The generic AsyncContext object returned by `defineAsyncContext`.
 */
export interface IAsyncContext<T> {
  /** unique symbol used as key in the AsyncLocalStorage map */
  readonly id: string;
  /** Brand marker for registration and runtime checks */
  [symbolAsyncContext]: true;
  /** Retrieve the current context value or throw */
  use(): T;
  /**
   * Provide a value for this context during the lifetime of `fn()`
   */
  provide<R>(value: T, fn: () => Promise<R> | R): Promise<R> | R;
  /**
   * Generates a middleware that guarantees the context exists (and optionally
   * enforces that certain keys are present on the context object).
   */
  require<K extends keyof T = never>(
    keys?: K[],
  ): ITaskMiddlewareConfigured<{ context: IAsyncContext<T> }>;

  serialize(data: T): string;
  parse(data: string): T;
  /** Return an optional dependency wrapper for this context */
  optional(): IOptionalDependency<IAsyncContext<T>>;
}
