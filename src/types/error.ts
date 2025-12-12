import { symbolError, symbolOptionalDependency } from "./symbols";
import type { IOptionalDependency } from "./utilities";
import type { IValidationSchema } from "./utilities";
import type { IErrorMeta } from "./meta";

// Tiny runtime marker to help coverage include this file
export const ERROR_TYPES_LOADED = true as const;

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
   * Validate error data on throw(). If provided, data is parsed first.
   */
  dataSchema?: IValidationSchema<TData>;
  meta?: IErrorMeta;
}

export interface IErrorDefinitionFinal<TData extends DefaultErrorType>
  extends IErrorDefinition<TData> {
  format: (data: TData) => string;
}

export type DefaultErrorType = Record<string, unknown>;

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
  is(error: unknown): boolean;
  /** Brand symbol for runtime detection */
  [symbolError]: true;
  /** Return an optional dependency wrapper for this error */
  optional(): IOptionalDependency<IErrorHelper<TData>>;
}
