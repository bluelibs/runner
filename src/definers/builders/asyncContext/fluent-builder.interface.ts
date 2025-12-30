import type {
  IAsyncContext,
  IAsyncContextMeta,
  IValidationSchema,
} from "../../../defs";

export interface AsyncContextFluentBuilder<T = unknown> {
  id: string;
  serialize(fn: (data: T) => string): AsyncContextFluentBuilder<T>;
  parse(fn: (raw: string) => T): AsyncContextFluentBuilder<T>;
  configSchema(schema: IValidationSchema<T>): AsyncContextFluentBuilder<T>;
  meta<TNewMeta extends IAsyncContextMeta>(
    m: TNewMeta,
  ): AsyncContextFluentBuilder<T>;
  build(): IAsyncContext<T>;
}
