import type { DefaultErrorType, IErrorMeta } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeErrorBuilder } from "./fluent-builder";
import type { ErrorFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { matchesRunnerErrorData, RunnerError } from "../../defineError";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

type InternalErrorBuilderOptions = {
  filePath: string;
};

function createErrorBuilder<TData extends DefaultErrorType = DefaultErrorType>(
  id: string,
  options: InternalErrorBuilderOptions,
): ErrorFluentBuilder<TData> {
  const initial: BuilderState<TData> = Object.freeze({
    id,
    filePath: options.filePath,
    httpCode: undefined,
    serialize: undefined,
    parse: undefined,
    dataSchema: undefined,
    meta: {} as IErrorMeta,
  });

  return makeErrorBuilder(initial);
}

/**
 * Creates a fluent Runner error builder.
 *
 * Use this when you want typed error data, stable ids, and helper methods such as `.throw()` and `.is(...)`.
 */
export function errorBuilder<TData extends DefaultErrorType = DefaultErrorType>(
  id: string,
): ErrorFluentBuilder<TData> {
  return createErrorBuilder(id, {
    filePath: getCallerFile(),
  });
}

/**
 * Checks whether a value is a Runner error, optionally matching a subset of its data payload.
 */
function isRunnerError(error: unknown): error is RunnerError;
function isRunnerError(
  error: unknown,
  partialData: Partial<DefaultErrorType>,
): error is RunnerError;
function isRunnerError(
  error: unknown,
  partialData?: unknown,
): error is RunnerError {
  const safePartialData =
    partialData !== null && typeof partialData === "object"
      ? (partialData as Partial<DefaultErrorType>)
      : undefined;

  return (
    error instanceof RunnerError &&
    matchesRunnerErrorData(error.data, safePartialData)
  );
}

/**
 * Error builder namespace with a shared `is(...)` type guard attached.
 */
export const error = Object.assign(errorBuilder, {
  is: isRunnerError,
});

export function frameworkError<
  TData extends DefaultErrorType = DefaultErrorType,
>(id: string): ErrorFluentBuilder<TData> {
  return createErrorBuilder(id, {
    filePath: getCallerFile(),
  });
}
