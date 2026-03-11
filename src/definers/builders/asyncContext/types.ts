import type { IAsyncContextMeta, ValidationSchemaInput } from "../../../defs";

/**
 * Internal state for the AsyncContextFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<T> = Readonly<{
  id: string;
  filePath: string;
  serialize?: (data: T) => string;
  parse?: (raw: string) => T;
  configSchema?: ValidationSchemaInput<T>;
  meta?: IAsyncContextMeta;
}>;
