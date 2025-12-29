import type { IAsyncContextMeta, IValidationSchema } from "../../../defs";

/**
 * Internal state for the AsyncContextFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<T> = Readonly<{
  id: string;
  serialize?: (data: T) => string;
  parse?: (raw: string) => T;
  configSchema?: IValidationSchema<T>;
  meta?: IAsyncContextMeta;
}>;
