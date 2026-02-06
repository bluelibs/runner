import type { DefaultErrorType, IErrorMeta } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeErrorBuilder } from "./fluent-builder";
import type { ErrorFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Entry point for creating an error builder.
 */
export function errorBuilder<TData extends DefaultErrorType = DefaultErrorType>(
  id: string,
): ErrorFluentBuilder<TData> {
  const filePath = getCallerFile();
  const initial: BuilderState<TData> = Object.freeze({
    id,
    filePath,
    serialize: undefined,
    parse: undefined,
    dataSchema: undefined,
    meta: {} as IErrorMeta,
  });

  return makeErrorBuilder(initial);
}

export const error = errorBuilder;
