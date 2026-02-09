import type {
  DefaultErrorType,
  IErrorMeta,
  IValidationSchema,
  IErrorHelper,
} from "../../../defs";

export interface ErrorFluentBuilder<
  TData extends DefaultErrorType = DefaultErrorType,
> {
  id: string;
  httpCode(code: number): ErrorFluentBuilder<TData>;
  serialize(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  parse(fn: (raw: string) => TData): ErrorFluentBuilder<TData>;
  dataSchema(schema: IValidationSchema<TData>): ErrorFluentBuilder<TData>;
  build(): IErrorHelper<TData>;
  format(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  /**
   * Attach remediation advice that explains how to fix this error.
   * Appears in the stringified error after the main message.
   */
  remediation(
    advice: string | ((data: TData) => string),
  ): ErrorFluentBuilder<TData>;
  meta<TNewMeta extends IErrorMeta>(m: TNewMeta): ErrorFluentBuilder<TData>;
}
