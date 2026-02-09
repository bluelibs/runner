import type { DefaultErrorType, IErrorMeta } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeErrorBuilder } from "./fluent-builder";
import type { ErrorFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { RunnerError } from "../../defineError";

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
    httpCode: undefined,
    serialize: undefined,
    parse: undefined,
    dataSchema: undefined,
    meta: {} as IErrorMeta,
  });

  return makeErrorBuilder(initial);
}

/**
 * Check if an error is any Runner error (not just a specific one).
 * @param error - The error to check
 * @returns true if the error is a RunnerError instance
 */
function isRunnerError(error: unknown): error is RunnerError {
  return error instanceof RunnerError;
}

export const error = Object.assign(errorBuilder, {
  is: isRunnerError,
});
