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
  remediation?: string | ((data: TData) => string);
}

export type DefaultErrorType = Record<string, unknown>;

/**
 * Runtime error shape thrown by r.error()/defineError() helpers.
 * Consumers can use helper.is(error) to narrow unknown values to this type.
 */
export interface IRunnerError<
  TData extends DefaultErrorType = DefaultErrorType,
> extends Error {
  id: string;
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
  /** Throw a typed error with the given data */
  throw(data: TData): never;
  /** Type guard for checking if an unknown error is this error */
  is(error: unknown): error is IRunnerError<TData>;
  /** Brand symbol for runtime detection */
  [symbolError]: true;
  /** Return an optional dependency wrapper for this error */
  optional(): IOptionalDependency<IErrorHelper<TData>>;
  /** File path where this error was defined */
  [symbolFilePath]: string;
}
