import type {
  IAsyncContext,
  IAsyncContextMeta,
  ValidationSchemaInput,
} from "../../../defs";

export interface AsyncContextFluentBuilder<T = unknown> {
  id: string;
  serialize(fn: (data: T) => string): AsyncContextFluentBuilder<T>;
  parse(fn: (raw: string) => T): AsyncContextFluentBuilder<T>;
  configSchema(schema: ValidationSchemaInput<T>): AsyncContextFluentBuilder<T>;

  /**
   * Alias for configSchema. Use this to define the context configuration validation contract.
   */
  schema(schema: ValidationSchemaInput<T>): AsyncContextFluentBuilder<T>;

  meta<TNewMeta extends IAsyncContextMeta>(
    m: TNewMeta,
  ): AsyncContextFluentBuilder<T>;
  build(): IAsyncContext<T>;
}
