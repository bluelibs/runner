import { symbolError, symbolFilePath } from "./symbols";
import type { IOptionalDependency } from "./utilities";
import type { IValidationSchema } from "./utilities";
import type { IErrorMeta } from "./meta";

export type ErrorReference = string | IErrorHelper<any>;
export type ThrowsList = ReadonlyArray<ErrorReference>;

export interface IErrorDefinition<
  TData extends DefaultErrorType = DefaultErrorType,
> {
  id: string;
  httpCode?: number;
  serialize?: (data: TData) => string;
  parse?: (data: string) => TData;
  format?: (data: TData) => string;
  /**
   * Optional advice on how to fix the error. Appears in the stringified
   * error message after the main message. Can be a static string or a
   * function that receives the error data and returns a string.
   */
  remediation?: string | ((data: TData) => string);
  /**
   * Validate error data on throw(). If provided, data is parsed first.
   */
  dataSchema?: IValidationSchema<TData>;
  meta?: IErrorMeta;
}

export interface IErrorDefinitionFinal<
  TData extends DefaultErrorType,
> extends IErrorDefinition<TData> {
  format: (data: TData) => string;
  httpCode?: number;
  remediation?: string | ((data: TData) => string);
}

export type DefaultErrorType = Record<string, unknown>;
type RequiredKeys<T extends object> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];
export type ErrorThrowArgs<TData extends DefaultErrorType> =
  RequiredKeys<TData> extends never ? [data?: TData] : [data: TData];

/**
 * Runtime error shape thrown by r.error()/defineError() helpers.
 * Consumers can use helper.is(error) to narrow unknown values to this type.
 */
export interface IRunnerError<
  TData extends DefaultErrorType = DefaultErrorType,
> extends Error {
  id: string;
  httpCode?: number;
  data: TData;
  remediation?: string;
}

/**
 * Runtime helper returned by defineError()/r.error().
 * Contains helpers to throw typed errors and perform type-safe checks.
 */
export interface IErrorHelper<
  TData extends DefaultErrorType = DefaultErrorType,
> {
  /** Unique id for registration and DI */
  id: string;
  /** Optional HTTP status code associated with this error helper */
  httpCode?: number;
  /** Construct a typed error with the given data without throwing it */
  "new"(...args: ErrorThrowArgs<TData>): IRunnerError<TData>;
  /** Alias for .new() */
  create(...args: ErrorThrowArgs<TData>): IRunnerError<TData>;
  /** Throw a typed error with the given data */
  throw(...args: ErrorThrowArgs<TData>): never;
  /**
   * Type guard for checking if an unknown error is this error.
   * Optionally provide a partial data object to require shallow strict matches.
   */
  is(error: unknown): error is IRunnerError<TData>;
  /**
   * Type guard for checking if an unknown error is this error,
   * with shallow strict matching (`===`) on provided data keys.
   */
  is(error: unknown, partialData: Partial<TData>): error is IRunnerError<TData>;
  /** Brand symbol for runtime detection */
  [symbolError]: true;
  /** Return an optional dependency wrapper for this error */
  optional(): IOptionalDependency<IErrorHelper<TData>>;
  /** File path where this error was defined */
  [symbolFilePath]: string;
}
