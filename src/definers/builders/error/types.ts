import type {
  DefaultErrorType,
  IErrorMeta,
  IValidationSchema,
} from "../../../defs";

/**
 * Internal state for the ErrorFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<TData extends DefaultErrorType> = Readonly<{
  id: string;
  filePath: string;
  format?: (data: TData) => string;
  serialize?: (data: TData) => string;
  parse?: (raw: string) => TData;
  dataSchema?: IValidationSchema<TData>;
  meta?: IErrorMeta;
}>;
