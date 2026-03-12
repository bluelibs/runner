import type {
  DefaultErrorType,
  EnsureTagsForTarget,
  IErrorMeta,
  IErrorHelper,
  ErrorTagType,
  ResolveValidationSchemaInput,
  ValidationSchemaInput,
} from "../../../defs";

export interface ErrorFluentBuilder<
  TData extends DefaultErrorType = DefaultErrorType,
> {
  id: string;
  httpCode(code: number): ErrorFluentBuilder<TData>;
  serialize(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  parse(fn: (raw: string) => TData): ErrorFluentBuilder<TData>;
  dataSchema<
    TNewData extends DefaultErrorType = never,
    TSchema extends ValidationSchemaInput<
      [TNewData] extends [never] ? any : TNewData
    > = ValidationSchemaInput<[TNewData] extends [never] ? any : TNewData>,
  >(
    schema: TSchema,
  ): ErrorFluentBuilder<
    ResolveValidationSchemaInput<TNewData, TSchema> & DefaultErrorType
  >;

  /**
   * Alias for dataSchema. Use this to define the error data validation contract.
   */
  schema<
    TNewData extends DefaultErrorType = never,
    TSchema extends ValidationSchemaInput<
      [TNewData] extends [never] ? any : TNewData
    > = ValidationSchemaInput<[TNewData] extends [never] ? any : TNewData>,
  >(
    schema: TSchema,
  ): ErrorFluentBuilder<
    ResolveValidationSchemaInput<TNewData, TSchema> & DefaultErrorType
  >;

  tags<TNewTags extends ErrorTagType[]>(
    t: EnsureTagsForTarget<"errors", TNewTags>,
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
