/* istanbul ignore file */
import { getPlatform } from "../platform";
import { ITaskMiddlewareConfigured } from "../defs";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import { contextError, platformUnsupportedFunctionError } from "../errors";
import { IAsyncContext, IAsyncContextDefinition } from "../types/asyncContext";
import type {
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../types/utilities";
import { Serializer } from "../serializer";
import {
  symbolAsyncContext,
  symbolFilePath,
  symbolOptionalDependency,
} from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { assertDefinitionId } from "./assertDefinitionId";
import { isFrameworkDefinitionMarked } from "./markFrameworkDefinition";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

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
 * Defines a typed async context.
 *
 * Async contexts propagate per-execution values across async boundaries and can
 * also be required by middleware when a task must run inside an active context.
 */
export function defineAsyncContext<TSchema extends ValidationSchemaInput<any>>(
  def: Omit<
    IAsyncContextDefinition<InferValidationSchemaInput<TSchema>>,
    "configSchema"
  > & {
    configSchema: TSchema;
  },
  filePath?: string,
): IAsyncContext<InferValidationSchemaInput<TSchema>>;
export function defineAsyncContext<T>(
  def: IAsyncContextDefinition<T>,
  filePath?: string,
): IAsyncContext<T>;
export function defineAsyncContext<T>(
  def: IAsyncContextDefinition<T>,
  filePath?: string,
): IAsyncContext<T> {
  if (!platform.hasAsyncLocalStorage()) {
    platformUnsupportedFunctionError.throw({
      functionName: `createAsyncLocalStorage: Cannot create context ${def.id}: no async storage available in this environment`,
    });
  }

  const resolvedFilePath = filePath ?? getCallerFile();
  const ctxId = def.id;
  assertDefinitionId("Async context", ctxId, {
    allowReservedDottedNamespace: isFrameworkDefinitionMarked(def),
  });
  const configSchema = normalizeOptionalValidationSchema(def.configSchema, {
    definitionId: ctxId,
    subject: "Async context config",
  });

  /* istanbul ignore next */
  const use = (): T => {
    const store = getCurrentStore();
    if (!store || !store.has(ctxId)) {
      contextError.throw({
        details: `Context not available for symbol ${ctxId.toString()}`,
      });
    }
    const s = store!;
    return s.get(ctxId) as T;
  };

  const tryUse = (): T | undefined => {
    const store = getCurrentStore();
    if (!store || !store.has(ctxId)) {
      return undefined;
    }

    return store.get(ctxId) as T;
  };

  const provide = <R>(value: T, fn: () => Promise<R> | R): Promise<R> | R => {
    const currentStore = getCurrentStore();
    const map = currentStore
      ? new Map(currentStore)
      : new Map<string, unknown>();

    map.set(ctxId, value);

    // storage.run expects () => R, our fn is () => Promise<R> | R which is compatible
    return storage.run(map, fn as () => R);
  };

  const serializer = new Serializer();

  const api = {
    id: ctxId,
    [symbolAsyncContext]: true as const,
    [symbolFilePath]: resolvedFilePath,
    configSchema,
    use,
    tryUse,
    has() {
      return tryUse() !== undefined;
    },
    /* istanbul ignore next */
    provide(value: T, fn: () => Promise<any> | any) {
      // Validate provided context if schema exists
      const validated = configSchema ? configSchema.parse(value) : value;
      return provide(validated, fn);
    },
    require(): ITaskMiddlewareConfigured {
      return requireContextTaskMiddleware.with({
        context: api as IAsyncContext<T>,
      } as any);
    },
    /* istanbul ignore next */
    serialize: def.serialize || ((data: T) => serializer.stringify(data)),
    /* istanbul ignore next */
    parse: def.parse || ((data: string) => serializer.parse(data)),
    optional() {
      const wrapper = {
        inner: api as IAsyncContext<T>,
        [symbolOptionalDependency]: true,
      } as const;
      return freezeIfLineageLocked(api, wrapper);
    },
  };

  return deepFreeze(api) as IAsyncContext<T>;
}

export type { IAsyncContext } from "../types/asyncContext";
