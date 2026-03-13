import type { IAsyncContextMeta } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeAsyncContextBuilder } from "./fluent-builder";
import type { AsyncContextFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Creates a fluent async-context builder.
 *
 * Async contexts are for per-execution state propagation, not general dependency injection.
 */
export function asyncContextBuilder<T = unknown>(
  id: string,
): AsyncContextFluentBuilder<T> {
  const filePath = getCallerFile();
  const initial: BuilderState<T> = Object.freeze({
    id,
    filePath,
    serialize: undefined,
    parse: undefined,
    configSchema: undefined,
    meta: {} as IAsyncContextMeta,
  });

  return makeAsyncContextBuilder(initial);
}

/**
 * Shorthand for {@link asyncContextBuilder}.
 */
export const asyncContext = asyncContextBuilder;
