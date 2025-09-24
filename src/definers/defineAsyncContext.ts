import { getPlatform } from "../platform";
import { ITaskMiddlewareConfigured } from "../defs";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import {
  ContextError,
  PlatformUnsupportedFunction,
  RuntimeError,
} from "../errors";
import { IAsyncContext, IAsyncContextDefinition } from "../types/asyncContext";
import { getDefaultSerializer } from "../globals/resources/tunnel/serializer";

export { ContextError };

// The internal storage maps Context identifiers (symbols) to their values
const platform = getPlatform();
export const storage = platform.createAsyncLocalStorage<Map<string, unknown>>();

/** Returns the currently active store or undefined. */
export function getCurrentStore(): Map<string, unknown> | undefined {
  return storage.getStore();
}
/**
 * Create a new typed Context. The result contains helpers similar to React’s
 * Context API but adapted for async usage in Runner.
 */
export function defineAsyncContext<T>(
  def: IAsyncContextDefinition<T>,
): IAsyncContext<T> {
  if (!platform.hasAsyncLocalStorage()) {
    throw new PlatformUnsupportedFunction(
      `createAsyncLocalStorage: Cannot create context ${name}: no async storage available in this environment`,
    );
  }

  const ctxId = def.id;

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
      : new Map<string, unknown>();

    map.set(ctxId, value);

    return storage.run(map, fn as any);
  };

  const serializer = getDefaultSerializer();

  const api = {
    id: ctxId,
    use,
    provide,
    require(): ITaskMiddlewareConfigured {
      return requireContextTaskMiddleware.with({
        context: api as IAsyncContext<T>,
      });
    },
    serialize: def.serialize || ((data: T) => serializer.stringify(data)),
    parse: def.parse || ((data: string) => serializer.parse(data)),
  };

  return api;
}

export type { IAsyncContext } from "../types/asyncContext";

/** Convenience creator allowing optional name. Used by tests and legacy API. */
/** @deprecated Use defineAsyncContext instead */
export function createContext<T>(name?: string): IAsyncContext<T> {
  const id =
    name ?? `context.${Math.random().toString(36).slice(2)}.${Date.now()}`;
  return defineAsyncContext<T>({ id });
}
