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
  /** Associates an HTTP status code with the error helper. */
  httpCode(code: number): ErrorFluentBuilder<TData>;
  /** Provides a custom serializer for transport or persistence scenarios. */
  serialize(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  /** Provides a custom parser paired with {@link serialize}. */
  parse(fn: (raw: string) => TData): ErrorFluentBuilder<TData>;
  /** Declares the error data schema. */
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

  /** Adds or replaces error tags. */
  tags<TNewTags extends ErrorTagType[]>(
    t: EnsureTagsForTarget<"errors", TNewTags>,
    options?: { override?: boolean },
  ): ErrorFluentBuilder<TData>;

  /** Materializes the final error helper for registration or reuse. */
  build(): IErrorHelper<TData>;
  /** Sets the user-facing message formatter. */
  format(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  /**
   * Attach remediation advice that explains how to fix this error.
   * Appears in the stringified error after the main message.
   */
  remediation(
    advice: string | ((data: TData) => string),
  ): ErrorFluentBuilder<TData>;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IErrorMeta>(m: TNewMeta): ErrorFluentBuilder<TData>;
}
