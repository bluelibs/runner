import { ITaskMiddlewareConfigured } from "defs";

export interface IAsyncContextDefinition<T> {
  id: string;
  serialize?(data: T): string;
  parse?(data: string): T;
}

/**
 * The generic AsyncContext object returned by `defineAsyncContext`.
 */
export interface IAsyncContext<T> {
  /** unique symbol used as key in the AsyncLocalStorage map */
  readonly id: string;
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
}
