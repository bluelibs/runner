import { getPlatform } from "./platform";
import { ITaskMiddlewareConfigured } from "./defs";
import { requireContextTaskMiddleware } from "./globals/middleware/requireContext.middleware";
import {
  ContextError,
  PlatformUnsupportedFunction,
  RuntimeError,
} from "./errors";

export { ContextError };
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
    keys?: K[],
  ): ITaskMiddlewareConfigured<{ context: Context<T> }>;
}

// The internal storage maps Context identifiers (symbols) to their values
const platform = getPlatform();
export const storage = platform.createAsyncLocalStorage<Map<symbol, unknown>>();

/** Returns the currently active store or undefined. */
export function getCurrentStore(): Map<symbol, unknown> | undefined {
  return storage.getStore();
}

/**
 * Create a new typed Context. The result contains helpers similar to React’s
 * Context API but adapted for async usage in Runner.
 */
export function createContext<T>(name: string = "runner.context"): Context<T> {
  if (!platform.hasAsyncLocalStorage()) {
    throw new PlatformUnsupportedFunction(
      `createAsyncLocalStorage: Cannot create context ${name}: no async storage available in this environment`,
    );
  }
  const ctxId = Symbol(name);

  const use = (): T => {
    const store = getCurrentStore();
    if (!store || !store.has(ctxId)) {
      throw new ContextError(
        `Context not available for symbol ${ctxId.toString()}`,
      );
    }
    return store.get(ctxId) as T;
  };

  const provide = <R>(value: T, fn: () => Promise<R> | R): Promise<R> | R => {
    const currentStore = getCurrentStore();
    const map = currentStore
      ? new Map(currentStore)
      : new Map<symbol, unknown>();
    map.set(ctxId, value);

    return storage.run(map, fn as any);
  };

  const api = {
    id: ctxId,
    use,
    provide,
    require(): ITaskMiddlewareConfigured {
      return requireContextTaskMiddleware.with({ context: api as Context<T> });
    },
  };

  return api;
}
