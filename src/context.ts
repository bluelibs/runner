import { AsyncLocalStorage } from "async_hooks";
import { defineMiddleware } from "./define";
import { IMiddleware, IMiddlewareConfigured } from "./defs";
import { requireContextMiddleware } from "./globals/middleware/requireContext.middleware";

/**
 * Error thrown whenever a requested context is not available.
 */
export class ContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextError";
  }
}

/**
 * The generic Context object returned by `createContext`.
 */
export interface Context<T> {
  /** unique symbol used as key in the AsyncLocalStorage map */
  readonly id: symbol;
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
    keys?: K[]
  ): IMiddlewareConfigured<{ context: Context<T> }>;
}

// The internal storage maps Context identifiers (symbols) to their values
export const storage = new AsyncLocalStorage<Map<symbol, unknown>>();

/** Returns the currently active store or undefined. */
function getCurrentStore(): Map<symbol, unknown> | undefined {
  return storage.getStore();
}

/**
 * Create a new typed Context. The result contains helpers similar to React’s
 * Context API but adapted for async usage in Runner.
 */
export function createContext<T>(name: string = "runner.context"): Context<T> {
  const ctxId = Symbol(name);

  function use(): T {
    const store = getCurrentStore();
    if (!store || !store.has(ctxId)) {
      throw new ContextError(
        `Context not available for symbol ${ctxId.toString()}`
      );
    }
    return store.get(ctxId) as T;
  }

  function provide<R>(value: T, fn: () => Promise<R> | R): Promise<R> | R {
    const currentStore = getCurrentStore();
    const map = currentStore
      ? new Map(currentStore)
      : new Map<symbol, unknown>();
    map.set(ctxId, value);

    return storage.run(map, fn as any);
  }

  /**
   * Generates a middleware that guarantees the context exists (and optionally
   * enforces that certain keys are present on the context object).
   */
  function require(): IMiddlewareConfigured {
    return requireContextMiddleware.with({ context: this as Context<T> });
  }

  return {
    id: ctxId,
    use,
    provide,
    require,
  };
}
