import type {
  ResolveValidationSchemaInput,
  IAsyncContext,
  IAsyncContextMeta,
  ValidationSchemaInput,
} from "../../../defs";

export interface AsyncContextFluentBuilder<T = unknown> {
  id: string;
  serialize(fn: (data: T) => string): AsyncContextFluentBuilder<T>;
  parse(fn: (raw: string) => T): AsyncContextFluentBuilder<T>;
  configSchema<
    TNew = never,
    TSchema extends ValidationSchemaInput<[TNew] extends [never] ? any : TNew> =
      ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
  >(
    schema: TSchema,
  ): AsyncContextFluentBuilder<ResolveValidationSchemaInput<TNew, TSchema>>;

  /**
   * Alias for configSchema. Use this to define the context configuration validation contract.
   */
  schema<
    TNew = never,
    TSchema extends ValidationSchemaInput<[TNew] extends [never] ? any : TNew> =
      ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
  >(
    schema: TSchema,
  ): AsyncContextFluentBuilder<ResolveValidationSchemaInput<TNew, TSchema>>;

  meta<TNewMeta extends IAsyncContextMeta>(
    m: TNewMeta,
  ): AsyncContextFluentBuilder<T>;
  build(): IAsyncContext<T>;
}
