import type {
  DefaultErrorType,
  IErrorMeta,
  IValidationSchema,
  IErrorHelper,
  TagType,
} from "../../../defs";

export interface ErrorFluentBuilder<
  TData extends DefaultErrorType = DefaultErrorType,
> {
  id: string;
  httpCode(code: number): ErrorFluentBuilder<TData>;
  serialize(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  parse(fn: (raw: string) => TData): ErrorFluentBuilder<TData>;
  dataSchema(schema: IValidationSchema<TData>): ErrorFluentBuilder<TData>;

  /**
   * Alias for dataSchema. Use this to define the error data validation contract.
   */
  schema(schema: IValidationSchema<TData>): ErrorFluentBuilder<TData>;

  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: boolean },
  ): ErrorFluentBuilder<TData>;

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
