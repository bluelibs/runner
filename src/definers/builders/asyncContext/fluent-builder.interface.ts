import type {
  ResolveValidationSchemaInput,
  IAsyncContext,
  IAsyncContextMeta,
  ValidationSchemaInput,
} from "../../../defs";

export interface AsyncContextFluentBuilder<T = unknown> {
  id: string;
  /** Provides a custom serializer for transport scenarios. */
  serialize(fn: (data: T) => string): AsyncContextFluentBuilder<T>;
  /** Provides a custom parser paired with {@link serialize}. */
  parse(fn: (raw: string) => T): AsyncContextFluentBuilder<T>;
  /** Declares the context value schema. */
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

  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IAsyncContextMeta>(
    m: TNewMeta,
  ): AsyncContextFluentBuilder<T>;
  /** Materializes the final async-context accessor for registration or reuse. */
  build(): IAsyncContext<T>;
}
