import type { IAsyncContextMeta } from "../../../defs";
import { makeAsyncContextBuilder } from "./fluent-builder";
import type { AsyncContextFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Entry point for creating an async context builder.
 */
export function asyncContextBuilder<T = unknown>(
  id: string,
): AsyncContextFluentBuilder<T> {
  const initial: BuilderState<T> = Object.freeze({
    id,
    serialize: undefined,
    parse: undefined,
    configSchema: undefined,
    meta: {} as IAsyncContextMeta,
  });

  return makeAsyncContextBuilder(initial);
}

export const asyncContext = asyncContextBuilder;
