import type {
  DefaultErrorType,
  ErrorTagType,
  IErrorMeta,
  ValidationSchemaInput,
} from "../../../defs";

/**
 * Internal state for the ErrorFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<TData extends DefaultErrorType> = Readonly<{
  id: string;
  filePath: string;
  frameworkOwned?: boolean;
  httpCode?: number;
  format?: (data: TData) => string;
  remediation?: string | ((data: TData) => string);
  serialize?: (data: TData) => string;
  parse?: (raw: string) => TData;
  dataSchema?: ValidationSchemaInput<TData>;
  meta?: IErrorMeta;
  tags?: ErrorTagType[];
}>;
