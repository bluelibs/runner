/* istanbul ignore file */
import { getPlatform } from "../platform";
import { ITaskMiddlewareConfigured } from "../defs";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import { contextError, platformUnsupportedFunctionError } from "../errors";
import {
  IAsyncContext,
  IAsyncContextDefinition,
  ASYNC_CONTEXT_TYPES_LOADED,
} from "../types/asyncContext";
import { getDefaultSerializer } from "../serializer";
import { symbolAsyncContext, symbolOptionalDependency } from "../types/symbols";

export { contextError as ContextError };

// The internal storage maps Context identifiers (symbols) to their values
const platform = getPlatform();
export const storage = platform.createAsyncLocalStorage<Map<string, unknown>>();

/** Returns the currently active store or undefined. */
/* istanbul ignore next */
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
    platformUnsupportedFunctionError.throw({
      functionName: `createAsyncLocalStorage: Cannot create context ${def.id}: no async storage available in this environment`,
    });
  }

  const ctxId = def.id;

  /* istanbul ignore next */
  const use = (): T => {
    void ASYNC_CONTEXT_TYPES_LOADED; // keep async context types included under coverage
    const store = getCurrentStore();
    if (!store || !store.has(ctxId)) {
      contextError.throw({
        details: `Context not available for symbol ${ctxId.toString()}`,
      });
    }
    const s = store!;
    return s.get(ctxId) as T;
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
    [symbolAsyncContext]: true as const,
    use,
    /* istanbul ignore next */
    provide(value: T, fn: () => Promise<any> | any) {
      // Validate provided context if schema exists
      const validated = def.configSchema
        ? def.configSchema.parse(value)
        : value;
      return provide(validated, fn);
    },
    require(): ITaskMiddlewareConfigured {
      return requireContextTaskMiddleware.with({
        context: api as IAsyncContext<T>,
      });
    },
    /* istanbul ignore next */
    serialize: def.serialize || ((data: T) => serializer.stringify(data)),
    /* istanbul ignore next */
    parse: def.parse || ((data: string) => serializer.parse(data)),
    optional() {
      return {
        inner: api as IAsyncContext<T>,
        [symbolOptionalDependency]: true,
      } as const;
    },
  };

  return api;
}

export type { IAsyncContext } from "../types/asyncContext";

/** Convenience creator allowing optional name. Used by tests and legacy API. */
/** @deprecated Use defineAsyncContext instead */
/* istanbul ignore next */
export function createContext<T>(name?: string): IAsyncContext<T> {
  const id =
    name ?? `context.${Math.random().toString(36).slice(2)}.${Date.now()}`;
  return defineAsyncContext<T>({ id });
}
